import { Effect } from "effect"

const REQUEST_CONTEXT = Symbol.for("@vercel/request-context")
const holder = globalThis as Record<PropertyKey, unknown>

/**
 * Fakes the context Vercel gives each request, until the scope closes.
 * `enter` starts a request, with a deadline if given, and returns the
 * promises passed to its `waitUntil`. `leave` ends it, so code runs outside
 * any request.
 */
export const fakeRequests = Effect.acquireRelease(
  Effect.sync(() => {
    let current = {}
    holder[REQUEST_CONTEXT] = { get: () => current }
    const enter = (deadline?: number) => {
      const promises: Array<Promise<unknown>> = []
      current = {
        waitUntil: (promise: Promise<unknown>) => promises.push(promise),
        deadline: deadline && new Date(deadline).toISOString(),
      }
      return promises
    }
    const leave = () => {
      current = {}
    }
    return { enter, leave }
  }),
  () => Effect.sync(() => delete holder[REQUEST_CONTEXT]),
)

/**
 * Whether `promise` settles within `ms`, by default before the event loop
 * gets around to it.
 */
export const isSettled = (promise: Promise<unknown>, ms = 0) =>
  Effect.promise(() =>
    Promise.race([promise.then(() => true), new Promise<boolean>((r) => setTimeout(r, ms, false))]),
  )
