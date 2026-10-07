import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useTerminalPolling } from '../hooks/useTerminalPolling'
import { actingTerminalId } from '../lib/actingTerminal'
import { setTerminalIdentity, setTerminalSessionToken, type TerminalStatus } from '../services/api'
import type { DesktopConfig } from '../types/desktop'

// Which role this PC plays, and — on a cashier terminal — who the owner has assigned to it.
//
// Mode comes from the Electron settings. In a plain browser (npm run dev) it is "server". On the server PC or in a
// browser, a window can also act as one terminal (src/lib/actingTerminal.ts); `acting` is then true.

export type DeviceMode = 'loading' | 'unconfigured' | 'server' | 'terminal'

interface TerminalValue {
  mode: DeviceMode
  terminalId: string | null
  apiBaseUrl: string | null
  status: TerminalStatus | null
  online: boolean
  error: string | null
  /** This window is the server PC (or a browser) acting as a terminal, not a real cashier PC. */
  acting: boolean
}

const TerminalContext = createContext<TerminalValue | null>(null)

export function TerminalProvider({ children }: { children: ReactNode }) {
  const [device, setDevice] = useState<{ mode: DeviceMode; terminalId: string | null; apiBaseUrl: string | null; acting: boolean }>({
    mode: 'loading',
    terminalId: null,
    apiBaseUrl: null,
    acting: false,
  })

  useEffect(() => {
    const acting = actingTerminalId()
    if (!window.desktop) {
      setDevice({ mode: acting ? 'terminal' : 'server', terminalId: acting, apiBaseUrl: null, acting: Boolean(acting) })
      return
    }
    window.desktop
      .getConfig()
      .then((config: DesktopConfig) => {
        // Only the server PC can act as a terminal; a real cashier PC always uses its own settings.
        if (config.mode === 'server' && acting) {
          setDevice({ mode: 'terminal', terminalId: acting, apiBaseUrl: config.apiBaseUrl, acting: true })
          return
        }
        setDevice({
          mode: config.mode === 'terminal' && !config.terminalId ? 'unconfigured' : config.mode,
          terminalId: config.terminalId,
          apiBaseUrl: config.apiBaseUrl,
          acting: false,
        })
      })
      .catch(() => setDevice({ mode: 'unconfigured', terminalId: null, apiBaseUrl: null, acting: false }))
  }, [])

  const isTerminal = device.mode === 'terminal'
  const poll = useTerminalPolling(isTerminal ? device.terminalId : null)

  useEffect(() => {
    setTerminalIdentity(isTerminal ? device.terminalId : null)
  }, [isTerminal, device.terminalId])

  useEffect(() => {
    setTerminalSessionToken(poll.status?.assigned ? poll.status.session_token : null)
  }, [poll.status])

  const value = useMemo<TerminalValue>(
    () => ({ ...device, status: poll.status, online: poll.online, error: poll.error }),
    [device, poll.status, poll.online, poll.error],
  )
  return <TerminalContext.Provider value={value}>{children}</TerminalContext.Provider>
}

export function useTerminal(): TerminalValue {
  const value = useContext(TerminalContext)
  if (!value) throw new Error('useTerminal must be used inside <TerminalProvider>')
  return value
}
