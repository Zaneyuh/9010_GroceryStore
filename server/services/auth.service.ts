import { randomUUID } from 'node:crypto'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import type { PoolConnection, RowDataPacket } from 'mysql2/promise'
import { getPool, withTransaction } from '../config/db.js'
import { loadEnv } from '../config/env.js'
import { HttpError } from '../utils/httpError.js'
import { logAudit } from './audit.service.js'

export const MAX_FAILED_ATTEMPTS = 5
export const LOCK_MINUTES = 5
const TERMINAL_TOKEN_HOURS = 24

export type RoleName = 'Owner' | 'Cashier'

export interface AuthUser {
  user_id: number
  username: string | null
  name: string
  role: RoleName
  /** Still the default admin: everything except setting up the account is refused until this is false. */
  must_change_credentials: boolean
  first_name: string
  last_name: string
}

export interface OwnerApproval {
  owner_id: number
  owner_name: string
}

export interface TerminalSessionClaims {
  session_id: number
  terminal_id: string
  user_id: number
}

export interface RequestInfo {
  ip_address: string | null
  terminal_id: string | null
}

interface UserRow extends RowDataPacket {
  user_id: number
  username: string | null
  pin_hash: string | null
  must_change_credentials: number
  first_name: string
  last_name: string
  is_active: number
  failed_attempts: number
  locked_until: string | null
  locked_seconds_left: number | null
  role_name: RoleName
}

// Compared against when the username does not exist, so a wrong username takes as long as a wrong PIN.
const DUMMY_HASH = bcrypt.hashSync('not-a-real-pin', 10)

const USER_COLUMNS = `u.user_id, u.username, u.pin_hash, u.must_change_credentials, u.first_name, u.last_name, u.is_active, u.failed_attempts, u.locked_until,
  GREATEST(TIMESTAMPDIFF(SECOND, NOW(), u.locked_until), 0) AS locked_seconds_left, r.role_name`

const toAuthUser = (row: UserRow): AuthUser => ({
  user_id: row.user_id,
  username: row.username,
  name: `${row.first_name} ${row.last_name}`,
  first_name: row.first_name,
  last_name: row.last_name,
  role: row.role_name,
  must_change_credentials: Boolean(row.must_change_credentials),
})

type PinOutcome = { result: 'ok' } | { result: 'wrong'; attemptsLeft: number } | { result: 'locked'; secondsLeft: number; justLocked: boolean }

/**
 * Checks a PIN against one owner row (locked FOR UPDATE by the caller) and updates the
 * failed-attempt counter. After MAX_FAILED_ATTEMPTS wrong PINs the account locks for LOCK_MINUTES.
 */
async function checkPin(connection: PoolConnection, row: UserRow, pin: string, info: RequestInfo, source: 'login' | 'override'): Promise<PinOutcome> {
  if (row.locked_seconds_left && row.locked_seconds_left > 0) {
    await bcrypt.compare(pin, DUMMY_HASH)
    return { result: 'locked', secondsLeft: row.locked_seconds_left, justLocked: false }
  }
  const valid = row.pin_hash ? await bcrypt.compare(pin, row.pin_hash) : false
  if (valid) {
    await connection.execute('UPDATE users SET failed_attempts = 0, locked_until = NULL WHERE user_id = ?', [row.user_id])
    return { result: 'ok' }
  }

  const attempts = (row.failed_attempts ?? 0) + 1
  if (attempts >= MAX_FAILED_ATTEMPTS) {
    await connection.execute(
      `UPDATE users SET failed_attempts = 0, locked_until = DATE_ADD(NOW(), INTERVAL ${LOCK_MINUTES} MINUTE) WHERE user_id = ?`,
      [row.user_id],
    )
    await logAudit(
      {
        user_id: row.user_id,
        action: 'OWNER_LOCKED',
        module: 'AUTH',
        details: { source, failed_attempts: attempts, lock_minutes: LOCK_MINUTES },
        ...info,
        is_flagged: true,
        flag_reason: `${MAX_FAILED_ATTEMPTS} failed owner PIN attempts`,
      },
      connection,
    )
    return { result: 'locked', secondsLeft: LOCK_MINUTES * 60, justLocked: true }
  }
  await connection.execute('UPDATE users SET failed_attempts = ? WHERE user_id = ?', [attempts, row.user_id])
  return { result: 'wrong', attemptsLeft: MAX_FAILED_ATTEMPTS - attempts }
}

function lockedError(secondsLeft: number): HttpError {
  const minutes = Math.ceil(secondsLeft / 60)
  return new HttpError(423, `Owner account is locked after too many wrong PINs. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`, {
    retry_after_seconds: secondsLeft,
  })
}

// ---------------------------------------------------------------------------
// Tokens
// ---------------------------------------------------------------------------

interface OwnerTokenPayload extends jwt.JwtPayload {
  typ: 'owner'
  /** Install id of the database the token was issued for. */
  iid?: string
  sub: string
  role: RoleName
  jti: string
}

interface TerminalTokenPayload extends jwt.JwtPayload, TerminalSessionClaims {
  typ: 'terminal'
  iid?: string
}

// Signed-out tokens until they expire. Kept in memory: the API restarting also clears it,
// which is acceptable because tokens expire after JWT_EXPIRES_HOURS anyway.
const revoked = new Map<string, number>()

function pruneRevoked() {
  const now = Date.now() / 1000
  for (const [jti, exp] of revoked) if (exp < now) revoked.delete(jti)
}

/**
 * The database's install id (server/config/dbInit.ts), set once at start-up. Every token carries it, so a token
 * issued before the database was reset is refused even if the new database has a user with the same id.
 */
let installId: string | null = null
export function setInstallId(id: string): void {
  installId = id
}
export const getInstallId = () => installId
const fromThisInstall = (payload: { iid?: unknown }) => !installId || payload.iid === installId

export function signOwnerToken(user: AuthUser): { token: string; expires_at: string } {
  const env = loadEnv()
  const token = jwt.sign({ typ: 'owner', role: user.role, iid: installId }, env.JWT_SECRET, {
    subject: String(user.user_id),
    jwtid: randomUUID(),
    expiresIn: `${env.JWT_EXPIRES_HOURS}h`,
  })
  const { exp } = jwt.decode(token) as jwt.JwtPayload
  return { token, expires_at: new Date((exp ?? 0) * 1000).toISOString() }
}

export function verifyOwnerToken(token: string): OwnerTokenPayload {
  let payload: OwnerTokenPayload
  try {
    payload = jwt.verify(token, loadEnv().JWT_SECRET) as OwnerTokenPayload
  } catch {
    throw HttpError.unauthorized('Session expired or invalid. Please sign in again.')
  }
  if (payload.typ !== 'owner' || revoked.has(payload.jti) || !fromThisInstall(payload)) throw HttpError.unauthorized('Session expired or invalid. Please sign in again.')
  return payload
}

export function revokeOwnerToken(payload: OwnerTokenPayload): void {
  pruneRevoked()
  revoked.set(payload.jti, payload.exp ?? Date.now() / 1000 + 86_400)
}

/** Token a terminal receives while a cashier is assigned. Each use is re-checked against the sessions table. */
export function signTerminalToken(claims: TerminalSessionClaims): string {
  return jwt.sign({ typ: 'terminal', ...claims, iid: installId }, loadEnv().JWT_SECRET, { expiresIn: `${TERMINAL_TOKEN_HOURS}h` })
}

export function verifyTerminalToken(token: string): TerminalSessionClaims {
  try {
    const payload = jwt.verify(token, loadEnv().JWT_SECRET) as TerminalTokenPayload
    if (payload.typ !== 'terminal' || !fromThisInstall(payload)) throw new Error('wrong token type or database')
    return { session_id: payload.session_id, terminal_id: payload.terminal_id, user_id: payload.user_id }
  } catch {
    throw HttpError.unauthorized('Terminal session is not valid. Wait for the owner to assign a cashier.')
  }
}

// ---------------------------------------------------------------------------
// Use cases
// ---------------------------------------------------------------------------

export async function login(username: string, pin: string, info: RequestInfo): Promise<{ token: string; expires_at: string; user: AuthUser }> {
  type Outcome = { ok: true; user: AuthUser } | { ok: false; error: HttpError }

  const outcome = await withTransaction<Outcome>(async (connection) => {
    const [rows] = await connection.query<UserRow[]>(
      `SELECT ${USER_COLUMNS} FROM users u JOIN roles r ON r.role_id = u.role_id WHERE u.username = ? FOR UPDATE`,
      [username],
    )
    const row = rows[0]
    const invalid = HttpError.unauthorized('Invalid username or PIN')

    if (!row || !row.pin_hash || !row.is_active || row.role_name !== 'Owner') {
      await bcrypt.compare(pin, DUMMY_HASH)
      await logAudit({ user_id: row?.user_id ?? null, action: 'LOGIN_FAILED', module: 'AUTH', details: { username, reason: 'unknown_or_inactive' }, ...info }, connection)
      return { ok: false, error: invalid }
    }

    const result = await checkPin(connection, row, pin, info, 'login')
    if (result.result === 'locked') {
      if (!result.justLocked) await logAudit({ user_id: row.user_id, action: 'LOGIN_BLOCKED', module: 'AUTH', details: { reason: 'account_locked' }, ...info }, connection)
      return { ok: false, error: lockedError(result.secondsLeft) }
    }
    if (result.result === 'wrong') {
      await logAudit({ user_id: row.user_id, action: 'LOGIN_FAILED', module: 'AUTH', details: { reason: 'wrong_pin', attempts_left: result.attemptsLeft }, ...info }, connection)
      return { ok: false, error: new HttpError(401, 'Invalid username or PIN', { attempts_left: result.attemptsLeft }) }
    }

    await connection.execute('UPDATE users SET last_login = NOW() WHERE user_id = ?', [row.user_id])
    await logAudit({ user_id: row.user_id, action: 'LOGIN', module: 'AUTH', ...info }, connection)
    return { ok: true, user: toAuthUser(row) }
  })

  // Failed attempts are committed above before the error is thrown, so the counter survives.
  if (!outcome.ok) throw outcome.error
  return { ...signOwnerToken(outcome.user), user: outcome.user }
}

// ---------------------------------------------------------------------------
// Default admin → the owner's own account
// ---------------------------------------------------------------------------

/** True while the owner account still has the default admin details (shown as a hint on the sign-in screen). */
export async function firstSignInPending(): Promise<boolean> {
  const [rows] = await getPool().query<RowDataPacket[]>(
    "SELECT 1 FROM users u JOIN roles r ON r.role_id = u.role_id WHERE r.role_name = 'Owner' AND u.must_change_credentials = TRUE AND u.is_active = TRUE LIMIT 1",
  )
  return rows.length > 0
}

/**
 * The signed-in owner changes their own username, name and (optionally) PIN, confirming with the current PIN.
 * On the first sign-in a new PIN is required, which clears must_change_credentials and unlocks the system.
 */
export async function updateOwnAccount(
  userId: number,
  input: { username: string; first_name: string; last_name: string; current_pin: string; new_pin?: string },
  info: RequestInfo,
): Promise<AuthUser> {
  const newHash = input.new_pin ? await bcrypt.hash(input.new_pin, 12) : null
  type Outcome = { ok: true; user: AuthUser } | { ok: false; error: HttpError }
  const outcome = await withTransaction<Outcome>(async (connection) => {
    const [rows] = await connection.query<UserRow[]>(`SELECT ${USER_COLUMNS} FROM users u JOIN roles r ON r.role_id = u.role_id WHERE u.user_id = ? FOR UPDATE`, [userId])
    const row = rows[0]
    if (!row) return { ok: false, error: HttpError.unauthorized() }
    if (row.must_change_credentials && !input.new_pin) return { ok: false, error: HttpError.badRequest('Choose your own PIN to finish setting up') }

    // Wrong current PIN counts towards the same lockout as signing in.
    const check = await checkPin(connection, row, input.current_pin, info, 'login')
    if (check.result === 'locked') return { ok: false, error: lockedError(check.secondsLeft) }
    if (check.result === 'wrong') return { ok: false, error: new HttpError(401, 'Current PIN is incorrect', { attempts_left: check.attemptsLeft }) }
    if (input.new_pin && input.new_pin === input.current_pin) return { ok: false, error: HttpError.badRequest('The new PIN must be different from the current one') }

    const [taken] = await connection.query<RowDataPacket[]>('SELECT 1 FROM users WHERE username = ? AND user_id <> ?', [input.username, userId])
    if (taken.length) return { ok: false, error: HttpError.conflict('That username is taken') }
    await connection.execute(
      `UPDATE users SET username = ?, first_name = ?, last_name = ?, pin_hash = COALESCE(?, pin_hash),
         must_change_credentials = IF(? IS NULL, must_change_credentials, FALSE) WHERE user_id = ?`,
      [input.username, input.first_name, input.last_name, newHash, newHash, userId],
    )
    await logAudit({ user_id: userId, action: row.must_change_credentials ? 'OWNER_ACCOUNT_SET_UP' : 'OWNER_ACCOUNT_UPDATED', module: 'AUTH', details: { username: input.username, pin_changed: Boolean(newHash) }, ...info }, connection)
    const [updated] = await connection.query<UserRow[]>(`SELECT ${USER_COLUMNS} FROM users u JOIN roles r ON r.role_id = u.role_id WHERE u.user_id = ?`, [userId])
    return { ok: true, user: toAuthUser(updated[0]) }
  })
  if (!outcome.ok) throw outcome.error
  return outcome.user
}

export async function logout(payload: OwnerTokenPayload, info: RequestInfo): Promise<void> {
  revokeOwnerToken(payload)
  await logAudit({ user_id: Number(payload.sub), action: 'LOGOUT', module: 'AUTH', ...info })
}

export async function getActiveUser(userId: number): Promise<AuthUser | null> {
  const [rows] = await getPool().query<UserRow[]>(
    `SELECT ${USER_COLUMNS} FROM users u JOIN roles r ON r.role_id = u.role_id WHERE u.user_id = ? AND u.is_active = TRUE`,
    [userId],
  )
  return rows[0] ? toAuthUser(rows[0]) : null
}

/**
 * Owner PIN typed at a terminal for a high-risk action (void, refund, large discount, no-sale drawer).
 * Shares the login lockout counter. Writes OWNER_PIN_VERIFIED / OWNER_PIN_FAILED to the audit log;
 * the action itself records its supervisor_overrides row.
 */
export async function verifyOwnerPin(pin: string, info: RequestInfo & { purpose?: string; session_id?: number | null }): Promise<OwnerApproval> {
  type Outcome = { ok: true; approval: OwnerApproval } | { ok: false; error: HttpError }

  const outcome = await withTransaction<Outcome>(async (connection) => {
    const [owners] = await connection.query<UserRow[]>(
      `SELECT ${USER_COLUMNS} FROM users u JOIN roles r ON r.role_id = u.role_id
       WHERE r.role_name = 'Owner' AND u.is_active = TRUE AND u.pin_hash IS NOT NULL ORDER BY u.user_id FOR UPDATE`,
    )
    if (owners.length === 0) return { ok: false, error: new HttpError(500, 'No active owner account is set up') }

    const auditBase = { module: 'AUTH', ip_address: info.ip_address, terminal_id: info.terminal_id, session_id: info.session_id ?? null }
    let lockedFor = 0
    let attemptsLeft = MAX_FAILED_ATTEMPTS
    for (const owner of owners) {
      const result = await checkPin(connection, owner, pin, info, 'override')
      if (result.result === 'ok') {
        await logAudit({ ...auditBase, user_id: owner.user_id, action: 'OWNER_PIN_VERIFIED', details: { purpose: info.purpose ?? null } }, connection)
        return { ok: true, approval: { owner_id: owner.user_id, owner_name: `${owner.first_name} ${owner.last_name}` } }
      }
      if (result.result === 'locked') lockedFor = Math.max(lockedFor, result.secondsLeft)
      else attemptsLeft = Math.min(attemptsLeft, result.attemptsLeft)
    }

    await logAudit({ ...auditBase, action: 'OWNER_PIN_FAILED', details: { purpose: info.purpose ?? null, locked: lockedFor > 0 } }, connection)
    if (lockedFor > 0 && attemptsLeft === MAX_FAILED_ATTEMPTS) return { ok: false, error: lockedError(lockedFor) }
    return { ok: false, error: new HttpError(401, 'Invalid Owner PIN', { attempts_left: attemptsLeft }) }
  })

  if (!outcome.ok) throw outcome.error
  return outcome.approval
}
