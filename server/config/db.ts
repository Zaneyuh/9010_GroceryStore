import mysql, { type Pool, type PoolConnection } from 'mysql2/promise'
import type { Env } from './env.js'

let pool: Pool | null = null

export function createPool(env: Env): Pool {
  if (pool) return pool
  pool = mysql.createPool({
    host: env.DB_HOST,
    port: env.DB_PORT,
    user: env.DB_USER,
    password: env.DB_PASSWORD,
    database: env.DB_NAME,
    connectionLimit: env.DB_CONNECTION_LIMIT,
    waitForConnections: true,
    queueLimit: 0,
    enableKeepAlive: true,
    // Store and read DATETIME values in Philippine time so receipts and readings match the store clock.
    timezone: '+08:00',
    dateStrings: ['DATE', 'DATETIME'],
    charset: 'utf8mb4_unicode_ci',
  })
  pool.on('connection', (connection) => {
    connection.query("SET time_zone = '+08:00'")
  })
  return pool
}

export function getPool(): Pool {
  if (!pool) throw new Error('Database pool has not been created. Call createPool() first.')
  return pool
}

export async function closePool(): Promise<void> {
  if (!pool) return
  const current = pool
  pool = null
  await current.end()
}

/**
 * Runs `work` inside a MySQL transaction: commits when it resolves, rolls back when it throws.
 * Every service that changes more than one table goes through this.
 */
export async function withTransaction<T>(work: (connection: PoolConnection) => Promise<T>): Promise<T> {
  const connection = await getPool().getConnection()
  try {
    await connection.beginTransaction()
    const result = await work(connection)
    await connection.commit()
    return result
  } catch (error) {
    await connection.rollback()
    throw error
  } finally {
    connection.release()
  }
}
