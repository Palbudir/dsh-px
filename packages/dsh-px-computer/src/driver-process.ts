/** The native driver runs outside DSH: crashes or blocked UIA calls must not strand the host. */
import { spawn, type ChildProcess } from 'node:child_process'
import type { DriverLike } from './desktop'

// Kept with the plugin bundle so file:/archive installs need no executable or build step.
const WORKER = String.raw`
process.on('disconnect', () => process.exit(0));
const { CuaDriver } = await import(process.argv[1]);
const driver = await CuaDriver.create(undefined);
process.on('message', async message => {
  if (!message || message.kind !== 'call') return;
  try {
    const result = await driver.callTool(message.name, message.args);
    process.send?.({ id: message.id, result });
  } catch (error) {
    process.send?.({ id: message.id, error: String(error?.message ?? error) });
  }
});
process.send?.({ ready: true });
`

export class DriverProcess implements DriverLike {
  private child?: ChildProcess
  private ready?: Promise<ChildProcess>
  private sequence = 0
  private pending = new Map<
    number,
    { resolve: (value: { rawJson: string }) => void; reject: (error: Error) => void }
  >()
  private closed = false
  constructor(
    private readonly moduleUrl: string,
    private readonly reset: () => void = () => {},
    private readonly timeoutMs = 45000
  ) {}

  private start(): Promise<ChildProcess> {
    if (this.closed) return Promise.reject(Error('电脑操作进程已关闭'))
    if (this.ready) return this.ready
    const child = spawn(process.execPath, ['--input-type=module', '-e', WORKER, this.moduleUrl], {
      windowsHide: true,
      env: { ...process.env, ...(process.versions.electron ? { ELECTRON_RUN_AS_NODE: '1' } : {}) },
      stdio: ['ignore', 'ignore', 'pipe', 'ipc']
    })
    this.child = child
    let stderr = ''
    child.stderr?.on('data', (chunk) => {
      stderr = (stderr + String(chunk)).slice(-2000)
    })
    const ready = new Promise<ChildProcess>((resolve, reject) => {
      const timer = setTimeout(() => fail(Error('电脑操作进程启动超时')), this.timeoutMs)
      const fail = (error: Error) => {
        clearTimeout(timer)
        reject(error)
        if (this.child === child) this.terminate(error)
      }
      child.once('error', fail)
      child.once('exit', (code, signal) =>
        fail(Error(`电脑操作进程已退出（${signal ?? code}）${stderr ? ': ' + stderr : ''}`))
      )
      child.on('message', (message: any) => {
        if (this.child !== child) return
        if (message?.ready) {
          clearTimeout(timer)
          resolve(child)
          return
        }
        const item = this.pending.get(message?.id)
        if (!item) return
        this.pending.delete(message.id)
        if (typeof message.error === 'string') item.reject(Error(message.error))
        else if (typeof message.result?.rawJson === 'string') item.resolve(message.result)
        else item.reject(Error('电脑操作进程返回了无效结果'))
      })
    })
    this.ready = ready
    return ready
  }

  private terminate(error: Error): void {
    const child = this.child
    this.child = undefined
    this.ready = undefined
    for (const item of this.pending.values()) item.reject(error)
    this.pending.clear()
    if (child) {
      child.kill()
      this.reset()
    }
  }

  async callTool(
    name: string,
    args: string,
    options?: { signal?: AbortSignal }
  ): Promise<{ rawJson: string }> {
    const signal = options?.signal
    signal?.throwIfAborted()
    // Includes startup: cancelling during native library initialization must be bounded too.
    let cancel!: (error: Error) => void
    const cancelled = new Promise<never>((_, reject) => {
      cancel = reject
    })
    const stop = (error: Error) => {
      this.terminate(error)
      cancel(error)
    }
    const abort = () => stop(Error('电脑操作已取消；动作可能已经生效，请重新观察后再决定下一步'))
    signal?.addEventListener('abort', abort, { once: true })
    const timer = setTimeout(
      () => stop(Error('电脑操作超时，已停止驱动进程；动作结果未知，不会自动重试')),
      this.timeoutMs
    )
    try {
      return await Promise.race([
        cancelled,
        (async () => {
          const child = await this.start()
          signal?.throwIfAborted()
          if (this.child !== child) throw Error('电脑操作进程已重置，请重新观察窗口')
          const id = ++this.sequence
          return await new Promise<{ rawJson: string }>((resolve, reject) => {
            this.pending.set(id, { resolve, reject })
            child.send({ kind: 'call', id, name, args }, (error) => {
              if (error && this.child === child) this.terminate(error)
            })
          })
        })()
      ])
    } finally {
      clearTimeout(timer)
      signal?.removeEventListener('abort', abort)
    }
  }

  async shutdown(): Promise<void> {
    this.closed = true
    this.terminate(Error('电脑操作进程已关闭，未完成动作的结果未知'))
  }
}
