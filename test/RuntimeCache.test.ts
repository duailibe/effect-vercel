import { createHash } from "node:crypto"
import { assert, describe, it } from "@effect/vitest"
import type { RuntimeCache as VercelCache } from "@vercel/functions"
import { Duration, Effect, Exit, Schema, Tracer } from "effect"
import { Persistable, PersistedCache, Persistence } from "effect/persistence"
import * as RuntimeCache from "../src/RuntimeCache.js"

class User extends Schema.Class<User>("User")({ id: Schema.Number, name: Schema.String }) {}

class GetUser extends Persistable.Class<{ payload: { id: number } }>()("GetUser", {
  primaryKey: (req) => `GetUser:${req.id}`,
  success: User,
  error: Schema.String,
}) {}

describe("RuntimeCache", () => {
  // Off Vercel, `getCache` falls back to its in-memory cache.
  it.effect("shares results across PersistedCache instances", () =>
    Effect.gen(function* () {
      let lookups = 0
      const make = PersistedCache.make(
        (req: GetUser) =>
          Effect.sync(() => {
            lookups++
            return new User({ id: req.id, name: "Ada" })
          }),
        { storeId: "shares", timeToLive: () => "1 minute" },
      )
      const first = yield* make
      const second = yield* make
      assert.deepStrictEqual(
        yield* first.get(new GetUser({ id: 1 })),
        new User({ id: 1, name: "Ada" }),
      )
      assert.deepStrictEqual(
        yield* second.get(new GetUser({ id: 1 })),
        new User({ id: 1, name: "Ada" }),
      )
      assert.strictEqual(lookups, 1)
    }).pipe(Effect.scoped, Effect.provide(RuntimeCache.layer)),
  )

  it.effect("stores failures and clears by store id", () =>
    Effect.gen(function* () {
      const persistence = yield* Persistence.Persistence
      const store = yield* persistence.make({ storeId: "clears" })
      const other = yield* persistence.make({ storeId: "keeps" })
      const req = new GetUser({ id: 1 })

      yield* store.set(req, Exit.fail("not found"))
      yield* other.set(req, Exit.succeed(new User({ id: 1, name: "Ada" })))
      assert.deepStrictEqual(yield* store.get(req), Exit.fail("not found"))

      yield* store.clear
      assert.isUndefined(yield* store.get(req))
      assert.isDefined(yield* other.get(req))
    }).pipe(Effect.scoped, Effect.provide(RuntimeCache.layer)),
  )

  it.effect("keeps stores apart when ids and keys contain the separator", () =>
    Effect.gen(function* () {
      const backing = yield* Persistence.BackingPersistence
      const a = yield* backing.make("a")
      const ab = yield* backing.make("a:b")
      yield* a.set("b:c", { from: "a" }, undefined)
      assert.isUndefined(yield* ab.get("c"))
    }).pipe(Effect.scoped, Effect.provide(RuntimeCache.layerBacking)),
  )

  it.effect("sends whole-second TTLs, a hashed store tag, and no name", () =>
    Effect.gen(function* () {
      const sets: Array<{ key: string; name?: string; ttl?: number; tags?: Array<string> }> = []
      const cache: VercelCache = {
        get: async () => null,
        set: async (key, _value, options) => void sets.push({ key, ...options }),
        delete: async () => {},
        expireTag: async () => {},
      }
      const store = yield* RuntimeCache.makeBacking(cache).make("users")
      yield* store.set("a", {}, Duration.millis(1500))
      yield* store.set("b", {}, undefined)
      const tags = [`effect-persistence:${createHash("sha256").update("users").digest("hex")}`]
      assert.deepStrictEqual(sets, [
        { key: '["users","a"]', name: "", ttl: 2, tags },
        { key: '["users","b"]', name: "", tags },
      ])
    }).pipe(Effect.scoped),
  )

  it.effect("traces each call with the store id and hit, but not the key", () =>
    Effect.gen(function* () {
      const spans: Array<Tracer.NativeSpan> = []
      const tracer = Tracer.make({
        span: (options) => {
          const span = new Tracer.NativeSpan(options)
          spans.push(span)
          return span
        },
      })
      const cache: VercelCache = {
        get: async (key) => (key === '["users","a"]' ? {} : null),
        set: async () => {},
        delete: async () => {},
        expireTag: async () => {},
      }
      const store = yield* RuntimeCache.makeBacking(cache).make("users")
      yield* Effect.all([
        store.get("a"),
        store.get("b"),
        store.set("a", {}, undefined),
        store.remove("a"),
        store.clear,
      ]).pipe(Effect.withTracer(tracer))
      const users = { "cache.store_id": "users" }
      assert.deepStrictEqual(
        spans.map((span) => [span.name, span.kind, Object.fromEntries(span.attributes)]),
        [
          ["RuntimeCache.get", "client", { ...users, "cache.hit": true }],
          ["RuntimeCache.get", "client", { ...users, "cache.hit": false }],
          ["RuntimeCache.set", "client", users],
          ["RuntimeCache.remove", "client", users],
          ["RuntimeCache.clear", "client", users],
        ],
      )
    }).pipe(Effect.scoped),
  )

  it.effect("setMany writes only the last entry for a repeated key", () =>
    Effect.gen(function* () {
      const values: Array<unknown> = []
      const cache: VercelCache = {
        get: async () => null,
        set: async (_key, value) => void values.push(value),
        delete: async () => {},
        expireTag: async () => {},
      }
      const store = yield* RuntimeCache.makeBacking(cache).make("users")
      yield* store.setMany([
        ["a", { n: 1 }, undefined],
        ["a", { n: 2 }, undefined],
      ])
      assert.deepStrictEqual(values, [{ n: 2 }])
    }).pipe(Effect.scoped),
  )
})
