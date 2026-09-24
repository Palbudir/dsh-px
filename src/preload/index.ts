import { contextBridge, ipcRenderer } from 'electron'

/** Page-surface identity, never an authorization token for desktop operations. */
contextBridge.exposeInMainWorld('dshPxShell', {
  app: 'DSH-PX',
  surface: 'desktop',
  electron: process.versions.electron
})

// Recovery is available only to the shipped file page; main verifies its exact URL.
if (location.protocol === 'file:') {
  contextBridge.exposeInMainWorld('dshPxRecovery', {
    act: (
      action: 'retry' | 'log' | 'data' | 'cancel-pending' | 'force-restart' | 'force-quit' | 'force-install'
    ) => ipcRenderer.invoke('dsh-px:recover', action)
  })
}
