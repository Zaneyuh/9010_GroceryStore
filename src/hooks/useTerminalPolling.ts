import { useEffect, useRef, useState } from 'react'
import { apiErrorMessage, getTerminalStatus, sendHeartbeat, type TerminalStatus } from '../services/api'

export interface TerminalPollState {
  status: TerminalStatus | null
  /** False after a failed poll; the last known status is kept so a brief LAN blip does not lock the POS. */
  online: boolean
  error: string | null
}

const HEARTBEAT_MS = 30_000

/**
 * Asks the server every `intervalMs` who is assigned to this terminal. Polls never overlap:
 * the next one is scheduled after the previous finishes. Also sends a heartbeat every 30 s.
 */
export function useTerminalPolling(terminalId: string | null, intervalMs = 2000): TerminalPollState {
  const [state, setState] = useState<TerminalPollState>({ status: null, online: false, error: null })
  const stopped = useRef(false)

  useEffect(() => {
    if (!terminalId) return
    stopped.current = false
    let timer: number | undefined

    const poll = async () => {
      try {
        const status = await getTerminalStatus(terminalId)
        if (!stopped.current) setState({ status, online: true, error: null })
      } catch (error) {
        if (!stopped.current) setState((previous) => ({ ...previous, online: false, error: apiErrorMessage(error) }))
      } finally {
        if (!stopped.current) timer = window.setTimeout(poll, intervalMs)
      }
    }
    void poll()

    const beat = () => void sendHeartbeat(terminalId).catch(() => undefined)
    beat()
    const heartbeat = window.setInterval(beat, HEARTBEAT_MS)

    return () => {
      stopped.current = true
      window.clearTimeout(timer)
      window.clearInterval(heartbeat)
    }
  }, [terminalId, intervalMs])

  return state
}
