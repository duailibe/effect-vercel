/**
 * Effect bindings for `@vercel/functions`.
 *
 * `waitUntil` keeps the Function running until a fiber ends, so work forked
 * during a request can finish after the response is sent.
 *
 * @example
 * ```ts
 * import * as Functions from "effect-vercel/Functions"
 * import { Effect } from "effect"
 *
 * const handler = Effect.gen(function* () {
 *   yield* Effect.forkDetach(sendReceipt).pipe(Effect.tap(Functions.waitUntil))
 *   return new Response("OK")
 * })
 * ```
 */

import { waitUntil as vercelWaitUntil } from "@vercel/functions"
import { Effect, type Fiber } from "effect"

/**
 * Keeps the Function running until `fiber` ends, as `waitUntil` from
 * `@vercel/functions` does for a promise. Off Vercel it does nothing.
 *
 * The fiber must outlive the request fiber, so fork it with
 * `Effect.forkDetach` or into a scope that outlives the request. A child
 * fiber is interrupted when the request fiber ends. Failures are not
 * reported, so handle them in the forked effect.
 */
export const waitUntil = <A, E>(fiber: Fiber.Fiber<A, E>): Effect.Effect<void> =>
  Effect.sync(() =>
    vercelWaitUntil(new Promise<void>((resolve) => fiber.addObserver(() => resolve()))),
  )
