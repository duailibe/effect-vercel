import { assert, describe, it } from "@effect/vitest"
import { Effect, Exit, Layer, Scope, Stream } from "effect"
import { HttpRouter, HttpServerResponse } from "effect/http"
import { OtlpExporter } from "effect/observability"
import { TestClock } from "effect/testing"
import * as VercelOtlp from "../src/Otlp.js"
import { fakeRequests, isSettled } from "./requestContext.js"

/** A `Flusher` whose `flush` counts each call, then runs `flush`. */
const countingFlusher = (flush: Effect.Effect<void> = Effect.void) => {
  let flushes = 0
  const service = OtlpExporter.Flusher.of({
    flush: Effect.suspend(() => {
      flushes++
      return flush
    }),
    register: () => Effect.void,
  })
  return { service, flushes: () => flushes }
}

describe("Otlp", () => {
  it.effect("flushes after a streamed body is sent", () =>
    Effect.gen(function* () {
      const promises = (yield* fakeRequests).enter()
      const flusher = countingFlusher()
      const { promise: bodyReady, resolve: sendBody } = Promise.withResolvers<void>()
      const route = HttpRouter.add(
        "GET",
        "/",
        HttpServerResponse.stream(
          Stream.fromEffect(
            Effect.promise(() => bodyReady).pipe(Effect.as(new TextEncoder().encode("ok"))),
          ),
        ),
      )
      const { handler, dispose } = HttpRouter.toWebHandler(
        Layer.merge(route, VercelOtlp.flushAfterRequest).pipe(
          Layer.provide(Layer.succeed(OtlpExporter.Flusher, flusher.service)),
        ),
        { disableLogger: true },
      )
      yield* Effect.addFinalizer(() => Effect.promise(dispose))

      const response = yield* Effect.promise(() => handler(new Request("http://localhost/")))
      assert.strictEqual(promises.length, 1)
      assert.isFalse(yield* isSettled(promises[0]!, 10))
      assert.strictEqual(flusher.flushes(), 0)

      sendBody()
      assert.strictEqual(yield* Effect.promise(() => response.text()), "ok")
      yield* Effect.promise(() => promises[0]!)
      assert.strictEqual(flusher.flushes(), 1)
    }),
  )

  it.effect("waits for the flush for at most 2 seconds", () =>
    Effect.gen(function* () {
      const promises = (yield* fakeRequests).enter()
      const flusher = countingFlusher(Effect.never)
      const scope = yield* Scope.make()
      yield* VercelOtlp.flushOnClose.pipe(
        Scope.provide(scope),
        Effect.provideService(OtlpExporter.Flusher, flusher.service),
      )

      yield* Scope.close(scope, Exit.void)
      yield* Effect.yieldNow
      assert.strictEqual(flusher.flushes(), 1)

      yield* TestClock.adjust("1999 millis")
      assert.isFalse(yield* isSettled(promises[0]!))
      yield* TestClock.adjust("1 millis")
      assert.isTrue(yield* isSettled(promises[0]!))
    }),
  )

  it.effect("does nothing off Vercel", () =>
    Effect.gen(function* () {
      const flusher = countingFlusher()
      yield* VercelOtlp.flushOnClose.pipe(
        Effect.scoped,
        Effect.provideService(OtlpExporter.Flusher, flusher.service),
      )
      yield* Effect.yieldNow
      assert.strictEqual(flusher.flushes(), 0)
    }),
  )
})
