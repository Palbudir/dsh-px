const { contextBridge, ipcRenderer } = require('electron')
contextBridge.exposeInMainWorld('pxUpdates', {
  call: (action) => ipcRenderer.invoke('dsh-px:updates', action)
})
