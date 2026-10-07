import 'dotenv/config'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { serverConfigFromEnv } from './config.js'
import { migrate } from './db/migrate.js'
import { startServer } from './index.js'

// Runs the API without Electron, for testing endpoints with curl/Postman.
// Compiled to dist-electron/server/src/standalone.js; SQL files live in server/database.
const here = path.dirname(fileURLToPath(import.meta.url))
const sqlDir = path.resolve(here, '../../../server/database')
const config = serverConfigFromEnv(process.env, sqlDir)

if (process.argv.includes('--reset-db')) {
  console.log(`[server] Dropping and recreating database "${config.database.name}"…`)
  await migrate(config.database, sqlDir, { reset: true })
}

try {
  const server = await startServer(config)
  console.log(`[server] ${server.migration.created ? 'Database created and seeded' : 'Database ready'} (schema v${server.migration.schemaVersion})`)
  console.log(`[server] Listening on ${config.host}:${server.port} — try ${server.url}/api/health`)

  const shutdown = async () => {
    await server.stop()
    process.exit(0)
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
} catch (error) {
  console.error('[server] Failed to start:', error instanceof Error ? error.message : error)
  process.exit(1)
}
