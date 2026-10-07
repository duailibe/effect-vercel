/**
 * How gateway requests authenticate.
 *
 * `AiGatewayCredentials` holds an effect that produces the credential for one
 * request. It runs per request rather than once at startup: on Vercel the OIDC
 * token arrives on the request context and rotates, so it must not be cached.
 * `layer` is the default; pick a `layerFrom*` layer to use one source only.
 *
 * @example
 * ```ts
 * import * as AiGatewayCredentials from "effect-vercel/AiGatewayCredentials"
 *
 * AiGatewayCredentials.layer                // AI_GATEWAY_API_KEY, else the Vercel OIDC token
 * AiGatewayCredentials.layerFromEnv         // AI_GATEWAY_API_KEY only
 * AiGatewayCredentials.layerFromOidc        // the Vercel OIDC token only
 * AiGatewayCredentials.layerFromApiKey("…") // a fixed value
 * ```
 */

import { Config, Context, Data, Effect, Layer, Option, Redacted } from "effect"
import * as Oidc from "./Oidc.js"

/** The environment variable `layerFromEnv` reads. */
export const API_KEY_ENV = "AI_GATEWAY_API_KEY"

/** Which layer produced or failed to produce a credential. */
export type Source = "api-key" | "env" | "oidc" | "default"

/**
 * A credential ready to put on a request. `method` is what the gateway
 * records as the auth method; it matches the values Vercel's own SDK sends.
 */
export interface Resolved {
  readonly method: "api-key" | "oidc"
  readonly token: Redacted.Redacted<string>
}

/** No credential could be produced for a gateway request. */
export class AiGatewayCredentialsError extends Data.TaggedError("AiGatewayCredentialsError")<{
  readonly message: string
  readonly source: Source
  readonly hints: ReadonlyArray<string>
  readonly cause?: unknown
}> {}

export class AiGatewayCredentials extends Context.Service<
  AiGatewayCredentials,
  Effect.Effect<Resolved, AiGatewayCredentialsError>
>()("effect-vercel/AiGatewayCredentials") {}

/** The request headers that carry `credentials`. */
export const formatHeaders = (credentials: Resolved): Record<string, string> => ({
  "x-api-key": Redacted.value(credentials.token),
  "ai-gateway-auth-method": credentials.method,
})

const hints: Record<Source, ReadonlyArray<string>> = {
  "api-key": [],
  env: [`Set ${API_KEY_ENV} to an AI Gateway API key.`],
  oidc: Oidc.hints,
  default: [
    `Set ${API_KEY_ENV} to an AI Gateway API key.`,
    "Or run on Vercel / `vercel env pull` so an OIDC token is available.",
  ],
}

/** `AI_GATEWAY_API_KEY`, or `None` when unset. Fails only when it can't be read. */
const envApiKey = Config.option(Config.Redacted(API_KEY_ENV)).pipe(
  Effect.mapError(
    (cause) =>
      new AiGatewayCredentialsError({
        message: `Failed to read ${API_KEY_ENV}.`,
        source: "env",
        hints: hints.env,
        cause,
      }),
  ),
)

const fromEnv: Effect.Effect<Resolved, AiGatewayCredentialsError> = Effect.flatMap(
  envApiKey,
  Option.match({
    onNone: () =>
      Effect.fail(
        new AiGatewayCredentialsError({
          message: `${API_KEY_ENV} is not set.`,
          source: "env",
          hints: hints.env,
        }),
      ),
    onSome: (token) => Effect.succeed({ method: "api-key" as const, token }),
  }),
)

const fromOidc: Effect.Effect<Resolved, AiGatewayCredentialsError> = Oidc.ambientToken.pipe(
  Effect.map((token) => ({ method: "oidc" as const, token })),
  Effect.mapError(
    (cause) =>
      new AiGatewayCredentialsError({
        message: cause.message,
        source: "oidc",
        hints: cause.hints,
        cause,
      }),
  ),
)

/** A fixed API key. */
export const layerFromApiKey = (
  apiKey: string | Redacted.Redacted<string>,
): Layer.Layer<AiGatewayCredentials> =>
  Layer.succeed(AiGatewayCredentials)(
    Effect.succeed({
      method: "api-key",
      token: Redacted.isRedacted(apiKey) ? apiKey : Redacted.make(apiKey),
    }),
  )

/** `AI_GATEWAY_API_KEY`: local dev, CI, or anywhere off Vercel. */
export const layerFromEnv: Layer.Layer<AiGatewayCredentials> =
  Layer.succeed(AiGatewayCredentials)(fromEnv)

/** The Vercel OIDC token (see `Oidc.ambientToken`). */
export const layerFromOidc: Layer.Layer<AiGatewayCredentials> =
  Layer.succeed(AiGatewayCredentials)(fromOidc)

/**
 * The default: `layerFromEnv`, then `layerFromOidc`. Same order as
 * Vercel's own SDK, so it works locally with an API key and on Vercel without
 * one. Falls back only when the key is unset, not when it can't be read.
 */
export const layer: Layer.Layer<AiGatewayCredentials> = Layer.succeed(AiGatewayCredentials)(
  Effect.flatMap(
    envApiKey,
    Option.match({
      onNone: () =>
        Effect.mapError(
          fromOidc,
          (cause) =>
            new AiGatewayCredentialsError({
              message: "No AI Gateway credential found.",
              source: "default",
              hints: hints.default,
              cause,
            }),
        ),
      onSome: (token) => Effect.succeed({ method: "api-key" as const, token }),
    }),
  ),
)
