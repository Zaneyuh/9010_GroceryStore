export type ServiceState = {
  api: { state: 'not_used' | 'starting' | 'running' | 'restarting' | 'failed'; error: string | null }
  ml: { state: 'not_used' | 'checking' | 'ready' | 'missing_packages' | 'unavailable'; detail: string | null }
}

export interface DesktopConfig {
  mode: 'unconfigured' | 'server' | 'terminal'
  terminalId: string | null
  /** e.g. http://192.168.1.10:4010 — paths start with /api */
  apiBaseUrl: string
  status: ServiceState
}

type HardwareDevice = 'printer' | 'scanner' | 'drawer'

declare global {
  interface Window {
    /** Exposed by electron/preload.cts. Undefined when the UI runs in a plain browser (npm run dev). */
    desktop?: {
      getConfig: () => Promise<DesktopConfig>
      saveConfig: (config: Record<string, unknown>) => Promise<{ saved: boolean; restartRequired: boolean }>
      relaunch: () => Promise<void>
      /** Server PC only: opens a window acting as that cashier terminal. */
      openTerminalWindow: (terminalId: string) => Promise<{ opened: boolean }>
      hardware: {
        status: (device: HardwareDevice) => Promise<{ device: HardwareDevice; connected: boolean; configured: boolean }>
        openDrawer: () => Promise<{ ok: boolean; error?: string }>
        print: (data: unknown) => Promise<{ ok: boolean; error?: string }>
      }
    }
  }
}
