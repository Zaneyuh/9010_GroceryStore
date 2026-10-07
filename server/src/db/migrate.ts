import { readFile } from 'node:fs/promises'
import path from 'node:path'
import mysql, { type Connection, type RowDataPacket } from 'mysql2/promise'
import type { DatabaseConfig } from '../config.js'

export const SCHEMA_VERSION = 1

export interface MigrationResult {
  created: boolean
  schemaVersion: number
}

async function connect(config: DatabaseConfig): Promise<Connection> {
  return mysql.createConnection({
    host: config.host,
    port: config.port,
    user: config.user,
    password: config.password,
    multipleStatements: true,
    timezone: '+08:00',
    charset: 'utf8mb4_unicode_ci',
  })
}

async function currentVersion(connection: Connection, database: string): Promise<number | null> {
  const [tables] = await connection.query<RowDataPacket[]>(
    'SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_schema = ? AND table_name = ?',
    [database, 'schema_version'],
  )
  if (Number(tables[0]?.n ?? 0) === 0) return null
  const [rows] = await connection.query<RowDataPacket[]>(`SELECT MAX(version) AS version FROM \`${database}\`.schema_version`)
  return rows[0]?.version === null || rows[0]?.version === undefined ? 0 : Number(rows[0].version)
}

/**
 * Creates the database on first run, then applies schema.sql and seed.sql.
 * Later runs only check the recorded schema version.
 */
export async function migrate(config: DatabaseConfig, sqlDir: string, options: { reset?: boolean } = {}): Promise<MigrationResult> {
  const connection = await connect(config)
  const db = config.name
  try {
    if (options.reset) await connection.query(`DROP DATABASE IF EXISTS \`${db}\``)
    await connection.query(`CREATE DATABASE IF NOT EXISTS \`${db}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`)
    await connection.query(`USE \`${db}\``)
    await connection.query("SET time_zone = '+08:00'")

    const version = await currentVersion(connection, db)
    if (version !== null && version >= SCHEMA_VERSION) return { created: false, schemaVersion: version }
    if (version === 0) {
      throw new Error(
        `Database "${db}" was only partly set up by an earlier run. Back up anything you need, then drop the database and start again.`,
      )
    }
    if (version !== null && version < SCHEMA_VERSION) {
      throw new Error(`Database "${db}" is at schema version ${version}; version ${SCHEMA_VERSION} needs an upgrade script.`)
    }

    const schemaSql = await readFile(path.join(sqlDir, 'schema.sql'), 'utf8')
    const seedSql = await readFile(path.join(sqlDir, 'seed.sql'), 'utf8')

    // DDL commits implicitly in MySQL, so the schema runs on its own; the seed runs as one transaction.
    await connection.query(schemaSql)
    await connection.beginTransaction()
    try {
      await connection.query(seedSql)
      await connection.query('INSERT INTO schema_version (version, description) VALUES (?, ?)', [SCHEMA_VERSION, 'Initial schema and seed data'])
      await connection.commit()
    } catch (error) {
      await connection.rollback()
      throw error
    }
    return { created: true, schemaVersion: SCHEMA_VERSION }
  } finally {
    await connection.end()
  }
}
