import type { RequestHandler } from 'express'
import type { RoleName } from '../services/auth.service.js'
import { HttpError } from '../utils/httpError.js'

/** Use after requireAuth. Rejects users whose role is not in the list. */
export function requireRole(...roles: RoleName[]): RequestHandler {
  return (req, _res, next) => {
    if (!req.user) throw HttpError.unauthorized()
    if (!roles.includes(req.user.role)) throw HttpError.forbidden()
    next()
  }
}
