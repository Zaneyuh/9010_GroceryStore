import { useEffect, useState } from 'react'
import { iconRegistry } from '../icons/iconRegistry'
import { setActingTerminal } from '../lib/actingTerminal'
import { time } from '../lib/format'
import { apiErrorMessage, getTerminalChoices, type TerminalChoice } from '../services/api'
import { useStore } from '../store/StoreContext'

/**
 * First screen on the server PC: "I am… the owner / a cashier". The owner goes on to the PIN sign-in.
 * A cashier picks which register this PC is and gets the terminal lock screen, which unlocks when the owner
 * assigns them (from this PC after switching back, or from Admin Station's "Open window"). Real cashier PCs
 * never show this: their role is fixed at setup.
 */
function WhoIsUsing({ onOwner }: { onOwner: () => void }) {
  const { state } = useStore()
  const [now, setNow] = useState(() => new Date())
  const [picking, setPicking] = useState(false)
  const [choices, setChoices] = useState<TerminalChoice[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 15_000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    if (!picking) return
    let stopped = false
    // Refreshed while open, so a register that comes online elsewhere shows as in use.
    const load = () => getTerminalChoices().then((list) => { if (!stopped) { setChoices(list); setError(null) } }).catch((err) => { if (!stopped) setError(apiErrorMessage(err)) })
    void load()
    const timer = window.setInterval(load, 5_000)
    return () => { stopped = true; window.clearInterval(timer) }
  }, [picking])

  return <main className="login-screen">
    <section className="login-brand">
      <div className="brand-lockup"><div className="brand-mark" aria-hidden="true"><span>{iconRegistry.brandMark}</span></div><div><strong>9010</strong><span>GROCERY SYSTEM</span></div></div>
      <div className="login-hero"><span className="eyebrow">{state.settings.storeName.toUpperCase()}</span><h1>{time(now)}</h1><p>{now.toLocaleDateString('en-PH', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}</p></div>
      <ul className="login-features">
        <li><b>Owner</b><span>Signs in with a PIN: Admin Station, reports, inventory and settings</span></li>
        <li><b>Cashier</b><span>No sign-in: the register unlocks when the owner assigns you to it</span></li>
      </ul>
    </section>

    {!picking ? <section className="login-panel who-panel">
      <span className="eyebrow">WHO IS USING THIS PC?</span>
      <div className="who-choices">
        <button className="who-choice" onClick={onOwner}>
          <span className="who-icon" aria-hidden="true">⇄</span>
          <b>I am the owner</b>
          <small>Sign in with your 6-digit PIN</small>
        </button>
        <button className="who-choice" onClick={() => setPicking(true)}>
          <span className="who-icon" aria-hidden="true">▣</span>
          <b>I am a cashier</b>
          <small>Use this PC as a register</small>
        </button>
      </div>
    </section> : <section className="login-panel who-panel">
      <span className="eyebrow">WHICH REGISTER IS THIS?</span>
      {error && <p className="pin-error" role="alert">Can't reach the store server: {error}</p>}
      {!choices && !error && <p className="pin-caption">Loading registers…</p>}
      {choices && choices.length === 0 && <p className="pin-caption">No registers yet. The owner adds them in Admin Station.</p>}
      <div className="who-terminals">
        {/* Taken only while a cashier is on shift there. A free register still showing on another screen can be chosen. */}
        {choices?.map((t) => <button key={t.terminal_id} className="who-terminal" disabled={t.on_shift} onClick={() => setActingTerminal(t.terminal_id)}>
          <b>{t.terminal_id}</b>
          <small>{t.on_shift ? 'In use · cashier on shift' : t.terminal_name ?? 'Cashier terminal'}</small>
          {!t.on_shift && t.open_elsewhere && <em>Also open on another screen</em>}
        </button>)}
      </div>
      <p className="pin-caption">The register stays locked until the owner assigns you to it.</p>
      <button className="link-button" onClick={() => setPicking(false)}>← BACK</button>
    </section>}
  </main>
}

export default WhoIsUsing
