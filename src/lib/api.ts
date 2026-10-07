import type { DesktopConfig } from '../types/desktop'

const BROWSER_FALLBACK_BASE = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? 'http://127.0.0.1:4010/api'

let baseUrlPromise: Promise<string> | null = null

export function apiBaseUrl(): Promise<string> {
  baseUrlPromise ??= window.desktop
    ? window.desktop.getConfig().then((config: DesktopConfig) => config.apiBaseUrl)
    : Promise.resolve(BROWSER_FALLBACK_BASE)
  return baseUrlPromise
}

export class ApiError extends Error {
  readonly status: number
  readonly code: string
  readonly details?: unknown

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message)
    this.status = status
    this.code = code
    this.details = details
  }
}

export async function apiFetch<T>(path: string, init: RequestInit = {}, acceptStatuses: number[] = []): Promise<T> {
  const base = await apiBaseUrl()
  let response: Response
  try {
    response = await fetch(`${base}${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...init.headers },
    })
  } catch {
    throw new ApiError(0, 'NETWORK_ERROR', 'Cannot reach the store server. Check the LAN connection and that the server PC is on.')
  }
  const body = await response.json().catch(() => null)
  if (!response.ok && !acceptStatuses.includes(response.status)) {
    const error = body?.error ?? {}
    throw new ApiError(response.status, error.code ?? 'HTTP_ERROR', error.message ?? `Request failed (${response.status})`, error.details)
  }
  return body as T
}

export interface HealthReport {
  status: 'ok' | 'degraded'
  version: string
  uptimeSeconds: number
  serverTime: string
  database: { status: 'up' | 'down'; latencyMs: number | null; schemaVersion: number | null; error?: string }
}

/** 503 still carries a report (database down), so it is returned rather than thrown. */
export const getHealth = () => apiFetch<HealthReport>('/health', {}, [503])
