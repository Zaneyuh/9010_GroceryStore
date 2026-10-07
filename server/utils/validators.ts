import { z } from 'zod'

export const terminalIdSchema = z
  .string()
  .regex(/^PC-\d{2}$/, 'Terminal ID must look like PC-01')
  .refine((id) => id !== 'PC-00', 'PC-00 is reserved for the server PC; use PC-01 or higher')
export const ownerPinSchema = z.string().regex(/^\d{6}$/, 'PIN must be exactly 6 digits')
const positiveId = z.coerce.number().int().positive()

/** Rejects PINs anyone would guess: one digit repeated (000000) or a straight run (123456, 987654). */
function guessablePin(pin: string): boolean {
  const digits = [...pin].map(Number)
  const steps = new Set(digits.slice(1).map((d, i) => d - digits[i]))
  return steps.size === 1 && [0, 1, -1].includes([...steps][0])
}

const personName = z.string().trim().min(1, 'Required').max(50)

/** The owner's own account (Settings → My account; required on the first sign-in as admin / 000000). */
export const accountBody = z.object({
  first_name: personName,
  last_name: personName,
  username: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9._-]{3,30}$/, 'Username: 3–30 letters, numbers, dots, dashes or underscores')
    .refine((name) => name !== 'admin', 'Choose your own username instead of "admin"'),
  current_pin: ownerPinSchema,
  new_pin: ownerPinSchema.refine((pin) => !guessablePin(pin), 'Choose a PIN that is harder to guess than a repeated digit or a straight run like 123456').optional(),
})

export const loginBody = z.object({
  username: z.string().trim().min(1, 'Username is required').max(50),
  pin: ownerPinSchema,
})

export const verifyOwnerPinBody = z.object({
  pin: ownerPinSchema,
  /** What the PIN approves, e.g. "void", "refund" — stored in the audit log. */
  purpose: z.string().max(50).optional(),
})

export const assignBody = z.object({
  user_id: positiveId,
  terminal_id: terminalIdSchema,
})

export const endShiftBody = z.object({
  session_id: positiveId,
})

export const terminalParams = z.object({
  terminal_id: terminalIdSchema,
})

const terminalName = z.string().trim().max(50, 'Name must be 50 characters or fewer').transform((name) => name || null)

export const createTerminalBody = z.object({
  terminal_id: z.string().trim().toUpperCase().pipe(terminalIdSchema),
  terminal_name: terminalName.nullish().transform((name) => name ?? null),
})

export const updateTerminalBody = z
  .object({ terminal_name: terminalName.nullable().optional(), is_active: z.boolean().optional() })
  .refine((body) => body.terminal_name !== undefined || body.is_active !== undefined, 'Nothing to change')
