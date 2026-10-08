# effect-vercel

[Effect](https://effect.website) (v4) integrations for Vercel. Each module is its own entry
point, imported as a namespace like Effect's own modules:

```ts
import * as AiGateway from "effect-vercel/AiGateway"
```

| Module                               | What                                                                            |
| ------------------------------------ | ------------------------------------------------------------------------------- |
| `effect-vercel/AiGateway`            | [Vercel AI Gateway](https://vercel.com/docs/ai-gateway) for Effect AI           |
| `effect-vercel/AiGatewayCredentials` | How AI Gateway requests authenticate                                            |
| `effect-vercel/Functions`            | Bindings for `@vercel/functions`: `waitUntil`                                   |
| `effect-vercel/Oidc`                 | The OIDC token Vercel issues to a deployment                                    |
| `effect-vercel/RuntimeCache`         | [Runtime Cache](https://vercel.com/docs/runtime-cache) for Effect `Persistence` |

## Install

```sh
pnpm add effect-vercel effect
pnpm add @effect/ai-anthropic   # only for effect-vercel/AiGateway
pnpm add @vercel/functions      # only for effect-vercel/Functions and RuntimeCache
```

## AI Gateway

The gateway serves the Anthropic Messages API and routes to any model it lists, named
`provider/model`. `AiGateway` points Effect AI's Anthropic provider at the gateway, handles
authentication per request, and smooths over the small differences between the gateway's
dialect and what the provider's schemas expect.

### Usage

```ts
import * as AiGateway from "effect-vercel/AiGateway"
import { AnthropicLanguageModel } from "@effect/ai-anthropic"
import { Effect, Layer } from "effect"
import { LanguageModel } from "effect/ai"
import { FetchHttpClient } from "effect/http"

const Model = AnthropicLanguageModel.layer({ model: "google/gemini-2.5-flash" }).pipe(
  Layer.provide(AiGateway.layer),
  Layer.provide(FetchHttpClient.layer),
)

const program = LanguageModel.generateText({ prompt: "Say hi" }).pipe(
  Effect.map((r) => r.text),
  Effect.provide(Model),
)
```

`AiGateway.layer` provides `AnthropicClient` and requires an `HttpClient`. It authenticates
with `AI_GATEWAY_API_KEY` if set, else the Vercel OIDC token, the same order as Vercel's own
SDK. So it works locally with an API key and on Vercel with no setup.

Any Effect AI feature that works with the Anthropic provider (tools, structured output,
streaming, thinking) works through the gateway, for every model the gateway offers.

### Credentials

To pick the source yourself, use `AiGateway.layerWithoutCredentials` and provide an
`AiGatewayCredentials` layer:

```ts
import * as AiGatewayCredentials from "effect-vercel/AiGatewayCredentials"

AnthropicLanguageModel.layer({ model: "google/gemini-2.5-flash" }).pipe(
  Layer.provide(AiGateway.layerWithoutCredentials),
  Layer.provide([AiGatewayCredentials.layerFromApiKey(key), FetchHttpClient.layer]),
)
```

| Layer                                       | Source                                                    |
| ------------------------------------------- | --------------------------------------------------------- |
| `AiGatewayCredentials.layer`                | The default: `layerFromEnv`, then `layerFromOidc`.        |
| `AiGatewayCredentials.layerFromEnv`         | `AI_GATEWAY_API_KEY`. Local dev, CI, anywhere off Vercel. |
| `AiGatewayCredentials.layerFromOidc`        | The Vercel OIDC token (see [OIDC](#oidc)).                |
| `AiGatewayCredentials.layerFromApiKey(key)` | A fixed key. Tests, custom wiring.                        |

The credential is resolved on every request, so a rotating token is always current.
Each request carries `x-api-key` and `ai-gateway-auth-method` (`api-key` or `oidc`). A
missing credential fails the request with an `AiError` wrapping an `AiGatewayCredentialsError` that
names the source it tried and how to fix it.

Environment variables are read through Effect's `Config`, so a `ConfigProvider` can redirect
them.

### Dialect fixes

Two adjustments are applied to traffic with the gateway:

- Requests: `"cache_control": null` is removed from content blocks. The Effect provider emits it,
  Anthropic accepts it, the gateway rejects it.
- Responses: keys Anthropic always sends but the gateway omits are filled in with Anthropic's
  "nothing to report" values, so the provider's schemas decode. These are the cache and
  service-tier usage fields, `signature` on thinking blocks from non-Anthropic models, and
  `type`/`request_id` on error envelopes (unknown `error.type` values map to `api_error`).

Streaming responses pass through untouched.

## OIDC

Vercel issues each deployment an OIDC token. Use it for the AI Gateway, or exchange it for
cloud credentials (AWS `AssumeRoleWithWebIdentity`, GCP workload identity federation).

```ts
import * as Oidc from "effect-vercel/Oidc"
import { Effect, Redacted } from "effect"

const program = Effect.gen(function* () {
  const token = yield* Oidc.ambientToken
  // Redacted.value(token) is the web identity token
})
```

`Oidc.ambientToken` reads the `x-vercel-oidc-token` header of the current request
(Functions), else `VERCEL_OIDC_TOKEN` (builds, `vercel env pull`). Empty values count as
unset. It fails with an `OidcError` when neither is set.

It reads the token on every run, since it rotates per request. It does not refresh an
expired local token; re-run `vercel env pull`.

## Functions

`Functions.waitUntil(fiber)` keeps the Function running until `fiber` ends, as `waitUntil`
from `@vercel/functions` does for a promise. Use it to finish work after the response is sent.

```ts
import * as Functions from "effect-vercel/Functions"
import { Effect } from "effect"

const handler = Effect.gen(function* () {
  yield* Effect.forkDetach(sendReceipt).pipe(Effect.tap(Functions.waitUntil))
  return new Response("OK")
})
```

- Fork with `Effect.forkDetach`, or into a scope that outlives the request. A child fiber is
  interrupted when the request fiber ends, whatever `waitUntil` says.
- The fiber keeps the request's services. Acquire resources it needs inside its own
  `Effect.scoped`, since the request's resources may be released first.
- Failures are not reported. Handle or log them in the forked effect.
- Vercel stops the work when the Function reaches its maximum duration.
- Off Vercel, `waitUntil` does nothing and the fiber runs in the background.

## Runtime Cache

`RuntimeCache.layer` provides Effect's `Persistence`, stored in the Vercel Runtime Cache.
Use it with `PersistedCache` to share results across Function instances in a region.

```ts
import * as RuntimeCache from "effect-vercel/RuntimeCache"
import { Effect, Schema } from "effect"
import { Persistable, PersistedCache } from "effect/persistence"

class GetUser extends Persistable.Class<{ payload: { id: number } }>()("GetUser", {
  primaryKey: (req) => `GetUser:${req.id}`,
  success: User,
  error: Schema.Never,
}) {}

const program = Effect.gen(function* () {
  const users = yield* PersistedCache.make(fetchUser, {
    storeId: "users",
    timeToLive: () => "1 hour",
  })
  return yield* users.get(new GetUser({ id: 1 }))
}).pipe(Effect.scoped, Effect.provide(RuntimeCache.layer))
```

- Off Vercel, `@vercel/functions` falls back to an in-memory cache, so the layer works in
  local dev and tests.
- Entries are keyed by `[storeId, primaryKey]`, hashed with SHA-256. Only the hash reaches
  Vercel. `getCache`'s default hash is 32-bit and can collide, so
  `RuntimeCache.makeBacking(cache)` expects a cache with a stronger `keyHashFunction` if
  you build your own.
- Each entry is tagged `effect-persistence:<sha256 of storeId>`. `clear` expires that tag.
- TTLs round up to whole seconds.
- The Runtime Cache swallows its own network errors and timeouts, which then read as misses
  and silently skipped writes, removes and clears. `getCache` has no option to surface them.

## Development

```sh
pnpm install
pnpm test
pnpm check   # tsc
pnpm lint    # oxlint
pnpm fmt     # oxfmt
pnpm build   # tsdown -> dist/
```

## License

MIT
