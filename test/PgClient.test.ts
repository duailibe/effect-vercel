import * as Net from "node:net"
import { assert, describe, it } from "@effect/vitest"
import { Context, Effect, Layer, Redacted } from "effect"
import { SqlClient, type SqlError } from "effect/sql"
import * as PgClient from "../src/PgClient.js"
import { fakeRequests, isSettled } from "./requestContext.js"

/** A backend message: its tag, length and body. */
const message = (tag: string, body = "") => {
  const frame = Buffer.alloc(5 + body.length)
  frame.write(tag)
  frame.writeInt32BE(4 + body.length, 1)
  frame.write(body, 5, "latin1")
  return frame
}

const ready = message("Z", "I")

/** The reply to each frontend message of the extended query protocol. */
const replies: Record<string, Buffer> = {
  P: message("1"),
  B: message("2"),
  D: message("n"),
  E: message("C", "SELECT 0\0"),
  C: message("3"),
  S: ready,
}

/**
 * A stand-in for Postgres that lets anyone in and answers each statement
 * with no rows. Its sockets stay open until the pool or the test closes them.
 */
const fakePostgres = Effect.acquireRelease(
  Effect.gen(function* () {
    const sockets: Array<Net.Socket> = []
    const server = Net.createServer((socket) => {
      sockets.push(socket)
      let buffer = Buffer.alloc(0)
      let started = false
      socket.on("data", (chunk) => {
        buffer = Buffer.concat([buffer, chunk])
        // The startup message is the only one without a tag.
        const offset = started ? 1 : 0
        while (
          buffer.length >= offset + 4 &&
          buffer.length >= offset + buffer.readInt32BE(offset)
        ) {
          const tag = String.fromCharCode(buffer[0]!)
          buffer = buffer.subarray(offset + buffer.readInt32BE(offset))
          if (!started) {
            started = true
            socket.write(Buffer.concat([message("R", "\0\0\0\0"), ready]))
            return
          }
          const reply = replies[tag]
          if (reply) socket.write(reply)
        }
      })
    })
    yield* Effect.promise(() => new Promise<void>((r) => server.listen(0, "127.0.0.1", r)))
    const { port } = server.address() as Net.AddressInfo
    const config: PgClient.Config = {
      url: Redacted.make(`postgres://test@127.0.0.1:${port}/test?sslmode=disable`),
      maxConnections: 1,
    }
    return { sockets, server, config, layer: PgClient.layer(config) }
  }),
  ({ sockets, server }) =>
    Effect.promise(() => {
      for (const socket of sockets) socket.destroy()
      return new Promise<void>((r) => server.close(() => r()))
    }),
)

/** A service built on the client, the way apps compose them. */
class Repo extends Context.Service<
  Repo,
  { readonly select: Effect.Effect<unknown, SqlError.SqlError> }
>()("Repo") {
  static readonly layer = Layer.effect(
    Repo,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      return { select: sql`select 1` }
    }),
  )
}

describe("PgClient", () => {
  it.effect("keeps the instance up until the pool's socket closes", () =>
    Effect.gen(function* () {
      const promises = (yield* fakeRequests).enter()
      const server = yield* fakePostgres
      yield* Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* sql`select 1`
        assert.isFalse(yield* isSettled(promises.at(-1)!))

        server.sockets[0]!.destroy()
        yield* Effect.promise(() => promises.at(-1)!)
      }).pipe(Effect.provide(server.layer))
    }),
  )

  it.effect("moves the wait to each request that takes a connection", () =>
    Effect.gen(function* () {
      const { enter } = yield* fakeRequests
      const server = yield* fakePostgres
      yield* Effect.gen(function* () {
        const repo = yield* Repo
        const first = enter()
        yield* repo.select
        const second = enter()
        yield* repo.select

        assert.strictEqual(server.sockets.length, 1)
        assert.isTrue(yield* isSettled(Promise.all(first)))
        assert.strictEqual(second.length, 1)
        assert.isFalse(yield* isSettled(second[0]!))
      }).pipe(Effect.provide(Repo.layer.pipe(Layer.provide(server.layer))))
    }),
  )

  it.effect("keeps the wait when a statement runs outside a request", () =>
    Effect.gen(function* () {
      const { enter, leave } = yield* fakeRequests
      const server = yield* fakePostgres
      yield* Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        const promises = enter()
        yield* sql`select 1`
        leave()
        yield* sql`select 2`
        assert.isFalse(yield* isSettled(promises.at(-1)!))
      }).pipe(Effect.provide(server.layer))
    }),
  )

  it.effect("ends the wait a second before the request's deadline", () =>
    Effect.gen(function* () {
      const promises = (yield* fakeRequests).enter(Date.now() + 1_100)
      const server = yield* fakePostgres
      yield* Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* sql`select 1`
        assert.isFalse(yield* isSettled(promises.at(-1)!))
        // The socket stays open, so only the cutoff, about 100ms away, ends it.
        assert.isTrue(yield* isSettled(promises.at(-1)!, 600))
      }).pipe(Effect.provide(server.layer))
    }),
  )

  it.effect("runs the onAcquire it is given", () =>
    Effect.gen(function* () {
      const server = yield* fakePostgres
      let acquired = 0
      const onAcquire = Effect.sync(() => {
        acquired++
      })
      yield* Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* sql`select 1`
        yield* sql`select 2`
        assert.strictEqual(acquired, 2)
      }).pipe(Effect.provide(PgClient.layer({ ...server.config, onAcquire })))
    }),
  )
})
