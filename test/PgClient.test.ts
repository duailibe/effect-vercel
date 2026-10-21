import * as Net from "node:net"
import { assert, describe, it } from "@effect/vitest"
import { Effect, Layer, Queue, Redacted } from "effect"
import { SqlClient, Statement } from "effect/sql"
import * as PgClient from "../src/PgClient.js"
import { fakeRequests, isSettled } from "./requestContext.js"

/**
 * A stand-in for Postgres that accepts connections and never answers, so
 * each statement waits on its connection while the socket stays open.
 */
const silentServer = Effect.acquireRelease(
  Effect.gen(function* () {
    const connections = yield* Queue.unbounded<Net.Socket>()
    const sockets = new Set<Net.Socket>()
    const server = Net.createServer((socket) => {
      sockets.add(socket)
      Queue.offerUnsafe(connections, socket)
    })
    yield* Effect.promise(() => new Promise<void>((r) => server.listen(0, "127.0.0.1", r)))
    const { port } = server.address() as Net.AddressInfo
    const layer = PgClient.layer({
      url: Redacted.make(`postgres://test@127.0.0.1:${port}/test?sslmode=disable`),
      maxConnections: 1,
    })
    return { connections, sockets, server, layer }
  }),
  ({ sockets, server }) =>
    Effect.promise(() => {
      for (const socket of sockets) socket.destroy()
      return new Promise<void>((r) => server.close(() => r()))
    }),
)

describe("PgClient", () => {
  it.effect("keeps the instance up until the pool's socket closes", () =>
    Effect.gen(function* () {
      const promises = (yield* fakeRequests)()
      const server = yield* silentServer
      yield* Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* Effect.forkChild(sql`select 1`)
        const socket = yield* Queue.take(server.connections)
        assert.strictEqual(promises.length, 1)
        assert.isFalse(yield* isSettled(promises[0]!))

        socket.destroy()
        yield* Effect.promise(() => promises[0]!)
      }).pipe(Effect.provide(server.layer))
    }),
  )

  it.effect("moves the wait to the request running each statement", () =>
    Effect.gen(function* () {
      const enter = yield* fakeRequests
      const server = yield* silentServer
      yield* Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        const first = enter()
        yield* Effect.forkChild(sql`select 1`)
        yield* Queue.take(server.connections)

        const second = enter()
        yield* Effect.forkChild(sql`select 2`, { startImmediately: true })
        assert.isTrue(yield* isSettled(first[0]!))
        assert.strictEqual(second.length, 1)
        assert.isFalse(yield* isSettled(second[0]!))
      }).pipe(Effect.provide(server.layer))
    }),
  )

  it.effect("ends the wait a second before the request's deadline", () =>
    Effect.gen(function* () {
      const promises = (yield* fakeRequests)(Date.now() + 1_000)
      const server = yield* silentServer
      yield* Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* Effect.forkChild(sql`select 1`)
        yield* Queue.take(server.connections)
        yield* Effect.promise(() => promises[0]!)
      }).pipe(Effect.provide(server.layer))
    }),
  )

  it.effect("runs the transformer it is provided with", () =>
    Effect.gen(function* () {
      const server = yield* silentServer
      const statements: Array<string> = []
      const transformer: Statement.Transformer = (statement) =>
        Effect.sync(() => {
          statements.push(statement.compile()[0])
          return statement
        })
      yield* Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* Effect.forkChild(sql`select 1`, { startImmediately: true })
        assert.deepStrictEqual(statements, ["select 1"])
      }).pipe(
        Effect.provide(
          server.layer.pipe(
            Layer.provide(Layer.succeed(Statement.CurrentTransformer)(transformer)),
          ),
        ),
      )
    }),
  )
})
