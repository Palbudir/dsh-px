export interface Activity {
  known: boolean
  runningAgents: number
  queuedInputs: number
  runningJobs: number
  openTerminals: number
}
export function isIdle(value: Activity): boolean {
  return (
    value.known === true &&
    [value.runningAgents, value.queuedInputs, value.runningJobs, value.openTerminals].every(
      (n) => Number.isSafeInteger(n) && n === 0
    )
  )
}
export function activityMessage(value: Activity): string {
  if (
    !value.known ||
    ![value.runningAgents, value.queuedInputs, value.runningJobs, value.openTerminals].every(
      (n) => Number.isSafeInteger(n) && n >= 0
    )
  )
    return '尚不能确认服务是否空闲，继续等待连接恢复。'
  const tasks =
    value.runningAgents + value.runningJobs + value.queuedInputs > 0
      ? `正在等待 ${value.runningAgents} 个 Agent、${value.runningJobs} 个后台任务及 ${value.queuedInputs} 条排队输入结束。`
      : ''
  const terminals =
    value.openTerminals > 0
      ? `还有 ${value.openTerminals} 项终端资源未关闭。请先关闭终端，或选择中止任务与终端后退出；打开的终端可能仍有命令在运行。`
      : ''
  return tasks + terminals || '服务当前空闲。'
}
export async function waitUntilIdle(options: {
  activity: () => Promise<Activity>
  signal: AbortSignal
  update: (message: string) => void
  interval?: number
}): Promise<void> {
  while (true) {
    options.signal.throwIfAborted()
    let value: Activity
    try {
      value = await options.activity()
    } catch {
      value = { known: false, runningAgents: 0, queuedInputs: 0, runningJobs: 0, openTerminals: 0 }
    }
    options.signal.throwIfAborted()
    if (isIdle(value)) return
    options.update(activityMessage(value))
    await new Promise<void>((resolve, reject) => {
      const done = (): void => {
        options.signal.removeEventListener('abort', abort)
        resolve()
      }
      const timer = setTimeout(done, options.interval ?? 1000)
      const abort = (): void => {
        clearTimeout(timer)
        options.signal.removeEventListener('abort', abort)
        reject(options.signal.reason)
      }
      options.signal.addEventListener('abort', abort, { once: true })
      if (options.signal.aborted) abort()
    })
  }
}
