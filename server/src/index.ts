import type { Server } from 'node:http'
import { serverConfigSchema, type ServerConfig } from './config.js'
import { migrate, type MigrationResult } from './db/migrate.js'
import { closePool, createPool } from './db/pool.js'
import { createApp } from './app.js'

export interface RunningServer {
  url: string
  port: number
  migration: MigrationResult
  stop: () => Promise<void>
}

/** Sets up the database if needed, then starts the Express API. Used by Electron (server mode) and the standalone runner. */
export async function startServer(input: ServerConfig): Promise<RunningServer> {
  const config = serverConfigSchema.parse(input)

  const migration = await migrate(config.database, config.sqlDir)
  createPool(config.database)

  const app = createApp(config)
  const server = await new Promise<Server>((resolve, reject) => {
    const listening = app.listen(config.port, config.host, () => resolve(listening))
    listening.once('error', reject)
  })

  const address = server.address()
  const port = typeof address === 'object' && address ? address.port : config.port

  return {
    url: `http://${config.host === '0.0.0.0' ? '127.0.0.1' : config.host}:${port}`,
    port,
    migration,
    stop: async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()))
      await closePool()
    },
  }
}

export type { ServerConfig } from './config.js'
