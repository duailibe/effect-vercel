import { assert, describe, it } from "@effect/vitest"
import { Deferred, Effect, Fiber } from "effect"
import * as Functions from "../src/Functions.js"

const REQUEST_CONTEXT = Symbol.for("@vercel/request-context")

/** Runs `effect` in a fake request context that records `waitUntil` promises. */
const withRequestContext = <A, E, R>(
  effect: (promises: Array<Promise<unknown>>) => Effect.Effect<A, E, R>,
) =>
  Effect.acquireUseRelease(
    Effect.sync(() => {
      const promises: Array<Promise<unknown>> = []
      const holder = globalThis as Record<PropertyKey, unknown>
      holder[REQUEST_CONTEXT] = {
        get: () => ({ waitUntil: (p: Promise<unknown>) => promises.push(p) }),
      }
      return promises
    }),
    effect,
    () => Effect.sync(() => delete (globalThis as Record<PropertyKey, unknown>)[REQUEST_CONTEXT]),
  )

/** Whether `promise` settles before the event loop gets around to it. */
const isSettled = (promise: Promise<unknown>) =>
  Effect.promise(() =>
    Promise.race([promise.then(() => true), new Promise<boolean>((r) => setTimeout(r, 0, false))]),
  )

describe("Functions", () => {
  it.effect("waits until the fiber ends", () =>
    withRequestContext((promises) =>
      Effect.gen(function* () {
        const done = yield* Deferred.make<void>()
        const fiber = yield* Effect.forkDetach(Deferred.await(done)).pipe(
          Effect.tap(Functions.waitUntil),
        )
        assert.strictEqual(promises.length, 1)
        assert.isFalse(yield* isSettled(promises[0]!))

        yield* Deferred.succeed(done, undefined)
        yield* Fiber.await(fiber)
        assert.isTrue(yield* isSettled(promises[0]!))
      }),
    ),
  )

  it.effect("resolves when the fiber fails", () =>
    withRequestContext((promises) =>
      Effect.gen(function* () {
        const fiber = yield* Effect.forkDetach(Effect.fail("boom")).pipe(
          Effect.tap(Functions.waitUntil),
        )
        yield* Fiber.await(fiber)
        assert.isTrue(yield* isSettled(promises[0]!))
      }),
    ),
  )
})
