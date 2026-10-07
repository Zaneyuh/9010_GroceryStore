import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { z } from 'zod'

export const DEFAULT_API_PORT = 4010

/** Per-PC settings, saved in the app's userData folder. Environment variables override them in development. */
export const appConfigSchema = z.object({
  /** "server" runs Express + MySQL + ML on this PC; "terminal" is a cashier PC that only talks to the server. */
  mode: z.enum(['unconfigured', 'server', 'terminal']).default('unconfigured'),
  /** PC-01, PC-02, … as added in Admin Station. Null on the server PC. */
  terminalId: z
    .string()
    .regex(/^PC-\d{2}$/, 'Terminal ID must look like PC-01')
    .nullable()
    .default(null),
  /** LAN address of the server PC. Terminals use it to reach the API; never hardcoded. */
  serverHost: z.string().min(1).default('127.0.0.1'),
  apiPort: z.coerce.number().int().min(1).max(65535).default(DEFAULT_API_PORT),
  /** Server mode only. */
  database: z
    .object({
      host: z.string().min(1).default('127.0.0.1'),
      port: z.coerce.number().int().positive().default(3306),
      user: z.string().min(1).default('pos_app'),
      password: z.string().default(''),
      name: z.string().regex(/^[A-Za-z0-9_]+$/).default('grocery9010'),
    })
    .default({ host: '127.0.0.1', port: 3306, user: 'pos_app', password: '', name: 'grocery9010' }),
  /** Server mode only. Empty = ml_service/.venv, then python on PATH. */
  mlPython: z.string().default(''),
  /** Server mode only. Signs owner tokens; generated once on first start and kept here. */
  jwtSecret: z.string().default(''),
})

export type AppConfig = z.infer<typeof appConfigSchema>

/** What the renderer is allowed to see (no database password). */
export interface PublicAppConfig {
  mode: AppConfig['mode']
  terminalId: string | null
  apiBaseUrl: string
}

const CONFIG_FILE = 'config.json'

const definedEntries = (obj: Record<string, string | undefined>) => Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined && v !== ''))

export async function loadAppConfig(userDataDir: string, env: NodeJS.ProcessEnv): Promise<AppConfig> {
  let saved: Partial<AppConfig> = {}
  try {
    saved = JSON.parse(await readFile(path.join(userDataDir, CONFIG_FILE), 'utf8'))
  } catch {
    // first launch: nothing saved yet
  }
  const merged = {
    ...saved,
    ...definedEntries({ mode: env.APP_MODE, terminalId: env.TERMINAL_ID, serverHost: env.SERVER_HOST, apiPort: env.API_PORT, mlPython: env.ML_PYTHON, jwtSecret: env.JWT_SECRET }),
    database: {
      ...saved.database,
      ...definedEntries({ host: env.DB_HOST, port: env.DB_PORT, user: env.DB_USER, password: env.DB_PASSWORD, name: env.DB_NAME }),
    },
  }
  const parsed = appConfigSchema.safeParse(merged)
  if (parsed.success) return parsed.data
  console.error('[config] Saved settings are invalid; starting unconfigured.', parsed.error.issues)
  return appConfigSchema.parse({})
}

export async function saveAppConfig(userDataDir: string, config: AppConfig): Promise<void> {
  await mkdir(userDataDir, { recursive: true })
  await writeFile(path.join(userDataDir, CONFIG_FILE), JSON.stringify(appConfigSchema.parse(config), null, 2), 'utf8')
}

export function toPublicConfig(config: AppConfig): PublicAppConfig {
  const host = config.mode === 'server' ? '127.0.0.1' : config.serverHost
  return { mode: config.mode, terminalId: config.terminalId, apiBaseUrl: `http://${host}:${config.apiPort}` }
}
