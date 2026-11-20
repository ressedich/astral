const { contextBridge, ipcRenderer } = require('electron')

const listeners = new Set()

ipcRenderer.on('astral:update', (_event, state) => {
  for (const listener of listeners) listener(state)
})

contextBridge.exposeInMainWorld('astral', {
  getUpdate: () => ipcRenderer.invoke('astral:update-get'),
  checkForUpdates: () => ipcRenderer.invoke('astral:update-check'),
  installUpdate: () => ipcRenderer.invoke('astral:update-install'),
  onUpdate: (listener) => {
    listeners.add(listener)
    return () => listeners.delete(listener)
  },
})
