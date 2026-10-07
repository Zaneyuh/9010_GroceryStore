// Preload runs in the sandboxed renderer, which only supports CommonJS — hence the .cts extension.
import electron = require('electron')

const { contextBridge, ipcRenderer } = electron

contextBridge.exposeInMainWorld('desktop', {
  getConfig: () => ipcRenderer.invoke('config:get'),
  saveConfig: (config: unknown) => ipcRenderer.invoke('config:save', config),
  relaunch: () => ipcRenderer.invoke('app:relaunch'),
  openTerminalWindow: (terminalId: string) => ipcRenderer.invoke('window:open-terminal', terminalId),
  hardware: {
    status: (device: 'printer' | 'scanner' | 'drawer') => ipcRenderer.invoke('hardware:status', device),
    openDrawer: () => ipcRenderer.invoke('hardware:open-drawer'),
    print: (data: unknown) => ipcRenderer.invoke('hardware:print', data),
  },
})
