/**
 * The OIDC token Vercel issues to a deployment.
 *
 * `ambientToken` reads the token the platform provides. In Functions it
 * arrives on each request as the `x-vercel-oidc-token` header and rotates, so
 * it is read on every run, never cached. In builds and after `vercel env pull`
 * it is `VERCEL_OIDC_TOKEN`. Use it to authenticate to the AI Gateway, or
 * exchange it for cloud credentials (AWS `AssumeRoleWithWebIdentity`, GCP
 * workload identity federation).
 *
 * @example
 * ```ts
 * import * as Oidc from "effect-vercel/Oidc"
 * import { Effect, Redacted } from "effect"
 *
 * const program = Effect.gen(function* () {
 *   const token = yield* Oidc.ambientToken
 *   // pass Redacted.value(token) as the web identity token
 * })
 * ```
 */

import { Config, Data, Effect, Redacted } from "effect"

/** The environment variable read when no request carries a token. */
export const TOKEN_ENV = "VERCEL_OIDC_TOKEN"

/** No usable OIDC token. */
export class OidcError extends Data.TaggedError("VercelOidcError")<{
  readonly message: string
  readonly hints: ReadonlyArray<string>
  readonly cause?: unknown
}> {}

/** How to make a token available. */
export const hints: ReadonlyArray<string> = [
  "Run on Vercel, where each request carries an OIDC token.",
  `Or run \`vercel env pull\` locally to populate ${TOKEN_ENV}.`,
]

/**
 * Vercel exposes the current request's context on a well-known global symbol.
 * In Functions, the request's headers live there. `@vercel/oidc` reads the
 * same place.
 */
const REQUEST_CONTEXT = Symbol.for("@vercel/request-context")

type RequestContext = { readonly headers?: Record<string, string | undefined> }

/** The `x-vercel-oidc-token` header of the current request, if set. */
const requestToken = (): string | undefined => {
  const holder = globalThis as typeof globalThis & {
    [REQUEST_CONTEXT]?: { get?: () => RequestContext | undefined }
  }
  const token = holder[REQUEST_CONTEXT]?.get?.()?.headers?.["x-vercel-oidc-token"]
  return token === "" ? undefined : token
}

const envToken = Config.NonEmptyString(TOKEN_ENV).pipe(Config.map(Redacted.make))

/**
 * The ambient token: the request header, else `VERCEL_OIDC_TOKEN`. Empty
 * values count as unset. Fails when neither is set. Does not refresh an
 * expired local token; re-run `vercel env pull`.
 */
export const ambientToken: Effect.Effect<Redacted.Redacted<string>, OidcError> = Effect.suspend(
  () => {
    const token = requestToken()
    if (token !== undefined) return Effect.succeed(Redacted.make(token))
    return Effect.mapError(
      envToken,
      (cause) => new OidcError({ message: "No Vercel OIDC token is available.", hints, cause }),
    )
  },
)
