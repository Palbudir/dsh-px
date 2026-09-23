import type { AppUpdater } from 'electron-updater'
import type { AppUpdaterEvents } from 'electron-updater/out/AppUpdater'
import type { UpdateBridgeState } from './update-bridge'

type State = Omit<UpdateBridgeState, 'updatedAt'>
type Updater = Pick<AppUpdater, 'on' | 'removeListener' | 'checkForUpdates' | 'downloadUpdate' | 'quitAndInstall' | 'autoDownload' | 'autoInstallOnAppQuit'>

/** 手动检查只接触更新器及启动检查计时器，不参与 Agent 服务的生命周期。 */
export function createManualUpdateCheck (
  getController: () => Pick<UpdateController, 'check'> | null,
  cancelStartupCheck: () => void
): () => Promise<void> {
  return async () => {
    cancelStartupCheck()
    await getController()?.check()
  }
}

/** 更新事件只注册一次；托盘、启动检查和设置页共用同一条状态机。 */
export class UpdateController {
  private state: State
  private checking = false
  private downloading = false
  private disposed = false
  private installTimer: ReturnType<typeof setTimeout> | undefined
  private watchdog: ReturnType<typeof setTimeout> | undefined
  private removeListeners: Array<() => void> = []

  constructor (private updater: Updater, private options: {
    publish: (state: State) => void
    ready?: (version: string) => void
    installing?: (version: string) => void
    lastCheckedAt?: string | null
    now?: () => string
    installDelayMs?: number
    installTimeoutMs?: number
  }) {
    this.state = { phase: 'idle', status: '尚未检查', version: null, percent: null, error: null,
      lastCheckedAt: options.lastCheckedAt ?? null }
    updater.autoDownload = false
    updater.autoInstallOnAppQuit = true
    this.listen('checking-for-update', () => this.publish({ phase: 'checking', status: '正在检查更新…', error: null }))
    this.listen('update-not-available', (info: { version: string }) => {
      this.publish({ phase: 'idle', status: '已是最新版本', version: info.version, percent: null,
        error: null, lastCheckedAt: this.now() })
    })
    this.listen('update-available', (info: { version: string }) => { void this.download(info.version) })
    this.listen('download-progress', (progress: { percent: number }) => {
      if (this.state.phase !== 'downloading') return
      const percent = Math.max(0, Math.min(100, Math.round(progress.percent)))
      this.publish({ percent, status: `正在下载 ${percent}%` })
    })
    this.listen('update-downloaded', (info: { version: string }) => {
      if (this.state.phase === 'ready' && this.state.version === info.version) return
      updater.autoInstallOnAppQuit = true
      this.publish({ phase: 'ready', status: `已下载 ${info.version}，待重启安装`, version: info.version,
        percent: 100, error: null })
      options.ready?.(info.version)
    })
    // 必须在首次检查之前注册：网络失败也会先 emit('error') 再 reject。
    this.listen('error', (error: unknown) => this.fail(error))
    this.publish({})
  }

  private now (): string { return this.options.now?.() ?? new Date().toISOString() }

  private listen<K extends keyof AppUpdaterEvents> (event: K, listener: AppUpdaterEvents[K]): void {
    this.updater.on(event, listener)
    this.removeListeners.push(() => this.updater.removeListener(event, listener))
  }

  private publish (patch: Partial<State>): void {
    if (this.disposed) return
    this.state = { ...this.state, ...patch }
    this.options.publish({ ...this.state })
  }

  getState (): Readonly<State> { return { ...this.state } }

  private fail (error: unknown): void {
    if (this.disposed) return
    const installing = this.state.phase === 'installing'
    if (installing) {
      clearTimeout(this.installTimer)
      clearTimeout(this.watchdog)
      // 已知安装失败后，普通退出不应再次偷偷运行同一份安装包。
      this.updater.autoInstallOnAppQuit = false
    }
    this.publish({ phase: 'error', status: installing ? '安装未能启动，请重新检查更新' : '更新失败，请重试',
      percent: null, error: error instanceof Error ? error.message : String(error),
      ...(this.checking ? { lastCheckedAt: this.now() } : {}) })
  }

  async check (): Promise<void> {
    if (this.disposed || this.checking || this.downloading || ['ready', 'installing'].includes(this.state.phase)) return
    this.checking = true
    this.publish({ phase: 'checking', status: '正在检查更新…', error: null, percent: null })
    try {
      const result = await this.updater.checkForUpdates()
      if (result === null && this.state.phase === 'checking') this.fail('更新器没有返回检查结果')
    } catch (error) {
      this.fail(error)
    } finally {
      this.checking = false
    }
  }

  private async download (version: string): Promise<void> {
    if (this.disposed || this.downloading || ['ready', 'installing'].includes(this.state.phase)) return
    this.downloading = true
    this.publish({ phase: 'downloading', status: `正在下载 ${version}`, version, percent: 0,
      error: null, lastCheckedAt: this.now() })
    try {
      await this.updater.downloadUpdate()
    } catch (error) {
      this.fail(error)
    } finally {
      this.downloading = false
    }
  }

  install (): boolean {
    if (this.disposed || this.state.phase !== 'ready') return false
    this.publish({ phase: 'installing', status: '即将退出并安装更新，安装完成后自动重启', error: null })
    this.options.installing?.(this.state.version ?? '')
    // 提示期间 harness 保持运行，设置页才能读到 installing 状态。
    this.installTimer = setTimeout(() => {
      if (this.disposed || this.state.phase !== 'installing') return
      this.watchdog = setTimeout(() => {
        this.fail('更新器未能退出应用；当前会话仍可使用，请重新检查更新或打开日志排查。')
      }, this.options.installTimeoutMs ?? 15000)
      try {
        // 返回值是 void。正常退出由更新器负责，不能把 undefined 当作失败强退。
        this.updater.quitAndInstall(true, true)
      } catch (error) {
        this.fail(error)
      }
    }, this.options.installDelayMs ?? 9000)
    return true
  }

  dispose (): void {
    this.disposed = true
    clearTimeout(this.installTimer)
    clearTimeout(this.watchdog)
    for (const remove of this.removeListeners) remove()
    this.removeListeners = []
  }
}
