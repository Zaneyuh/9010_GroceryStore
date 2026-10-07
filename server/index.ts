import type { Server } from 'node:http'
import { createApp } from './app.js'
import { closePool, createPool } from './config/db.js'
import { initDatabase } from './config/dbInit.js'
import { setInstallId } from './services/auth.service.js'
import { loadEnv } from './config/env.js'

// Entry point for the API. Runs in two ways:
//  * as a child process forked by electron/main.ts (Server mode) — settings arrive as env vars,
//    and status messages go back to the parent over process.parentPort;
//  * on its own with `npm run server:dev` — settings come from .env.

/** Messages exchanged with electron/main.ts. */
export type ParentMessage = { type: 'shutdown' }
export type ChildMessage =
  | { type: 'ready'; port: number; databaseCreated: boolean; sampleDataLoaded: boolean; schemaVersion: number }
  | { type: 'fatal'; error: string }

interface ParentPort {
  postMessage(message: ChildMessage): void
  on(event: 'message', listener: (event: { data: ParentMessage }) => void): void
}

const parentPort = (process as NodeJS.Process & { parentPort?: ParentPort }).parentPort
const report = (message: ChildMessage) => parentPort?.postMessage(message)

let server: Server | null = null
let stopping = false

async function shutdown(code = 0): Promise<void> {
  if (stopping) return
  stopping = true
  try {
    if (server) await new Promise<void>((resolve) => server!.close(() => resolve()))
    await closePool()
  } finally {
    process.exit(code)
  }
}

async function main(): Promise<void> {
  if (!parentPort) await import('dotenv/config')
  const env = loadEnv()

  const init = await initDatabase(env)
  setInstallId(init.installId)
  createPool(env)

  const app = createApp({ appVersion: env.APP_VERSION })
  server = await new Promise<Server>((resolve, reject) => {
    const listening = app.listen(env.API_PORT, env.API_BIND_HOST, () => resolve(listening))
    listening.once('error', reject)
  })

  console.log(
    `[api] ${init.created ? `Database created${init.sampleDataLoaded ? ' with sample data' : ''}` : 'Database ready'} (schema v${init.schemaVersion})${init.migrated.length ? `; applied ${init.migrated.join(', ')}` : ''}${init.defaultOwnerCreated ? '; default admin account created (admin / 000000)' : ''}`,
  )
  console.log(`[api] Listening on ${env.API_BIND_HOST}:${env.API_PORT} — http://127.0.0.1:${env.API_PORT}/api/health`)
  report({ type: 'ready', port: env.API_PORT, databaseCreated: init.created, sampleDataLoaded: init.sampleDataLoaded, schemaVersion: init.schemaVersion })
}

parentPort?.on('message', (event) => {
  if (event.data?.type === 'shutdown') void shutdown(0)
})
process.on('SIGINT', () => void shutdown(0))
process.on('SIGTERM', () => void shutdown(0))

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)
  console.error('[api] Failed to start:', message)
  report({ type: 'fatal', error: message })
  // Give the parent a moment to receive the message before exiting.
  setTimeout(() => process.exit(1), 200)
})
