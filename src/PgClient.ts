/**
 * `@effect/sql-pg` for Vercel Functions: a pool that keeps the instance up
 * while it has a connection open.
 *
 * Vercel freezes an instance once no request or `waitUntil` promise is left.
 * A frozen instance keeps its sockets, so a pooler like PgBouncer keeps
 * counting them as clients until the instance wakes up or dies. With many
 * instances, as during a deploy, they fill up `max_client_conn`.
 * `attachDatabasePool` from `@vercel/functions` waits out the idle timeout
 * after each release, but it only supports node-postgres-like pools, and the
 * Effect pool closes idle connections up to twice its `idleTimeout` after
 * their last use. So this layer counts the pool's sockets and waits until
 * the last one closes.
 *
 * @example
 * ```ts
 * import * as PgClient from "effect-vercel/PgClient"
 * import { Redacted } from "effect"
 *
 * const SqlLive = PgClient.layer({
 *   url: Redacted.make(process.env.DATABASE_URL!),
 *   idleTimeout: "5 seconds",
 * })
 * ```
 */

import * as Net from "node:net"
import { PgClient } from "@effect/sql-pg"
import { Duration, Effect, Layer, Redacted } from "effect"
import { constVoid } from "effect/Function"
import { currentRequest } from "./internal/requestContext.js"

/**
 * Keeps the instance up while a tracked socket is open. One `waitUntil`
 * promise holds it, and `follow` moves it to the request running now, as
 * `attachDatabasePool` does, so a busy instance never holds a finished
 * request open. The wait also ends a second before the request's deadline.
 * Outside a request, `follow` keeps the wait where it is.
 */
const makeKeepAlive = () => {
  let open = 0
  let release = constVoid

  const follow = () => {
    const request = currentRequest()
    if (open === 0 || request?.waitUntil === undefined) return
    release()
    const cutoff = Date.parse(request.deadline ?? "") - 1_000
    request.waitUntil(
      new Promise<void>((resolve) => {
        const timer = Number.isNaN(cutoff) ? undefined : setTimeout(resolve, cutoff - Date.now())
        release = () => {
          clearTimeout(timer)
          resolve()
        }
      }),
    )
  }

  const track = (socket: Net.Socket) => {
    open++
    follow()
    socket.once("close", () => {
      if (--open === 0) release()
    })
    return socket
  }

  return { follow, track }
}

/** `PgClient.PgPoolConfig` without `stream`, which this module sets. */
export type Config<R = never> = Omit<PgClient.PgPoolConfig<R>, "stream">

/**
 * Opens the TCP or Unix socket `@effect/sql-pg` would open for `config`.
 * It still runs TLS and the startup on it.
 */
const connect = (config: Config<unknown>): Net.Socket => {
  const url = config.url && new URL(Redacted.value(config.url))
  const param = (name: string) => url?.searchParams.getAll(name).at(-1)
  const urlHost = url?.hostname && decodeURIComponent(url.hostname.replace(/^\[(.*)\]$/, "$1"))
  const host = config.host ?? param("host") ?? (urlHost || "localhost")
  const port = config.port ?? Number(param("port") ?? (url?.port || 5432))
  const path = config.path ?? (host.startsWith("/") ? `${host}/.s.PGSQL.${port}` : undefined)
  if (path !== undefined) return Net.connect({ path })
  return Net.connect({
    host,
    port,
    noDelay: true,
    ...(config.keepAlive !== undefined && {
      keepAlive: true,
      keepAliveInitialDelay: Duration.toMillis(Duration.fromInputUnsafe(config.keepAlive)),
    }),
  })
}

/**
 * `PgClient.layer` from `@effect/sql-pg` that keeps the Function instance up
 * until the pool has closed every connection, or the request's deadline
 * comes. Off Vercel it behaves like the plain layer.
 *
 * It opens each socket itself, through the `stream` option, and moves the
 * wait to the request that takes each connection, through `onAcquire`. An
 * `onAcquire` in `config` still runs, after that.
 */
export const layer = <R = never>(config: Config<R>) =>
  Layer.suspend(() => {
    const keepAlive = makeKeepAlive()
    const follow = Effect.sync(keepAlive.follow)
    return PgClient.layer({
      ...config,
      stream: () => keepAlive.track(connect(config)),
      onAcquire: config.onAcquire ? Effect.andThen(follow, config.onAcquire) : follow,
    })
  })
