import { app, ipcMain } from 'electron'
import { appConfigSchema, saveAppConfig, toPublicConfig, type AppConfig } from './appConfig.js'

export interface ServiceStatus {
  api: { state: 'not_used' | 'starting' | 'running' | 'restarting' | 'failed'; error: string | null }
  ml: { state: 'not_used' | 'checking' | 'ready' | 'missing_packages' | 'unavailable'; detail: string | null }
}

export interface IpcContext {
  getConfig: () => AppConfig
  setConfig: (config: AppConfig) => void
  getStatus: () => ServiceStatus
  openTerminalWindow: (terminalId: string) => void
}

/** Hardware devices handled in the Hardware step (receipt printer, barcode scanner, cash drawer). */
type HardwareDevice = 'printer' | 'scanner' | 'drawer'

export function registerIpcHandlers(context: IpcContext): void {
  ipcMain.handle('config:get', () => ({ ...toPublicConfig(context.getConfig()), status: context.getStatus() }))

  // Saves mode / terminal / server address / database settings from the setup screen. Applies after relaunch.
  ipcMain.handle('config:save', async (_event, input: unknown) => {
    const next = appConfigSchema.parse({ ...context.getConfig(), ...(input as object) })
    await saveAppConfig(app.getPath('userData'), next)
    context.setConfig(next)
    return { saved: true, restartRequired: true }
  })

  // Server PC only: open a window that acts as one cashier terminal (Admin Station → "Open window").
  ipcMain.handle('window:open-terminal', (_event, terminalId: unknown) => {
    if (context.getConfig().mode !== 'server') return { opened: false }
    if (typeof terminalId !== 'string' || !/^PC-\d{2}$/.test(terminalId) || terminalId === 'PC-00') return { opened: false }
    context.openTerminalWindow(terminalId)
    return { opened: true }
  })

  ipcMain.handle('app:relaunch', () => {
    app.relaunch()
    app.exit(0)
  })

  // Placeholders so the renderer API is stable; real WebUSB / WebSerial / WebHID wiring comes in the Hardware step.
  ipcMain.handle('hardware:status', (_event, device: HardwareDevice) => ({ device, connected: false, configured: false }))
  ipcMain.handle('hardware:open-drawer', () => ({ ok: false, error: 'Cash drawer is not configured yet' }))
  ipcMain.handle('hardware:print', () => ({ ok: false, error: 'Receipt printer is not configured yet' }))
}
