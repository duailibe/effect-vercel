/**
 * Vercel exposes the current request's context on a well-known global symbol.
 * `@vercel/functions` reads `waitUntil` and the deadline from there. Off
 * Vercel, or outside a request, there is no `waitUntil`.
 */
const REQUEST_CONTEXT = Symbol.for("@vercel/request-context")

type RequestContext = {
  readonly waitUntil?: (promise: Promise<unknown>) => void
  readonly deadline?: string
}

export const currentRequest = (): RequestContext | undefined => {
  const holder = globalThis as typeof globalThis & {
    [REQUEST_CONTEXT]?: { get?: () => RequestContext | undefined }
  }
  return holder[REQUEST_CONTEXT]?.get?.()
}
