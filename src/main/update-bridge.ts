/** File bridge for desktop update state. Commands use instance-bound receipts. */
import { mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import { writeShellJson, type ShellReceipt } from '../../packages/shared/shell-protocol'
export type { ShellAction } from '../../packages/shared/shell-protocol'

export type UpdatePhase = 'idle' | 'checking' | 'downloading' | 'ready' | 'installing' | 'error'
export interface UpdateBridgeState {
  instanceId?: string
  supported?: boolean
  phase: UpdatePhase
  status: string
  version: string | null
  percent: number | null
  error: string | null
  lastCheckedAt: string | null
  updatedAt: string
  lastAction?: ShellReceipt
  pendingOperation?: { action: 'quit' | 'restart' | 'install'; message: string; canCancel: boolean }
}
export function bridgeStatePath(): string {
  return join(app.getPath('userData'), 'update-bridge', 'state.json')
}
let state: UpdateBridgeState = {
  phase: 'idle',
  status: '尚未检查',
  version: null,
  percent: null,
  error: null,
  lastCheckedAt: null,
  updatedAt: ''
}
function persist(): void {
  try {
    mkdirSync(join(app.getPath('userData'), 'update-bridge'), { recursive: true })
    writeShellJson(bridgeStatePath(), state)
  } catch (err) {
    process.stderr.write(`[dsh-px] 无法写入更新状态：${String(err)}\n`)
  }
}
export function setUpdateState(patch: Partial<Omit<UpdateBridgeState, 'updatedAt'>>): UpdateBridgeState {
  state = { ...state, ...patch, updatedAt: new Date().toISOString() }
  persist()
  return state
}
export function getUpdateState(): UpdateBridgeState {
  return state
}
/** Preserve only historical check time; ready/installing belong to one process. */
export function resetUpdateBridge(instanceId: string): void {
  let lastCheckedAt: string | null = null
  try {
    const saved = JSON.parse(readFileSync(bridgeStatePath(), 'utf8'))
    if (typeof saved?.lastCheckedAt === 'string' && Number.isFinite(Date.parse(saved.lastCheckedAt)))
      lastCheckedAt = saved.lastCheckedAt
  } catch {
    /* first boot */
  }
  state = {
    instanceId,
    phase: 'idle',
    status: '尚未检查',
    version: null,
    percent: null,
    error: null,
    lastCheckedAt,
    updatedAt: new Date().toISOString()
  }
  persist()
}
