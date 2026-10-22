import { assert, describe, it } from "@effect/vitest"
import { Deferred, Effect, Fiber } from "effect"
import * as Functions from "../src/Functions.js"
import { fakeRequests, isSettled } from "./requestContext.js"

describe("Functions", () => {
  it.effect("waits until the fiber ends", () =>
    Effect.gen(function* () {
      const promises = (yield* fakeRequests).enter()
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
  )

  it.effect("resolves when the fiber fails", () =>
    Effect.gen(function* () {
      const promises = (yield* fakeRequests).enter()
      const fiber = yield* Effect.forkDetach(Effect.fail("boom")).pipe(
        Effect.tap(Functions.waitUntil),
      )
      yield* Fiber.await(fiber)
      assert.isTrue(yield* isSettled(promises[0]!))
    }),
  )
})
