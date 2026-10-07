import { z } from 'zod'

export const databaseConfigSchema = z.object({
  host: z.string().min(1).default('127.0.0.1'),
  port: z.coerce.number().int().positive().default(3306),
  user: z.string().min(1).default('pos_app'),
  password: z.string().default(''),
  name: z
    .string()
    .regex(/^[A-Za-z0-9_]+$/, 'Database name may only contain letters, digits and underscores')
    .default('grocery9010'),
  connectionLimit: z.coerce.number().int().positive().default(10),
})

export const serverConfigSchema = z.object({
  host: z.string().min(1).default('0.0.0.0'),
  port: z.coerce.number().int().min(1).max(65535).default(4010),
  database: databaseConfigSchema.default(databaseConfigSchema.parse({})),
  /** Folder that holds schema.sql and seed.sql. */
  sqlDir: z.string().min(1),
  appVersion: z.string().default('0.0.0'),
})

export type DatabaseConfig = z.infer<typeof databaseConfigSchema>
export type ServerConfig = z.infer<typeof serverConfigSchema>

/** Reads server settings from environment variables. Used by the standalone runner. */
export function serverConfigFromEnv(env: NodeJS.ProcessEnv, sqlDir: string): ServerConfig {
  return serverConfigSchema.parse({
    host: env.SERVER_BIND_HOST,
    port: env.SERVER_PORT,
    sqlDir,
    appVersion: env.npm_package_version,
    database: {
      host: env.DB_HOST,
      port: env.DB_PORT,
      user: env.DB_USER,
      password: env.DB_PASSWORD,
      name: env.DB_NAME,
    },
  })
}
