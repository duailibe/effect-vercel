import { createHash } from "node:crypto"
import { assert, describe, it } from "@effect/vitest"
import type { RuntimeCache } from "@vercel/functions"
import { Duration, Effect, Exit, Schema } from "effect"
import { Persistable, PersistedCache, Persistence } from "effect/unstable/persistence"
import { VercelRuntimeCache } from "../src/runtime-cache.js"

class User extends Schema.Class<User>("User")({ id: Schema.Number, name: Schema.String }) {}

class GetUser extends Persistable.Class<{ payload: { id: number } }>()("GetUser", {
  primaryKey: (req) => `GetUser:${req.id}`,
  success: User,
  error: Schema.String,
}) {}

describe("VercelRuntimeCache", () => {
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
    }).pipe(Effect.scoped, Effect.provide(VercelRuntimeCache.layer)),
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
    }).pipe(Effect.scoped, Effect.provide(VercelRuntimeCache.layer)),
  )

  it.effect("keeps stores apart when ids and keys contain the separator", () =>
    Effect.gen(function* () {
      const backing = yield* Persistence.BackingPersistence
      const a = yield* backing.make("a")
      const ab = yield* backing.make("a:b")
      yield* a.set("b:c", { from: "a" }, undefined)
      assert.isUndefined(yield* ab.get("c"))
    }).pipe(Effect.scoped, Effect.provide(VercelRuntimeCache.layerBacking)),
  )

  it.effect("sends whole-second TTLs, a hashed store tag, and no name", () =>
    Effect.gen(function* () {
      const sets: Array<{ key: string; name?: string; ttl?: number; tags?: Array<string> }> = []
      const cache: RuntimeCache = {
        get: async () => null,
        set: async (key, _value, options) => void sets.push({ key, ...options }),
        delete: async () => {},
        expireTag: async () => {},
      }
      const store = yield* VercelRuntimeCache.makeBacking(cache).make("users")
      yield* store.set("a", {}, Duration.millis(1500))
      yield* store.set("b", {}, undefined)
      const tags = [`effect-persistence:${createHash("sha256").update("users").digest("hex")}`]
      assert.deepStrictEqual(sets, [
        { key: '["users","a"]', name: "", ttl: 2, tags },
        { key: '["users","b"]', name: "", tags },
      ])
    }).pipe(Effect.scoped),
  )
})
