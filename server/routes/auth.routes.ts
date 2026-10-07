import { Router, type Request } from 'express'
import { bearerToken, requireAuth } from '../middleware/auth.js'
import { firstSignInPending, getInstallId, login, logout, updateOwnAccount, verifyOwnerPin, verifyOwnerToken } from '../services/auth.service.js'
import { HttpError } from '../utils/httpError.js'
import { accountBody, loginBody, verifyOwnerPinBody } from '../utils/validators.js'
import { clientIp } from '../utils/ip.js'

export const authRoutes = Router()

const info = (req: Request) => ({
  ip_address: clientIp(req),
  terminal_id: req.terminalId ?? null,
})

/** True while the owner is still the default admin, so the sign-in screen can show admin / 000000. */
authRoutes.get('/status', async (_req, res) => {
  res.set('Cache-Control', 'no-store')
  res.json({ first_sign_in: await firstSignInPending(), install_id: getInstallId() })
})

/** The signed-in owner's own username, name and PIN. Body: { username, first_name, last_name, current_pin, new_pin? } → user */
authRoutes.put('/account', requireAuth, async (req, res) => {
  const body = accountBody.parse(req.body)
  req.auditLogged = true
  const user = await updateOwnAccount(req.user!.user_id, body, info(req))
  res.json(user)
})

/** Owner sign-in at the Admin Station. Body: { username, pin } → { token, expires_at, user } */
authRoutes.post('/login', async (req, res) => {
  const { username, pin } = loginBody.parse(req.body)
  req.auditLogged = true // login() writes LOGIN / LOGIN_FAILED itself
  const result = await login(username, pin, info(req))
  res.json(result)
})

/** Ends the owner's token. */
authRoutes.post('/logout', requireAuth, async (req, res) => {
  const token = bearerToken(req.headers.authorization)
  if (!token) throw HttpError.unauthorized()
  req.auditLogged = true
  await logout(verifyOwnerToken(token), info(req))
  res.json({ ok: true })
})

/** Current owner. */
authRoutes.get('/me', requireAuth, (req, res) => {
  const user = req.user!
  res.json(user)
})

/**
 * Checks an owner PIN typed at a terminal before a high-risk action. Body: { pin, purpose? } → { valid: true }
 * Wrong PIN → 401 with attempts_left; locked → 423.
 */
authRoutes.post('/verify-owner-pin', async (req, res) => {
  const { pin, purpose } = verifyOwnerPinBody.parse(req.body)
  req.auditLogged = true
  const approval = await verifyOwnerPin(pin, { ...info(req), purpose })
  res.json({ valid: true, owner_id: approval.owner_id, owner_name: approval.owner_name })
})
