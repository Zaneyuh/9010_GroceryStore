import type { RequestHandler } from 'express'
import { logAudit, requestContext } from '../services/audit.service.js'
import { terminalIdSchema } from '../utils/validators.js'

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

/** Reads which terminal a request came from (X-Terminal-Id header). */
export const terminalContext: RequestHandler = (req, _res, next) => {
  const header = req.get('x-terminal-id')
  const parsed = terminalIdSchema.safeParse(header)
  if (parsed.success) req.terminalId = parsed.data
  next()
}

/**
 * Safety net: every successful mutating request gets an audit row. Routes normally log a
 * specific action themselves (auditRequest), which sets req.auditLogged and skips this one.
 */
export const auditMutations: RequestHandler = (req, res, next) => {
  if (!MUTATING.has(req.method)) {
    next()
    return
  }
  res.on('finish', () => {
    if (req.auditLogged || res.statusCode >= 400) return
    logAudit({
      ...requestContext(req),
      action: `${req.method} ${req.baseUrl}${req.route?.path ?? ''}`.slice(0, 50),
      module: req.baseUrl.replace(/^\/api\//, '').split('/')[0]?.toUpperCase() || null,
      details: { path: req.originalUrl, status: res.statusCode },
    }).catch((error: unknown) => console.error('[api] audit log failed:', error))
  })
  next()
}
