import type { Request } from 'express'
import type { Pool, PoolConnection } from 'mysql2/promise'
import { getPool } from '../config/db.js'
import { clientIp } from '../utils/ip.js'

export interface AuditEntry {
  user_id?: number | null
  session_id?: number | null
  action: string
  module?: string | null
  details?: unknown
  terminal_id?: string | null
  ip_address?: string | null
  is_flagged?: boolean
  flag_reason?: string | null
}

type Queryable = Pool | PoolConnection

/** Writes one row to audit_logs. Pass the transaction's connection so the log commits or rolls back with the change. */
export async function logAudit(entry: AuditEntry, db: Queryable = getPool()): Promise<void> {
  await db.execute(
    `INSERT INTO audit_logs (user_id, session_id, action, module, details, terminal_id, ip_address, is_flagged, flag_reason)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      entry.user_id ?? null,
      entry.session_id ?? null,
      entry.action,
      entry.module ?? null,
      entry.details === undefined ? null : JSON.stringify(entry.details),
      entry.terminal_id ?? null,
      entry.ip_address ?? null,
      entry.is_flagged ?? false,
      entry.flag_reason ?? null,
    ],
  )
}

/** Request details every audit entry carries. */
export function requestContext(req: Request): { ip_address: string | null; terminal_id: string | null; user_id: number | null; session_id: number | null } {
  return {
    ip_address: clientIp(req),
    terminal_id: req.terminalSession?.terminal_id ?? req.terminalId ?? null,
    user_id: req.user?.user_id ?? req.terminalSession?.user_id ?? null,
    session_id: req.terminalSession?.session_id ?? null,
  }
}

/** Logs an action for the current request and marks it, so middleware/audit.ts does not add a generic entry. */
export async function auditRequest(req: Request, entry: AuditEntry, db: Queryable = getPool()): Promise<void> {
  req.auditLogged = true
  await logAudit({ ...requestContext(req), ...entry }, db)
}
