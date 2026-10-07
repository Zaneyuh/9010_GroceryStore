import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { iconRegistry } from '../icons/iconRegistry'
import { initials, time } from '../lib/format'
import { useStore } from '../store/StoreContext'

function Login() {
  const { state, actions } = useStore()
  const navigate = useNavigate()
  const people = state.employees.filter((e) => e.status === 'Active')
  const [selectedId, setSelectedId] = useState(people[0]?.id ?? '')
  const [pin, setPin] = useState('')
  const [error, setError] = useState(false)
  const [now, setNow] = useState(() => new Date())
  const selected = people.find((e) => e.id === selectedId)

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 30_000)
    return () => window.clearInterval(timer)
  }, [])

  function press(digit: string) {
    if (!selected) return
    setError(false)
    const next = (pin + digit).slice(0, 4)
    setPin(next)
    if (next.length === 4) {
      if (next === selected.pin) {
        actions.login(selected.id)
        navigate('/workspace')
      } else {
        setError(true)
        window.setTimeout(() => setPin(''), 350)
      }
    }
  }

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (/^\d$/.test(event.key)) press(event.key)
      else if (event.key === 'Backspace') setPin((p) => p.slice(0, -1))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  return <main className="login-screen">
    <section className="login-brand">
      <div className="brand-lockup"><div className="brand-mark" aria-hidden="true"><span>{iconRegistry.brandMark}</span></div><div><strong>9010</strong><span>GROCERY SYSTEM</span></div></div>
      <div className="login-hero"><span className="eyebrow">{state.settings.storeName.toUpperCase()} · TERMINAL {state.settings.machineSerial.slice(-2)}</span><h1>{time(now)}</h1><p>{now.toLocaleDateString('en-PH', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}</p></div>
      <ul className="login-features"><li><b>Point of sale</b><span>Fast checkout with Senior/PWD discounts, GCash &amp; card</span></li><li><b>AI demand forecasting</b><span>WMA, exponential smoothing and trend models per product</span></li><li><b>Smart replenishment</b><span>Reorder quantities, expiry risk and basket analysis</span></li></ul>
    </section>
    <section className="login-panel">
      <span className="eyebrow">WHO’S SIGNING IN?</span>
      <div className="login-people">{people.map((person) => <button key={person.id} className={person.id === selectedId ? 'selected' : ''} onClick={() => { setSelectedId(person.id); setPin(''); setError(false) }}><span className="avatar">{initials(person.name)}</span><b>{person.name}</b><small>{person.role.toUpperCase()}</small></button>)}</div>
      <div className={error ? 'pin-dots error' : 'pin-dots'} aria-label={`${pin.length} of 4 digits entered`}>{[0, 1, 2, 3].map((i) => <i key={i} className={i < pin.length ? 'filled' : ''} />)}</div>
      <p className="pin-caption">{error ? 'Incorrect PIN. Try again.' : `Enter ${selected?.name.split(' ')[0] ?? 'your'}’s 4-digit PIN`}</p>
      <div className="pin-pad">{['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => <button key={d} onClick={() => press(d)}>{d}</button>)}<button onClick={() => setPin('')}>CLR</button><button onClick={() => press('0')}>0</button><button onClick={() => setPin((p) => p.slice(0, -1))} aria-label="Delete digit">⌫</button></div>
      <p className="demo-hint">Demo PIN for everyone · 0000</p>
    </section>
  </main>
}

export default Login
