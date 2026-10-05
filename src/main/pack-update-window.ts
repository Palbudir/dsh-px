import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { gt } from 'semver'
import type { PackDeployment, PackReceipt } from './pack-deployment'

// Electron is supplied by the pinned native entry, keeping this overlay on the same module instance.
export function createPackUpdateWindow(
  electron: any,
  options: {
    assets: string
    deployment: () => PackDeployment | undefined
    desktop: any
    restart: (version: string, commit: () => void) => Promise<boolean>
    /** Show the window that owns the native restart confirmation; it stays hidden while its parent is. */
    revealConfirmation?: () => void
    /** Reject a Desktop installation the silent installer would refuse after the app has quit. */
    checkInstall?: () => Promise<void>
    /** Note about a failed earlier installation of this version, read from the installer trace. */
    installFailure?: (version: string | undefined) => string | undefined
  }
): { open: () => void } {
  const { app, BrowserWindow, ipcMain, net } = electron
  const channel = 'dsh-px:updates',
    url = pathToFileURL(join(options.assets, 'px-updates.html')).href
  let window: any,
    busy = false,
    signed: string | undefined,
    prepared: PackReceipt | undefined
  let pack: Record<string, any> = { phase: 'idle' },
    desktopChecked = false,
    desktopError: string | undefined,
    failure: { version: string | undefined; note: string | undefined } | undefined
  const deployment = () => {
    const value = options.deployment()
    if (!value) throw Error('本机服务尚未准备好，请稍后重试。')
    return value
  }
  const state = () => {
    const d = options.deployment(),
      saved = d?.read()
    const desktop = { current: app.getVersion(), ...options.desktop.state }
    if (desktopChecked && desktop.phase === 'idle') desktop.phase = 'current'
    if (['available', 'ready'].includes(desktop.phase)) {
      // The window polls state; read the installer trace once per offered version.
      if (failure?.version !== desktop.version)
        failure = { version: desktop.version, note: options.installFailure?.(desktop.version) }
      desktop.notice = failure?.note
    }
    if (desktopError) {
      desktop.phase = 'error'
      desktop.message = desktopError
    }
    return {
      desktop,
      pack: {
        current: saved?.userManaged
          ? '自行管理'
          : (saved?.active?.version ?? d?.options.bundled.version ?? '准备中'),
        recovery: saved?.error,
        ...pack
      },
      busy
    }
  }
  const fetchBytes = async (url: string, limit: number, progress?: (n: number) => void): Promise<Buffer> => {
    const controller = new AbortController(),
      timeout = setTimeout(() => controller.abort(), progress ? 180000 : 10000)
    try {
      const response = await net.fetch(url, { signal: controller.signal, cache: 'no-store' })
      if (!response.ok || !response.body) throw Error(`下载失败（HTTP ${response.status}）`)
      const reader = response.body.getReader(),
        chunks: Buffer[] = []
      let count = 0
      try {
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          count += value.byteLength
          if (count > limit) throw Error('下载内容超出签名清单大小')
          chunks.push(Buffer.from(value))
          progress?.(count)
        }
      } finally {
        await reader.cancel().catch(() => {})
      }
      return Buffer.concat(chunks)
    } finally {
      clearTimeout(timeout)
    }
  }
  const execute = async (action: string): Promise<void> => {
    if (action === 'check-pack') {
      if (deployment().read().userManaged) throw Error('当前使用自行安装的 Pack，请通过原生插件管理器更新。')
      pack = { phase: 'checking' }
      prepared = undefined
      signed = undefined
      signed = (
        await fetchBytes('https://raw.githubusercontent.com/Palbudir/dsh-px/updates/pack-preview.json', 65536)
      ).toString('utf8')
      const manifest = deployment().manifest(signed)
      const current = deployment().read().active?.version ?? deployment().options.bundled.version
      pack = {
        phase: gt(manifest.version, current) ? 'available' : 'current',
        version: manifest.version,
        size: manifest.files[0].size
      }
    } else if (action === 'download-pack') {
      if (!signed || pack.phase !== 'available') throw Error('请先检查 Pack 更新')
      const manifest = deployment().manifest(signed),
        file = manifest.files[0]
      const began = Date.now()
      pack = { phase: 'downloading', version: manifest.version, total: file.size, transferred: 0, percent: 0 }
      const bytes = await fetchBytes(file.url, Math.min(file.size, 32 * 1024 * 1024), (n) => {
        pack = {
          ...pack,
          transferred: n,
          percent: Math.floor((100 * n) / file.size),
          bytesPerSecond: (n * 1000) / Math.max(1, Date.now() - began)
        }
      })
      pack = { ...pack, phase: 'preparing' }
      prepared = deployment().stage(signed, bytes)
      pack = { phase: 'ready', version: prepared.version }
    } else if (action === 'install-pack') {
      if (!prepared || pack.phase !== 'ready') throw Error('Pack 尚未准备完成')
      const receipt = prepared
      options.revealConfirmation?.()
      if (await options.restart(receipt.version, () => deployment().queue(receipt)))
        pack = { phase: 'installing', version: receipt.version }
    } else if (action === 'check-desktop') {
      await options.desktop.check(true)
      desktopChecked = true
    } else if (action === 'download-desktop') await options.desktop.download(options.desktop.state.version)
    else if (action === 'install-desktop') {
      await options.checkInstall?.()
      options.revealConfirmation?.()
      await options.desktop.install(options.desktop.state.version)
    } else throw Error('Unknown update action')
  }
  ipcMain.handle(channel, async (event: any, action: unknown) => {
    if (
      !window ||
      window.isDestroyed() ||
      event.sender !== window.webContents ||
      event.senderFrame !== window.webContents.mainFrame ||
      event.senderFrame.url !== url
    )
      throw Error('Update window is not the sender')
    if (action === 'status') return state()
    if (typeof action !== 'string' || busy) return state()
    busy = true
    if (action.endsWith('desktop')) desktopError = undefined
    try {
      await execute(action)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (action.endsWith('desktop')) desktopError = message
      else pack = { ...pack, phase: 'error', message }
    } finally {
      busy = false
    }
    return state()
  })
  const open = () => {
    if (window && !window.isDestroyed()) {
      window.show()
      window.focus()
      return
    }
    window = new BrowserWindow({
      width: 650,
      height: 630,
      minWidth: 540,
      minHeight: 530,
      title: 'DSH-PX 更新',
      autoHideMenuBar: true,
      webPreferences: {
        preload: join(options.assets, 'px-update-preload.cjs'),
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false
      }
    })
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    window.webContents.on('will-navigate', (event: any) => event.preventDefault())
    window.on('closed', () => {
      window = undefined
    })
    void window.loadFile(join(options.assets, 'px-updates.html'))
  }
  app.on('second-instance', (_event: unknown, args: string[]) => {
    if (args.some((arg) => /^dsh-px:\/\/updates\/?$/.test(arg))) open()
  })
  app.on('open-url', (event: any, target: string) => {
    if (/^dsh-px:\/\/updates\/?$/.test(target)) {
      event.preventDefault()
      open()
    }
  })
  if (process.argv.some((arg) => /^dsh-px:\/\/updates\/?$/.test(arg))) open()
  return { open }
}
