import type { RowDataPacket } from 'mysql2/promise'
import { getPool } from '../config/db.js'
import { getMLHealth } from './forecast.service.js'

export interface HealthReport {
  status: 'ok' | 'error'
  db: 'connected' | 'disconnected'
  ml: 'available' | 'missing_packages' | 'unavailable'
  version: string
  schema_version: number | null
  uptime_seconds: number
  server_time: string
  errors?: { db?: string; ml?: string }
}

const startedAt = Date.now()

/** status is "ok" when the database is reachable. ML problems are reported but do not fail the check. */
export async function getHealth(appVersion: string): Promise<HealthReport> {
  const errors: NonNullable<HealthReport['errors']> = {}
  let db: HealthReport['db'] = 'disconnected'
  let schemaVersion: number | null = null

  try {
    const [rows] = await getPool().query<RowDataPacket[]>('SELECT MAX(version) AS version FROM schema_migrations')
    db = 'connected'
    schemaVersion = rows[0]?.version === null || rows[0]?.version === undefined ? null : Number(rows[0].version)
  } catch (error) {
    errors.db = error instanceof Error ? error.message : String(error)
  }

  const mlHealth = await getMLHealth()
  const ml: HealthReport['ml'] = mlHealth.status === 'ok' ? 'available' : mlHealth.status
  if ('error' in mlHealth) errors.ml = mlHealth.error
  else if (mlHealth.status === 'missing_packages') {
    errors.ml = `Missing Python packages: ${Object.entries(mlHealth.packages).filter(([, v]) => v === null).map(([k]) => k).join(', ')}`
  }

  return {
    status: db === 'connected' ? 'ok' : 'error',
    db,
    ml,
    version: appVersion,
    schema_version: schemaVersion,
    uptime_seconds: Math.round((Date.now() - startedAt) / 1000),
    server_time: new Date().toISOString(),
    ...(Object.keys(errors).length ? { errors } : {}),
  }
}
