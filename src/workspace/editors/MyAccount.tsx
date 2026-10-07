import { useState, type FormEvent } from 'react'
import { useAuth } from '../../context/AuthContext'
import { apiErrorDetails, apiErrorMessage } from '../../services/api'
import { useStore } from '../../store/StoreContext'
import { Field, PinInput } from '../ui'

/** Same rule as the server (server/utils/validators.ts): no repeated digit or straight run. */
function guessable(pin: string) {
  const digits = [...pin].map(Number)
  const steps = new Set(digits.slice(1).map((d, i) => d - digits[i]))
  return steps.size === 1 && [0, 1, -1].includes([...steps][0])
}

/**
 * Settings → My account: the owner's own username, name and PIN. On the first sign-in (default admin / 000000)
 * this is the only thing that works, and a new username and PIN are required.
 */
export function MyAccount() {
  const { actions } = useStore()
  const { user, updateAccount } = useAuth()
  const firstTime = Boolean(user?.must_change_credentials)
  const [form, setForm] = useState({
    username: firstTime ? '' : user?.username ?? '',
    firstName: firstTime ? '' : user?.first_name ?? '',
    lastName: firstTime ? '' : user?.last_name ?? '',
    currentPin: '',
    newPin: '',
    confirm: '',
  })
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  if (!user) return <p className="muted-text">Only the owner has an account here; cashiers are assigned to registers.</p>
  const set = (key: keyof typeof form, value: string) => { setForm((f) => ({ ...f, [key]: value })); setError(null) }

  const username = form.username.trim().toLowerCase()
  const changingPin = firstTime || form.newPin.length > 0
  const problems = [
    !form.firstName.trim() || !form.lastName.trim() ? 'your first and last name' : null,
    !/^[a-z0-9._-]{3,30}$/.test(username) ? 'a username (3–30 letters, numbers, . _ -)' : username === 'admin' ? 'your own username instead of “admin”' : null,
    !/^\d{6}$/.test(form.currentPin) ? (firstTime ? 'the current PIN (000000)' : 'your current PIN to confirm') : null,
    changingPin && !/^\d{6}$/.test(form.newPin) ? 'a new 6-digit PIN' : null,
    changingPin && /^\d{6}$/.test(form.newPin) && guessable(form.newPin) ? 'a PIN that isn’t a repeated digit or a straight run like 123456' : null,
    changingPin && /^\d{6}$/.test(form.newPin) && form.confirm !== form.newPin ? 'the new PIN twice' : null,
  ].filter(Boolean)

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (problems.length || busy) return
    setBusy(true)
    setError(null)
    try {
      await updateAccount({ username, first_name: form.firstName.trim(), last_name: form.lastName.trim(), current_pin: form.currentPin, new_pin: changingPin ? form.newPin : undefined })
      // Current PIN keeps its dots (now the new PIN if it was changed); only the one-time new/confirm boxes are cleared.
      setForm((f) => ({ ...f, currentPin: changingPin ? f.newPin : f.currentPin, newPin: '', confirm: '' }))
      if (firstTime) {
        actions.toast('Your account is set up. Next, fill in your store details.')
        actions.setUi({ settingsSection: 'Business profile' })
        void actions.refreshLive()
      } else {
        actions.toast('Account updated')
      }
    } catch (err) {
      const fields = apiErrorDetails<{ field: string; message: string }[]>(err)
      const left = apiErrorDetails<{ attempts_left?: number }>(err)?.attempts_left
      setError(Array.isArray(fields) && fields.length ? fields.map((f) => f.message).join(' · ') : `${apiErrorMessage(err)}${left !== undefined ? ` · ${left} attempt${left === 1 ? '' : 's'} left` : ''}`)
    } finally {
      setBusy(false)
    }
  }

  const pin = (key: 'currentPin' | 'newPin' | 'confirm', label: string, hint?: string) => <Field label={label} hint={hint}>
    <PinInput value={form[key]} autoComplete={key === 'currentPin' ? 'current-password' : 'new-password'} onChange={(value) => set(key, value)} />
  </Field>

  return <form onSubmit={(e) => void submit(e)}>
    {firstTime
      ? <><h2>Set up your account</h2><p>You signed in with the default admin account. Before using the system, replace it with your own username, name and a PIN only you know. Everything else unlocks once this is saved.</p></>
      : <><h2>My account</h2><p>Your sign-in details. Your PIN also approves voids, refunds and large discounts on the registers.</p></>}
    <div className="form-row">
      <Field label="FIRST NAME"><input autoFocus value={form.firstName} maxLength={50} autoComplete="given-name" onChange={(e) => set('firstName', e.target.value)} /></Field>
      <Field label="LAST NAME"><input value={form.lastName} maxLength={50} autoComplete="family-name" onChange={(e) => set('lastName', e.target.value)} /></Field>
    </div>
    <Field label="USERNAME" hint="What you type when signing in."><input value={form.username} maxLength={30} autoComplete="username" autoCapitalize="none" onChange={(e) => set('username', e.target.value)} /></Field>
    {pin('currentPin', 'CURRENT PIN', firstTime ? 'The default PIN you just used: 000000.' : 'Confirms it’s you.')}
    <div className="form-row">
      {pin('newPin', firstTime ? 'NEW PIN (6 DIGITS)' : 'NEW PIN (OPTIONAL)', firstTime ? undefined : 'Leave empty to keep your PIN.')}
      {pin('confirm', 'CONFIRM NEW PIN')}
    </div>
    {problems.length > 0 && (form.username || form.currentPin || form.newPin) && <p className="muted-text">Still needed: {problems.join(', ')}.</p>}
    {error && <p className="pin-error" role="alert">{error}</p>}
    <div className="form-actions"><span>{firstTime ? 'REQUIRED BEFORE USING THE SYSTEM' : user.username?.toUpperCase()}</span><div>
      <button className="primary-button" type="submit" disabled={problems.length > 0 || busy}>{busy ? 'SAVING…' : firstTime ? 'SAVE AND CONTINUE' : 'SAVE ACCOUNT'}</button>
    </div></div>
  </form>
}
