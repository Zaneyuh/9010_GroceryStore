import { spawn } from 'node:child_process'
import path from 'node:path'
import { loadEnv } from '../config/env.js'

// Node side of the Python ML microservice contract: one JSON request on stdin,
// one JSON response on stdout, logs and errors on stderr, non-zero exit on failure.

export type MLRequest =
  | { action: 'health' }
  | { action: 'forecast'; product_id: number; history: { date: string; sales: number }[]; horizon: number; min_samples: number }

export interface MLHealth {
  status: 'ok' | 'missing_packages'
  python: string
  packages: Record<string, string | null>
}

export class MLServiceError extends Error {
  readonly stderr: string

  constructor(message: string, stderr = '') {
    super(message)
    this.name = 'MLServiceError'
    this.stderr = stderr
  }
}

export function callML<T>(payload: MLRequest, timeoutMs = loadEnv().ML_TIMEOUT_MS): Promise<T> {
  const env = loadEnv()
  const script = path.join(env.ML_SERVICE_DIR, 'predict.py')

  return new Promise<T>((resolve, reject) => {
    const py = spawn(env.mlPython, [script], {
      cwd: env.ML_SERVICE_DIR,
      env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUNBUFFERED: '1' },
      windowsHide: true,
    })
    let out = ''
    let err = ''
    let settled = false
    const finish = (fn: () => void) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      fn()
    }
    const timer = setTimeout(() => {
      py.kill()
      finish(() => reject(new MLServiceError(`ML service timed out after ${timeoutMs} ms`, err)))
    }, timeoutMs)

    py.stdout.on('data', (chunk: Buffer) => (out += chunk.toString('utf8')))
    py.stderr.on('data', (chunk: Buffer) => (err += chunk.toString('utf8')))
    py.on('error', (error) =>
      finish(() => reject(new MLServiceError(`Could not start Python (${env.mlPython}): ${error.message}. Run "npm run ml:install".`))),
    )
    py.on('close', (code) =>
      finish(() => {
        if (code !== 0) return reject(new MLServiceError(`ML service exited with code ${code}`, err.trim()))
        try {
          resolve(JSON.parse(out) as T)
        } catch {
          reject(new MLServiceError('ML service returned invalid JSON', out.slice(0, 500)))
        }
      }),
    )

    py.stdin.on('error', () => undefined) // Python may exit before reading stdin; 'close' reports the real error.
    py.stdin.end(JSON.stringify(payload))
  })
}

const HEALTH_CACHE_MS = 60_000
let healthCache: { at: number; value: MLHealth | { status: 'unavailable'; error: string } } | null = null

/** Cached so /api/health does not start Python on every poll. */
export async function getMLHealth(): Promise<MLHealth | { status: 'unavailable'; error: string }> {
  if (healthCache && Date.now() - healthCache.at < HEALTH_CACHE_MS) return healthCache.value
  let value: MLHealth | { status: 'unavailable'; error: string }
  try {
    value = await callML<MLHealth>({ action: 'health' }, 60_000)
  } catch (error) {
    value = { status: 'unavailable', error: error instanceof Error ? error.message : String(error) }
  }
  healthCache = { at: Date.now(), value }
  return value
}
