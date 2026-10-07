import type { RequestHandler } from 'express'
import { getActiveUser, verifyOwnerToken } from '../services/auth.service.js'
import { HttpError } from '../utils/httpError.js'

export function bearerToken(header: string | undefined): string | null {
  if (!header) return null
  const [scheme, token] = header.split(' ')
  return scheme?.toLowerCase() === 'bearer' && token ? token : null
}

/** Requires a valid owner JWT (Authorization: Bearer …) and an active account. Sets req.user. */
export const requireAuth: RequestHandler = async (req, _res, next) => {
  const token = bearerToken(req.headers.authorization)
  if (!token) throw HttpError.unauthorized()
  const payload = verifyOwnerToken(token)
  const user = await getActiveUser(Number(payload.sub))
  if (!user) throw HttpError.unauthorized('This account is no longer active')
  // The default admin (admin / 000000) may only look at itself, set up its account, or sign out.
  if (user.must_change_credentials && !/^\/api\/auth\/(me|account|logout)(\?|$)/.test(req.originalUrl)) {
    throw new HttpError(403, 'Finish setting up your account first: choose your own username, name and PIN in Settings → My account', { code: 'ACCOUNT_SETUP_REQUIRED' })
  }
  req.user = user
  next()
}
