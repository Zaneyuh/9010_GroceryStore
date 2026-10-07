import type { RowDataPacket } from 'mysql2/promise'
import { getPool } from '../db/pool.js'

export interface HealthReport {
  status: 'ok' | 'degraded'
  version: string
  uptimeSeconds: number
  serverTime: string
  database: {
    status: 'up' | 'down'
    latencyMs: number | null
    schemaVersion: number | null
    error?: string
  }
}

const startedAt = Date.now()

export async function getHealth(appVersion: string): Promise<HealthReport> {
  const database: HealthReport['database'] = { status: 'down', latencyMs: null, schemaVersion: null }
  const began = performance.now()
  try {
    const [rows] = await getPool().query<RowDataPacket[]>('SELECT MAX(version) AS version FROM schema_version')
    database.status = 'up'
    database.latencyMs = Math.round(performance.now() - began)
    database.schemaVersion = rows[0]?.version === null || rows[0]?.version === undefined ? null : Number(rows[0].version)
  } catch (error) {
    database.error = error instanceof Error ? error.message : String(error)
  }

  return {
    status: database.status === 'up' ? 'ok' : 'degraded',
    version: appVersion,
    uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
    serverTime: new Date().toISOString(),
    database,
  }
}
