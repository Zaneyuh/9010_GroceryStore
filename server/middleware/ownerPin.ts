import type { RequestHandler } from 'express'
import { verifyOwnerPin } from '../services/auth.service.js'
import { HttpError } from '../utils/httpError.js'
import { ownerPinSchema } from '../utils/validators.js'
import { clientIp } from '../utils/ip.js'

/**
 * For high-risk actions (void, refund, discount above threshold, no-sale drawer open).
 * Expects `owner_pin` in the JSON body; on success sets req.ownerApproval for the route,
 * which then records its supervisor_overrides row with the approving owner.
 */
export function requireOwnerPin(purpose: string): RequestHandler {
  return async (req, _res, next) => {
    const raw = (req.body as { owner_pin?: unknown } | undefined)?.owner_pin
    if (raw === undefined || raw === null || raw === '') throw HttpError.forbidden('Owner PIN required')
    const pin = ownerPinSchema.parse(raw)
    req.ownerApproval = await verifyOwnerPin(pin, {
      ip_address: clientIp(req),
      terminal_id: req.terminalSession?.terminal_id ?? req.terminalId ?? null,
      session_id: req.terminalSession?.session_id ?? null,
      purpose,
    })
    next()
  }
}
