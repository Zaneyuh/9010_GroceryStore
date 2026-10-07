import { useEffect, useRef, useState, type FormEvent } from 'react'
import { LAST_USERNAME_KEY, useAuth } from '../context/AuthContext'
import { iconRegistry } from '../icons/iconRegistry'
import { time } from '../lib/format'
import { apiErrorDetails, apiErrorMessage, apiStatus, getAuthStatus } from '../services/api'
import { useStore } from '../store/StoreContext'

const PIN_LENGTH = 6

/** Owner sign-in for the Admin Station: username + 6-digit PIN. Cashiers never sign in. */
function OwnerLogin({ onBack }: { onBack?: () => void }) {
  const { state } = useStore()
  const { login } = useAuth()
  const [username, setUsername] = useState(() => { try { return localStorage.getItem(LAST_USERNAME_KEY) ?? '' } catch { return '' } })
  const [pin, setPin] = useState('')
  const [message, setMessage] = useState<{ text: string; tone: 'error' | 'locked' } | null>(null)
  const [busy, setBusy] = useState(false)
  const [now, setNow] = useState(() => new Date())
  const usernameRef = useRef<HTMLInputElement>(null)
  // A new system has only the default admin; say so instead of leaving the owner guessing.
  const [firstSignIn, setFirstSignIn] = useState(false)
  useEffect(() => {
    getAuthStatus().then((s) => setFirstSignIn(s.first_sign_in)).catch(() => undefined)
  }, [])

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 30_000)
    return () => window.clearInterval(timer)
  }, [])

  async function submit(nextPin = pin) {
    if (busy) return
    if (!username.trim()) {
      setMessage({ text: 'Enter your username.', tone: 'error' })
      usernameRef.current?.focus()
      return
    }
    if (nextPin.length !== PIN_LENGTH) return
    setBusy(true)
    setMessage(null)
    try {
      await login(username.trim(), nextPin)
    } catch (error) {
      const left = apiErrorDetails<{ attempts_left?: number }>(error)?.attempts_left
      const locked = apiStatus(error) === 423
      setMessage({
        text: locked ? apiErrorMessage(error) : `${apiErrorMessage(error)}${left !== undefined ? ` · ${left} attempt${left === 1 ? '' : 's'} left` : ''}`,
        tone: locked ? 'locked' : 'error',
      })
      window.setTimeout(() => setPin(''), 350)
    } finally {
      setBusy(false)
    }
  }

  function press(digit: string) {
    if (busy) return
    setMessage((m) => (m?.tone === 'locked' ? m : null))
    const next = (pin + digit).slice(0, PIN_LENGTH)
    setPin(next)
    if (next.length === PIN_LENGTH) void submit(next)
  }

  // Typing digits anywhere except the username field goes to the PIN.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (document.activeElement === usernameRef.current) return
      if (/^\d$/.test(event.key)) press(event.key)
      else if (event.key === 'Backspace') setPin((p) => p.slice(0, -1))
      else if (event.key === 'Escape') setPin('')
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const onUsernameSubmit = (event: FormEvent) => {
    event.preventDefault()
    ;(document.activeElement as HTMLElement | null)?.blur()
  }

  return <main className="login-screen">
    <section className="login-brand">
      <div className="brand-lockup"><div className="brand-mark" aria-hidden="true"><span>{iconRegistry.brandMark}</span></div><div><strong>9010</strong><span>GROCERY SYSTEM</span></div></div>
      <div className="login-hero"><span className="eyebrow">{state.settings.storeName.toUpperCase()} · ADMIN STATION</span><h1>{time(now)}</h1><p>{now.toLocaleDateString('en-PH', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}</p></div>
      <ul className="login-features">
        <li><b>Terminal assignment</b><span>Assign a cashier to any cashier PC — the terminal unlocks in seconds</span></li>
        <li><b>Owner PIN approvals</b><span>Voids, refunds, large discounts and no-sale drawer opens need your PIN</span></li>
        <li><b>Full audit trail</b><span>Every sale, assignment and override is logged to a session</span></li>
      </ul>
    </section>
    <section className="login-panel">
      <span className="eyebrow">OWNER SIGN-IN</span>
      <form className="login-username" onSubmit={onUsernameSubmit}>
        <label htmlFor="owner-username">USERNAME</label>
        <input id="owner-username" ref={usernameRef} autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} disabled={busy} />
      </form>
      <div className={message ? 'pin-dots error' : 'pin-dots'} aria-label={`${pin.length} of ${PIN_LENGTH} digits entered`}>{Array.from({ length: PIN_LENGTH }, (_, i) => <i key={i} className={i < pin.length ? 'filled' : ''} />)}</div>
      <p className={message ? `pin-caption ${message.tone}` : 'pin-caption'} role={message ? 'alert' : undefined}>{busy ? 'Checking…' : message?.text ?? 'Enter your 6-digit PIN'}</p>
      <div className="pin-pad">{['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => <button key={d} type="button" disabled={busy} onClick={() => press(d)}>{d}</button>)}<button type="button" onClick={() => setPin('')}>CLR</button><button type="button" disabled={busy} onClick={() => press('0')}>0</button><button type="button" onClick={() => setPin((p) => p.slice(0, -1))} aria-label="Delete digit">⌫</button></div>
      {firstSignIn
        ? <p className="demo-hint first-sign-in">First time? Sign in with username <b>admin</b> and PIN <b>000000</b>. You'll then set your own username, name and PIN.</p>
        : <p className="demo-hint">Cashiers do not sign in — the owner assigns them to a register.</p>}
      {onBack && <button className="link-button" onClick={onBack}>← NOT THE OWNER?</button>}
    </section>
  </main>
}

export default OwnerLogin
