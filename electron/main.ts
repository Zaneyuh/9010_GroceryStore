import { app, BrowserWindow, dialog, Menu, utilityProcess, type UtilityProcess } from 'electron'
import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { ChildMessage, ParentMessage } from '../server/index.js'
import { loadAppConfig, saveAppConfig, type AppConfig } from './appConfig.js'
import { registerIpcHandlers, type ServiceStatus } from './ipc-handlers.js'

const here = path.dirname(fileURLToPath(import.meta.url)) // dist-electron/electron
const isDev = !app.isPackaged
const DEV_SERVER_URL = 'http://localhost:5173'
const API_READY_TIMEOUT_MS = 60_000
const MAX_RESTARTS_PER_MINUTE = 5

let config: AppConfig
let mainWindow: BrowserWindow | null = null
let api: UtilityProcess | null = null
let quitting = false
const restartTimes: number[] = []
const status: ServiceStatus = { api: { state: 'not_used', error: null }, ml: { state: 'not_used', detail: null } }

// In development everything is read from the project folder; packaged builds read from resources/.
const resourceDir = (name: string) => (isDev ? path.join(app.getAppPath(), name) : path.join(process.resourcesPath, name))

function pythonPath(): string {
  if (config.mlPython) return config.mlPython
  const dir = resourceDir('ml_service')
  const venv = process.platform === 'win32' ? path.join(dir, '.venv', 'Scripts', 'python.exe') : path.join(dir, '.venv', 'bin', 'python')
  if (existsSync(venv)) return venv
  return process.platform === 'win32' ? 'python' : 'python3'
}

// ---------------------------------------------------------------------------
// Express API — runs as a child process so a crash or a slow query never freezes the window.
// ---------------------------------------------------------------------------

function startApi(): Promise<void> {
  status.api = { state: status.api.state === 'restarting' ? 'restarting' : 'starting', error: null }
  const child = utilityProcess.fork(path.join(here, '..', 'server', 'index.js'), [], {
    serviceName: '9010-api',
    stdio: 'pipe',
    env: {
      ...process.env,
      NODE_ENV: isDev ? 'development' : 'production',
      APP_VERSION: app.getVersion(),
      API_BIND_HOST: '0.0.0.0',
      API_PORT: String(config.apiPort),
      DB_HOST: config.database.host,
      DB_PORT: String(config.database.port),
      DB_USER: config.database.user,
      DB_PASSWORD: config.database.password,
      DB_NAME: config.database.name,
      DATABASE_DIR: resourceDir('database'),
      ML_SERVICE_DIR: resourceDir('ml_service'),
      ML_PYTHON: pythonPath(),
      JWT_SECRET: config.jwtSecret,
    },
  })
  api = child
  child.stdout?.on('data', (chunk: Buffer) => process.stdout.write(chunk))
  child.stderr?.on('data', (chunk: Buffer) => process.stderr.write(chunk))

  return new Promise<void>((resolve, reject) => {
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      reject(new Error(`API did not start within ${API_READY_TIMEOUT_MS / 1000} seconds`))
    }, API_READY_TIMEOUT_MS)

    child.on('message', (message: ChildMessage) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (message.type === 'ready') {
        status.api = { state: 'running', error: null }
        resolve()
      } else {
        status.api = { state: 'failed', error: message.error }
        reject(new Error(message.error))
      }
    })

    child.on('exit', (code) => {
      api = null
      clearTimeout(timer)
      if (!settled) {
        settled = true
        status.api = { state: 'failed', error: status.api.error ?? `API exited with code ${code}` }
        reject(new Error(status.api.error ?? `API exited with code ${code}`))
        return
      }
      if (!quitting && status.api.state === 'running') scheduleRestart(code)
    })
  })
}

function scheduleRestart(code: number): void {
  const now = Date.now()
  while (restartTimes.length && now - restartTimes[0] > 60_000) restartTimes.shift()
  if (restartTimes.length >= MAX_RESTARTS_PER_MINUTE) {
    status.api = { state: 'failed', error: `API crashed ${MAX_RESTARTS_PER_MINUTE} times in a minute (last exit code ${code})` }
    dialog.showErrorBox('Store server stopped', `${status.api.error}. Restart the application.`)
    return
  }
  restartTimes.push(now)
  status.api = { state: 'restarting', error: `API exited with code ${code}; restarting` }
  console.error(`[main] ${status.api.error}`)
  setTimeout(() => startApi().catch((error: Error) => console.error('[main] Restart failed:', error.message)), 2_000)
}

function stopApi(): Promise<void> {
  const child = api
  if (!child) return Promise.resolve()
  return new Promise<void>((resolve) => {
    const force = setTimeout(() => {
      child.kill()
      resolve()
    }, 5_000)
    child.once('exit', () => {
      clearTimeout(force)
      resolve()
    })
    child.postMessage({ type: 'shutdown' } satisfies ParentMessage)
  })
}

// ---------------------------------------------------------------------------
// Python ML service — invoked per request by the API; checked once here at startup.
// ---------------------------------------------------------------------------

function checkMlService(): void {
  status.ml = { state: 'checking', detail: null }
  const python = pythonPath()
  const script = path.join(resourceDir('ml_service'), 'predict.py')
  const py = spawn(python, [script, '--health'], { windowsHide: true })
  let out = ''
  py.stdout.on('data', (chunk: Buffer) => (out += chunk.toString('utf8')))
  py.on('error', (error) => {
    status.ml = { state: 'unavailable', detail: `Could not start ${python}: ${error.message}` }
    console.warn(`[main] ML service unavailable — ${status.ml.detail}. Run "npm run ml:install".`)
  })
  py.on('close', (code) => {
    if (status.ml.state !== 'checking') return
    try {
      const report = JSON.parse(out) as { status: string; python: string; packages: Record<string, string | null> }
      const missing = Object.entries(report.packages).filter(([, v]) => !v).map(([k]) => k)
      status.ml = missing.length
        ? { state: 'missing_packages', detail: `Missing: ${missing.join(', ')}` }
        : { state: 'ready', detail: `Python ${report.python}` }
    } catch {
      status.ml = { state: 'unavailable', detail: `predict.py --health exited with code ${code}` }
    }
    console.log(`[main] ML service: ${status.ml.state}${status.ml.detail ? ` (${status.ml.detail})` : ''}`)
  })
}

// ---------------------------------------------------------------------------
// Window and lifecycle
// ---------------------------------------------------------------------------

/** Opens an app window. With terminalId it acts as that cashier terminal (see openTerminalWindow); otherwise it is this PC's main window. */
function openAppWindow(terminalId?: string): BrowserWindow {
  const window = new BrowserWindow({
    width: terminalId ? 1180 : 1280,
    height: terminalId ? 760 : 800,
    minWidth: 1024,
    minHeight: 700,
    title: terminalId ? `9010 Grocery Store · ${terminalId}` : '9010 Grocery Store',
    webPreferences: {
      preload: path.join(here, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  const query = terminalId ? { terminal: terminalId } : undefined
  if (isDev) {
    window.loadURL(query ? `${DEV_SERVER_URL}/?${new URLSearchParams(query)}` : DEV_SERVER_URL)
    // There is no menu bar (see Menu.setApplicationMenu in createWindow), so its developer shortcuts are added back here.
    // The installed app has none of them, so cashiers can't open DevTools or reload mid-sale.
    window.webContents.on('before-input-event', (event, input) => {
      if (input.type !== 'keyDown') return
      const key = input.key.toLowerCase()
      if (key === 'f12' || (input.control && input.shift && key === 'i')) window.webContents.toggleDevTools()
      else if (key === 'f5' || (input.control && key === 'r')) window.webContents.reload()
      else return
      event.preventDefault()
    })
  } else {
    window.loadFile(path.join(app.getAppPath(), 'dist', 'index.html'), { query })
  }
  return window
}

function createWindow(): void {
  // No File / Edit / View / Window menu bar. Copy and paste in text fields still work on Windows without it.
  Menu.setApplicationMenu(null)
  mainWindow = openAppWindow()
  mainWindow.on('closed', () => {
    mainWindow = null
    // Terminal windows only make sense next to the owner's window.
    for (const window of terminalWindows.values()) window.close()
  })
}

const terminalWindows = new Map<string, BrowserWindow>()

/**
 * Server PC only: an extra window that behaves exactly like cashier PC `terminalId` (locked until the owner assigns
 * a cashier), so the owner can see a register's screen next to the Admin Station. One window per terminal.
 */
function openTerminalWindow(terminalId: string): void {
  const existing = terminalWindows.get(terminalId)
  if (existing && !existing.isDestroyed()) {
    existing.focus()
    return
  }
  const window = openAppWindow(terminalId)
  terminalWindows.set(terminalId, window)
  window.on('closed', () => terminalWindows.delete(terminalId))
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  })

  app.whenReady().then(async () => {
    if (isDev) await import('dotenv/config')
    config = await loadAppConfig(app.getPath('userData'), process.env)
    registerIpcHandlers({ getConfig: () => config, setConfig: (next) => (config = next), getStatus: () => status, openTerminalWindow })

    if (config.mode === 'server') {
      if (!config.jwtSecret) {
        config = { ...config, jwtSecret: randomBytes(48).toString('hex') }
        await saveAppConfig(app.getPath('userData'), config)
      }
      try {
        await startApi()
        console.log(`[main] API running on port ${config.apiPort}`)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        console.error('[main] API failed to start:', message)
        dialog.showErrorBox('Store server could not start', `${message}\n\nCheck that MySQL is running and the database settings are correct.`)
      }
      checkMlService()
    }

    createWindow()
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })

  app.on('before-quit', (event) => {
    if (quitting || !api) return
    event.preventDefault()
    quitting = true
    stopApi().finally(() => app.quit())
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}
