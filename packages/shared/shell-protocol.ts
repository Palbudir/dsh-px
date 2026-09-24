import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

export type ShellAction = 'check' | 'install' | 'restart' | 'open-data' | 'open-log' | 'cancel-pending'
export const shellActions: readonly ShellAction[] = [
  'check',
  'install',
  'restart',
  'open-data',
  'open-log',
  'cancel-pending'
]
export interface ShellHeartbeat {
  instanceId: string
  phase: 'starting' | 'running' | 'restarting' | 'draining' | 'error' | 'stopped'
  message: string
  pid: number | null
  /** Desktop and last child identity retained after exit for offline maintenance. */
  ownerPid?: number
  ownerStartedAt?: string
  lastAgentPid?: number | null
  updatedAt: string
  runtimeMode: 'packaged' | 'development'
  appVersion: string
  currentOrigin?: string
}
export interface ShellRequest {
  id: string
  instanceId: string
  action: ShellAction
  createdAt: string
}
export interface ShellReceipt {
  id: string
  instanceId: string
  action: ShellAction
  status: 'received' | 'completed' | 'waiting' | 'cancelled' | 'rejected' | 'failed'
  message: string
  updatedAt: string
}
export class ShellUnavailable extends Error {
  constructor(
    message: string,
    readonly status = 503
  ) {
    super(message)
  }
}
export function freshHeartbeat(dir: string | undefined, now = Date.now()): ShellHeartbeat | null {
  if (!dir) return null
  try {
    const value = JSON.parse(readFileSync(join(dir, 'service-state.json'), 'utf8'))
    const age = now - Date.parse(value.updatedAt)
    if (
      typeof value.instanceId !== 'string' ||
      !/^[\w-]{16,80}$/.test(value.instanceId) ||
      !['starting', 'running', 'restarting', 'draining', 'error'].includes(value.phase) ||
      !Number.isFinite(age) ||
      age < -5000 ||
      age > 15000
    )
      return null
    return value
  } catch {
    return null
  }
}
export function writeShellJson(file: string, value: unknown): void {
  const tmp = `${file}.${randomUUID()}.tmp`
  try {
    writeFileSync(tmp, JSON.stringify(value), { mode: 0o600 })
    renameSync(tmp, file)
  } finally {
    try {
      unlinkSync(tmp)
    } catch (e: any) {
      if (e?.code !== 'ENOENT') throw e
    }
  }
}
export function readShellReceipt(dir: string, id: string, instanceId: string): ShellReceipt | null {
  if (!/^[a-f0-9-]{36}$/.test(id)) return null
  try {
    const row = JSON.parse(readFileSync(join(dir, 'update-bridge', 'receipts', `${id}.json`), 'utf8'))
    return row.id === id && row.instanceId === instanceId ? row : null
  } catch {
    return null
  }
}
/** A request succeeds only after the current desktop process acknowledges it. */
export async function requestShellAction(
  dir: string | undefined,
  action: ShellAction,
  options: {
    timeoutMs?: number
    pollMs?: number
  } = {}
): Promise<ShellReceipt> {
  const heartbeat = freshHeartbeat(dir)
  if (!heartbeat || !dir) throw new ShellUnavailable('桌面服务未连接；请先打开 DSH-PX 客户端。')
  if (!shellActions.includes(action)) throw new ShellUnavailable('未知桌面操作。', 400)
  const requests = join(dir, 'update-bridge', 'requests')
  mkdirSync(requests, { recursive: true })
  const request: ShellRequest = {
    id: randomUUID(),
    instanceId: heartbeat.instanceId,
    action,
    createdAt: new Date().toISOString()
  }
  const file = join(requests, `${request.id}.json`)
  writeShellJson(file, request)
  const deadline = Date.now() + (options.timeoutMs ?? 6000)
  while (Date.now() < deadline) {
    const receipt = readShellReceipt(dir, request.id, heartbeat.instanceId)
    if (receipt) {
      if (receipt.status === 'rejected' || receipt.status === 'failed')
        throw new ShellUnavailable(receipt.message, 409)
      return receipt
    }
    if (freshHeartbeat(dir)?.instanceId !== heartbeat.instanceId) break
    await new Promise((resolve) => setTimeout(resolve, options.pollMs ?? 50))
  }
  // Removing an unclaimed request prevents it executing after the caller sees a timeout.
  // If already claimed, its durable receipt remains the authority; never retry blindly.
  if (existsSync(file))
    try {
      unlinkSync(file)
    } catch {
      /* server may have claimed it */
    }
  throw new ShellUnavailable('桌面未确认接收；请核对当前状态后重试，避免重复操作。')
}
