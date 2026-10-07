import { useState } from 'react'
import { apiErrorDetails, apiErrorMessage, verifyOwnerPin, type OwnerApprovalResult } from '../services/api'
import { Field, Modal, PinInput } from '../workspace/ui'

interface OwnerPinModalProps {
  title: string
  /** What is being approved; stored with the audit entry (e.g. "void", "refund"). */
  purpose: 'void' | 'refund' | 'discount' | 'drawer_open'
  /** Short explanation shown above the PIN field. */
  description?: string
  /** Ask for a reason as well (voids and refunds). */
  requireReason?: boolean
  confirmLabel?: string
  /**
   * Does the action itself with the PIN (e.g. a void or refund the server checks the PIN for) and resolves to the
   * approving owner's name. Without it the PIN is only verified and the caller acts in onApproved.
   */
  perform?: (pin: string, reason: string) => Promise<string>
  onApproved: (approval: OwnerApprovalResult & { pin: string; reason: string }) => void
  onClose: () => void
}

/**
 * The owner types their 6-digit PIN at the terminal to approve a high-risk action.
 * The PIN is checked by the server (shared 5-try lockout); the approved action records the override.
 */
export function OwnerPinModal({ title, purpose, description, requireReason = false, confirmLabel = 'APPROVE', perform, onApproved, onClose }: OwnerPinModalProps) {
  const [pin, setPin] = useState('')
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const ready = /^\d{6}$/.test(pin) && (!requireReason || reason.trim().length >= 3)

  async function approve() {
    if (!ready || busy) return
    setBusy(true)
    setError(null)
    try {
      const approval = perform ? { valid: true as const, owner_id: 0, owner_name: await perform(pin, reason.trim()) } : await verifyOwnerPin(pin, purpose)
      onApproved({ ...approval, pin, reason: reason.trim() })
    } catch (err) {
      const left = apiErrorDetails<{ attempts_left?: number }>(err)?.attempts_left
      setError(`${apiErrorMessage(err)}${left !== undefined ? ` · ${left} attempt${left === 1 ? '' : 's'} left` : ''}`)
      setPin('')
    } finally {
      setBusy(false)
    }
  }

  return <Modal title={title} eyebrow="OWNER APPROVAL" onClose={onClose} footer={<>
    <button className="outline-button" onClick={onClose}>CANCEL</button>
    <button className="primary-button" disabled={!ready || busy} onClick={() => void approve()}>{busy ? 'CHECKING…' : confirmLabel}</button>
  </>}>
    {description && <p className="muted-text">{description}</p>}
    <div className="form-grid">
      {requireReason && <Field label="REASON"><input autoFocus value={reason} maxLength={255} placeholder="Why is this needed?" onChange={(e) => setReason(e.target.value)} /></Field>}
      <Field label="OWNER PIN" hint="The owner enters their 6-digit PIN on this terminal.">
        <PinInput autoFocus={!requireReason} value={pin} onChange={setPin} onEnter={() => void approve()} />
      </Field>
    </div>
    {error && <p className="pin-error" role="alert">{error}</p>}
  </Modal>
}

export default OwnerPinModal
