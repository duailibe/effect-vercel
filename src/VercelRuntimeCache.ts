/**
 * Effect `Persistence` backed by the Vercel Runtime Cache, so a
 * `PersistedCache` shares results across Function instances in a region.
 *
 * Outside Vercel, `getCache` falls back to an in-memory cache, so the same
 * layer works in local dev and tests.
 *
 * @example
 * ```ts
 * import { VercelRuntimeCache } from "effect-vercel/runtime-cache"
 * import { Effect } from "effect"
 * import { PersistedCache } from "effect/unstable/persistence"
 *
 * const program = Effect.gen(function* () {
 *   const users = yield* PersistedCache.make(fetchUser, {
 *     storeId: "users",
 *     timeToLive: () => "1 hour",
 *   })
 *   return yield* users.get(new GetUser({ id: 1 }))
 * }).pipe(Effect.scoped, Effect.provide(VercelRuntimeCache.layer))
 * ```
 */

import { createHash } from "node:crypto"
import { getCache, type RuntimeCache } from "@vercel/functions"
import { Duration, Effect, Layer } from "effect"
import { Persistence } from "effect/unstable/persistence"

const sha256 = (key: string) => createHash("sha256").update(key).digest("hex")

/**
 * A `BackingPersistence` over `cache`.
 *
 * Entries are keyed `storeId:key` and tagged with the store id, so `clear`
 * expires that tag. TTLs round up to whole seconds, the cache's resolution.
 *
 * `getCache()` hashes keys with a 32-bit hash by default, which can collide.
 * Pass a cache made with a stronger `keyHashFunction`, as `layerBacking` does.
 */
export const makeBacking = (cache: RuntimeCache): Persistence.BackingPersistence["Service"] =>
  Persistence.BackingPersistence.of({
    make: (storeId) =>
      Effect.sync(() => {
        const prefixed = (key: string) => `${storeId}:${key}`
        const tags = [storeId]

        const get = (key: string) =>
          Effect.tryPromise({
            try: () => cache.get(prefixed(key)),
            catch: (cause) =>
              new Persistence.PersistenceError({ message: `Failed to get key ${key}`, cause }),
          }).pipe(
            Effect.map((value) =>
              typeof value === "object" && value !== null ? value : undefined,
            ),
          )

        const set = (key: string, value: object, ttl: Duration.Duration | undefined) =>
          Effect.tryPromise({
            try: () =>
              cache.set(prefixed(key), value, {
                tags,
                ...(ttl && { ttl: Math.max(1, Math.ceil(Duration.toSeconds(ttl))) }),
              }),
            catch: (cause) =>
              new Persistence.PersistenceError({ message: `Failed to set key ${key}`, cause }),
          })

        return {
          get,
          getMany: (keys) => Effect.forEach(keys, get, { concurrency: "unbounded" }),
          set,
          setMany: (entries) =>
            Effect.forEach(entries, ([key, value, ttl]) => set(key, value, ttl), {
              concurrency: "unbounded",
              discard: true,
            }),
          remove: (key) =>
            Effect.tryPromise({
              try: () => cache.delete(prefixed(key)),
              catch: (cause) =>
                new Persistence.PersistenceError({ message: `Failed to remove key ${key}`, cause }),
            }),
          clear: Effect.tryPromise({
            try: () => cache.expireTag(storeId),
            catch: (cause) =>
              new Persistence.PersistenceError({ message: `Failed to clear ${storeId}`, cause }),
          }),
        }
      }),
  })

/** `BackingPersistence` over `getCache()`, with SHA-256 key hashing. */
export const layerBacking: Layer.Layer<Persistence.BackingPersistence> = Layer.sync(
  Persistence.BackingPersistence,
)(() => makeBacking(getCache({ keyHashFunction: sha256 })))

/** `Persistence` backed by the Vercel Runtime Cache. */
export const layer: Layer.Layer<Persistence.Persistence> = Persistence.layer.pipe(
  Layer.provide(layerBacking),
)
