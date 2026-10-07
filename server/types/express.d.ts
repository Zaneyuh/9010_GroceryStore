import type { AuthUser, OwnerApproval, TerminalSessionClaims } from '../services/auth.service.js'

// Fields the middleware adds to every request.
declare global {
  namespace Express {
    interface Request {
      /** Signed-in owner (middleware/auth.ts). */
      user?: AuthUser
      /** Active cashier session on a terminal (Step 3 onward). */
      terminalSession?: TerminalSessionClaims
      /** Set by middleware/ownerPin.ts when a valid owner PIN came with the request. */
      ownerApproval?: OwnerApproval
      /** Terminal the request came from, from the X-Terminal-Id header. */
      terminalId?: string
      /** True once the route wrote its own audit entry; middleware/audit.ts then skips the generic one. */
      auditLogged?: boolean
    }
  }
}

export {}
