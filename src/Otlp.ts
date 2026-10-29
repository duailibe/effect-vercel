/**
 * Keeps a Vercel Function running until its OTLP telemetry is exported.
 *
 * Effect's OTLP exporters buffer spans, logs and metrics and export them on
 * an interval. Vercel can suspend the instance once the response is sent, so
 * the interval may never fire and the telemetry is lost. These flush the
 * exporters when a request ends and keep the Function running until the
 * flush is done.
 *
 * @example
 * ```ts
 * import * as VercelOtlp from "effect-vercel/Otlp"
 * import { Layer } from "effect"
 * import { FetchHttpClient, HttpRouter } from "effect/http"
 * import { Otlp } from "effect/observability"
 *
 * const { handler } = HttpRouter.toWebHandler(
 *   Layer.merge(Routes, VercelOtlp.flushAfterRequest).pipe(
 *     Layer.provideMerge(Otlp.layerJson({ baseUrl, resource })),
 *     Layer.provide(FetchHttpClient.layer),
 *   ),
 * )
 * ```
 */

import { Effect, type Layer, type Scope } from "effect"
import { HttpRouter } from "effect/http"
import { OtlpExporter } from "effect/observability"
import { currentRequest } from "./internal/requestContext.js"

const flushOnCloseWith = (flusher: OtlpExporter.Flusher["Service"]) =>
  Effect.suspend(() => {
    const request = currentRequest()
    if (request?.waitUntil === undefined) return Effect.void
    const { promise, resolve } = Promise.withResolvers<void>()
    request.waitUntil(promise)
    // Forked, so a streamed body ends without waiting for the export.
    return Effect.addFinalizer(() =>
      flusher.flush.pipe(
        Effect.timeoutOption("2 seconds"),
        Effect.ensuring(Effect.sync(resolve)),
        Effect.forkDetach,
      ),
    )
  }).pipe(
    // An interrupt before the finalizer is added would leave the wait open.
    Effect.uninterruptible,
  )

/**
 * When the current scope closes, flushes the OTLP exporters and keeps the
 * Function running until the flush ends, for at most 2 seconds.
 *
 * It registers the wait with Vercel right away, so run it while the request
 * is current. Run it first in the scope: finalizers added later, such as
 * ending a span, run before the flush. Off Vercel, or outside a request, it
 * does nothing, and the exporters' interval sends the telemetry.
 *
 * Use `flushAfterRequest` for an `HttpRouter` app. Use this one when the
 * request has another entry point, with a scope that closes when it ends.
 */
export const flushOnClose: Effect.Effect<void, never, OtlpExporter.Flusher | Scope.Scope> =
  Effect.flatMap(OtlpExporter.Flusher, flushOnCloseWith)

/**
 * Global `HttpRouter` middleware that runs `flushOnClose` in each request's
 * scope. That scope closes after the response body is sent, so telemetry
 * recorded while a body streams is in the flush.
 */
export const flushAfterRequest: Layer.Layer<
  never,
  never,
  HttpRouter.HttpRouter | OtlpExporter.Flusher
> = HttpRouter.middleware(
  Effect.map(
    OtlpExporter.Flusher,
    (flusher) => (httpEffect) => Effect.andThen(flushOnCloseWith(flusher), httpEffect),
  ),
  { global: true },
)
