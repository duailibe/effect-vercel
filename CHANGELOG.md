# Changelog

## [0.7.0](https://github.com/duailibe/effect-vercel/compare/effect-vercel-v0.6.0...effect-vercel-v0.7.0) (2026-10-29)


### Features

* keep Vercel Functions running until their OTLP telemetry is exported ([#13](https://github.com/duailibe/effect-vercel/issues/13)) ([3c7658e](https://github.com/duailibe/effect-vercel/commit/3c7658e98654b2cd1d763d1e4c284e475e79cd9c))

## [0.6.0](https://github.com/duailibe/effect-vercel/compare/effect-vercel-v0.5.0...effect-vercel-v0.6.0) (2026-10-22)


### Features

* add PgClient layer that keeps instances up while connections are open ([#11](https://github.com/duailibe/effect-vercel/issues/11)) ([9459074](https://github.com/duailibe/effect-vercel/commit/9459074f0bc8ede36af61e1fa4b1748d4f16b1c1))

## [0.5.0](https://github.com/duailibe/effect-vercel/compare/effect-vercel-v0.4.0...effect-vercel-v0.5.0) (2026-10-08)


### Features

* add Functions.waitUntil to keep a Function running until a fiber ends ([#9](https://github.com/duailibe/effect-vercel/issues/9)) ([0b4cf52](https://github.com/duailibe/effect-vercel/commit/0b4cf526c10409ff67e6435c39f073e307c3778a))

## [0.4.0](https://github.com/duailibe/effect-vercel/compare/effect-vercel-v0.3.0...effect-vercel-v0.4.0) (2026-10-07)


### ⚠ BREAKING CHANGES

* `VercelOidc.token` is now `Oidc.ambientToken` and `VercelOidc.find` is removed. The barrel entry points `ai-gateway`, `oidc` and `runtime-cache` are replaced by `AiGateway`, `AiGatewayCredentials`, `Oidc` and `RuntimeCache`, imported as namespaces. `layerFromVercelOidc` is now `layerFromOidc`.

### Features

* rename the OIDC token to ambientToken and export one entry point per module ([#7](https://github.com/duailibe/effect-vercel/issues/7)) ([6159578](https://github.com/duailibe/effect-vercel/commit/61595784b6d8128bc6853d1211c48b8ced7c365a))

## [0.3.0](https://github.com/duailibe/effect-vercel/compare/effect-vercel-v0.2.0...effect-vercel-v0.3.0) (2026-10-01)


### ⚠ BREAKING CHANGES

* update Effect to 4.0.0 ([#5](https://github.com/duailibe/effect-vercel/issues/5))

### Features

* update Effect to 4.0.0 ([#5](https://github.com/duailibe/effect-vercel/issues/5)) ([fd917ac](https://github.com/duailibe/effect-vercel/commit/fd917ac9a4c152b1d34d1f0aea81d90c44782388))

## [0.2.0](https://github.com/duailibe/effect-vercel/compare/effect-vercel-v0.1.0...effect-vercel-v0.2.0) (2026-09-30)


### ⚠ BREAKING CHANGES

* requires effect and @effect/ai-anthropic 4.0.0-rc.118.

### Features

* update Effect to 4.0.0-rc.118 ([#3](https://github.com/duailibe/effect-vercel/issues/3)) ([047453b](https://github.com/duailibe/effect-vercel/commit/047453bc51ff89c025a35334b99d39362aeb8061))

## 0.1.0 (2026-09-23)


### Features

* add a Vercel Runtime Cache backend for Effect Persistence ([#2](https://github.com/duailibe/effect-vercel/issues/2)) ([b779b0f](https://github.com/duailibe/effect-vercel/commit/b779b0f33c50294c800af81c45c518a8e94a5718))
* initial release ([2de0bc1](https://github.com/duailibe/effect-vercel/commit/2de0bc195172157e56ce8cb94607998ecd07db94))
