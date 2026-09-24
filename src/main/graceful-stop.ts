interface Child {
  exitCode: number | null
  signalCode: string | null
  once(event: 'exit', callback: () => void): unknown
  removeListener(event: 'exit', callback: () => void): unknown
}

/** Startup cancellation must confirm exit; callers retain ownership when cancellation fails. */
export async function stopUnreadyChild(child: Child & { kill(): boolean }, timeoutMs = 5000): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return
  await new Promise<void>((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout>
    const cleanup = (): void => {
      clearTimeout(timer)
      child.removeListener('exit', exited)
    }
    const exited = (): void => {
      cleanup()
      resolve()
    }
    timer = setTimeout(() => {
      cleanup()
      reject(new Error('尚未确认新启动的 Agent 已退出；已保留进程句柄，请从恢复页处理。'))
    }, timeoutMs)
    child.once('exit', exited)
    try {
      child.kill()
    } catch (error) {
      cleanup()
      reject(error)
    }
  })
}

/** No profile preparation is allowed while the previous owned process may still use it. */
export async function prepareAfterServiceStops<T>(
  child: Pick<Child, 'exitCode' | 'signalCode'> | null,
  stop: () => Promise<void>,
  prepare: () => Promise<T>
): Promise<T> {
  if (child && child.exitCode === null && child.signalCode === null) {
    await stop()
    if (child.exitCode === null && child.signalCode === null)
      throw new Error('旧 Agent 进程尚未退出，工作配置未改动。')
  }
  return prepare()
}
export interface ShutdownAcknowledgement {
  acceptedAt: string
  error?: string
  errorCode?: string
}
export async function waitForGracefulStop(options: {
  child: Child
  trigger: () => Promise<void>
  acknowledgement: () => ShutdownAcknowledgement | null
  timeoutMs?: number
  pollMs?: number
}): Promise<void> {
  const { child } = options
  if (child.exitCode !== null || child.signalCode !== null) return
  let done!: () => void
  let fail!: (error: Error) => void
  const exited = new Promise<void>((resolve, reject) => {
    done = () => {
      if (child.exitCode === 0 && child.signalCode === null) resolve()
      else
        reject(
          new Error(
            `服务在正常停机期间异常退出（code=${String(child.exitCode)}, signal=${String(child.signalCode)}）；请检查日志后恢复。`
          )
        )
    }
    fail = reject
  })
  // The trigger and acknowledgement may settle before the process exit.
  void exited.catch(() => {})
  const rejectAck = (ack: ShutdownAcknowledgement | null): void => {
    if (ack?.error)
      fail(Object.assign(new Error(ack.error), { status: ack.errorCode === 'NEW_ACTIVITY' ? 409 : 503 }))
  }
  child.once('exit', done)
  const timer = setTimeout(
    () => fail(new Error('服务未能在 30 秒内正常停止；未强制结束工具进程，请查看日志。')),
    options.timeoutMs ?? 30000
  )
  const poll = setInterval(() => {
    try {
      rejectAck(options.acknowledgement())
    } catch {
      /* next poll */
    }
  }, options.pollMs ?? 100)
  try {
    try {
      await options.trigger()
    } catch (error) {
      const ack = options.acknowledgement()
      if (!ack) throw error
      rejectAck(ack)
    }
    await exited
  } finally {
    clearTimeout(timer)
    clearInterval(poll)
    child.removeListener('exit', done)
  }
}
