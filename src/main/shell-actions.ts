import { mkdirSync, readFileSync, readdirSync, renameSync, statSync, unlinkSync, watch } from 'node:fs'
import { join } from 'node:path'
import {
  shellActions,
  writeShellJson,
  type ShellRequest,
  type ShellReceipt
} from '../../packages/shared/shell-protocol'

export function serveShellActions(options: {
  dir: string
  instanceId: string
  onReceipt?: (receipt: ShellReceipt) => void
  onAction: (
    request: ShellRequest
  ) =>
    | Promise<{ status?: 'completed' | 'waiting'; message: string }>
    | { status?: 'completed' | 'waiting'; message: string }
}): () => void {
  const base = join(options.dir, 'update-bridge'),
    requests = join(base, 'requests'),
    receipts = join(base, 'receipts')
  mkdirSync(requests, { recursive: true })
  mkdirSync(receipts, { recursive: true })
  let stopped = false
  const active = new Set<string>()
  const publish = (request: ShellRequest, status: ShellReceipt['status'], message: string): void => {
    const receipt: ShellReceipt = {
      id: request.id,
      instanceId: request.instanceId,
      action: request.action,
      status,
      message,
      updatedAt: new Date().toISOString()
    }
    writeShellJson(join(receipts, `${request.id}.json`), receipt)
    if (request.instanceId === options.instanceId) options.onReceipt?.(receipt)
  }
  const publishTerminal = (request: ShellRequest, status: ShellReceipt['status'], message: string): void => {
    try {
      publish(request, status, message)
    } catch (error) {
      // Side effects may already have completed. Do not replay or kill the desktop
      // because a diagnostic receipt could not be persisted.
      process.stderr.write(`[dsh-px] 操作 ${request.id} 已处理，但回执无法保存：${String(error)}\n`)
      try {
        options.onReceipt?.({
          ...request,
          status: 'failed',
          message: '操作可能已执行，但结果无法保存。请先核对状态，勿直接重复操作。',
          updatedAt: new Date().toISOString()
        })
      } catch {
        /* diagnostic consumer failed */
      }
    }
  }
  const scan = (): void => {
    if (stopped) return
    for (const file of readdirSync(requests)
      .filter((n) => /^[a-f0-9-]{36}\.json$/.test(n))
      .slice(0, 50)) {
      const source = join(requests, file),
        claimed = source + '.claimed'
      let request: ShellRequest
      try {
        if (statSync(source).size > 2048) {
          unlinkSync(source)
          continue
        }
        request = JSON.parse(readFileSync(source, 'utf8'))
        if (
          `${request.id}.json` !== file ||
          !shellActions.includes(request.action) ||
          typeof request.instanceId !== 'string' ||
          typeof request.createdAt !== 'string'
        ) {
          unlinkSync(source)
          continue
        }
        renameSync(source, claimed)
      } catch {
        continue
      }
      try {
        unlinkSync(claimed)
      } catch {
        /* no replay of claimed commands */
      }
      const age = Date.now() - Date.parse(request.createdAt)
      if (request.instanceId !== options.instanceId || !Number.isFinite(age) || age < -5000 || age > 15000) {
        publishTerminal(request, 'rejected', '桌面实例已变化或请求已过期，请刷新后重试。')
        continue
      }
      if (active.has(request.action)) {
        publishTerminal(request, 'rejected', '同类桌面操作正在处理，请先查看结果。')
        continue
      }
      active.add(request.action)
      // Receipt is persisted before side effects, including teardown of the HTTP server.
      try {
        publish(request, 'received', '桌面已接收操作。')
      } catch (error) {
        active.delete(request.action)
        process.stderr.write(`[dsh-px] 操作尚未执行，接收回执无法保存：${String(error)}\n`)
        continue
      }
      void Promise.resolve()
        .then(() => options.onAction(request))
        .then((result) => {
          publishTerminal(request, result.status ?? 'completed', result.message)
        })
        .catch((error) => {
          publishTerminal(
            request,
            error instanceof Error && error.name === 'AbortError' ? 'cancelled' : 'failed',
            error instanceof Error ? error.message : String(error)
          )
        })
        .finally(() => active.delete(request.action))
    }
  }
  const cleanup = (): void => {
    const entries = readdirSync(receipts)
      .filter((n) => /^[a-f0-9-]{36}\.json$/.test(n))
      .map((name) => ({ name, time: statSync(join(receipts, name)).mtimeMs }))
      .sort((a, b) => b.time - a.time)
    for (const entry of entries.slice(100))
      if (Date.now() - entry.time > 300000) {
        try {
          unlinkSync(join(receipts, entry.name))
        } catch {
          /* retained for next sweep */
        }
      }
  }
  const timer = setInterval(() => {
    try {
      scan()
      cleanup()
    } catch (e) {
      process.stderr.write(`[dsh-px] 桌面动作桥：${String(e)}\n`)
    }
  }, 250)
  timer.unref()
  let watcher: ReturnType<typeof watch> | undefined
  try {
    watcher = watch(requests, () => {
      try {
        scan()
      } catch {
        /* interval retries */
      }
    })
  } catch {
    /* polling remains active */
  }
  try {
    scan()
  } catch (error) {
    process.stderr.write(`[dsh-px] 桌面动作桥暂不可用：${String(error)}\n`)
  }
  return () => {
    stopped = true
    clearInterval(timer)
    watcher?.close()
  }
}
