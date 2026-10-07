import { randomBytes } from 'node:crypto'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'

// Compiled location: dist-electron/server/config/env.js → project root is three levels up.
const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')

const booleanString = z
  .enum(['true', 'false', '1', '0', ''])
  .optional()
  .transform((value) => value === 'true' || value === '1')

const envSchema = z.object({
  NODE_ENV: z.string().default('development'),
  APP_VERSION: z.string().default('0.0.0'),

  /** Express listens on every LAN interface by default so cashier terminals can reach it. */
  API_BIND_HOST: z.string().min(1).default('0.0.0.0'),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(4010),

  DB_HOST: z.string().min(1).default('127.0.0.1'),
  DB_PORT: z.coerce.number().int().positive().default(3306),
  DB_USER: z.string().min(1).default('pos_app'),
  DB_PASSWORD: z.string().default(''),
  DB_NAME: z
    .string()
    .regex(/^[A-Za-z0-9_]+$/, 'DB_NAME may only contain letters, digits and underscores')
    .default('grocery9010'),
  DB_CONNECTION_LIMIT: z.coerce.number().int().positive().default(10),

  /** Folder with schema.sql, seed.sql and sample-data.sql. */
  DATABASE_DIR: z.string().default(path.join(PROJECT_ROOT, 'database')),
  /** Load database/sample-data.sql (cashiers, products, stock) on first run. Development only. */
  LOAD_SAMPLE_DATA: booleanString,

  /** Folder with predict.py. */
  ML_SERVICE_DIR: z.string().default(path.join(PROJECT_ROOT, 'ml_service')),
  /** Python executable. Empty = use ml_service/.venv if it exists, otherwise python/python3 on PATH. */
  ML_PYTHON: z.string().default(''),
  ML_TIMEOUT_MS: z.coerce.number().int().positive().default(120_000),

  /** Signs owner and terminal-session tokens. Electron generates and keeps one per server PC. */
  JWT_SECRET: z.preprocess((v) => (v === '' ? undefined : v), z.string().min(32, 'JWT_SECRET must be at least 32 characters').optional()),
  JWT_EXPIRES_HOURS: z.coerce.number().positive().default(12),
})

export type Env = Omit<z.infer<typeof envSchema>, 'JWT_SECRET'> & { JWT_SECRET: string; mlPython: string }

function resolvePython(serviceDir: string, configured: string): string {
  if (configured) return configured
  const venvPython =
    process.platform === 'win32' ? path.join(serviceDir, '.venv', 'Scripts', 'python.exe') : path.join(serviceDir, '.venv', 'bin', 'python')
  if (existsSync(venvPython)) return venvPython
  return process.platform === 'win32' ? 'python' : 'python3'
}

let cached: Env | null = null

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  if (cached) return cached
  const parsed = envSchema.parse(source)
  let jwtSecret = parsed.JWT_SECRET
  if (!jwtSecret) {
    // Tokens then stop working when the API restarts, so the owner has to sign in again.
    console.warn('[api] JWT_SECRET is not set; using a temporary secret for this run.')
    jwtSecret = randomBytes(48).toString('hex')
  }
  cached = { ...parsed, JWT_SECRET: jwtSecret, mlPython: resolvePython(parsed.ML_SERVICE_DIR, parsed.ML_PYTHON) }
  return cached
}
