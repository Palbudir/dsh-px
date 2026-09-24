import { createHash } from 'node:crypto'
import { win32 } from 'node:path'
export interface CommandRetryRequest {
  command: string
  workdir: string
  timeoutMs?: number
}
export interface CommandGuidance {
  kind: 'windows-child-pipe'
  message: string
  unavailableReason?: string
  request?: CommandRetryRequest
}
interface Candidate {
  request?: CommandRetryRequest
  key?: string
  commandKey?: string
  mode?: string
  seq: number
  chars: number
}
const validMode = (value: unknown): value is string =>
  typeof value === 'string' && ['read-only', 'workspace-write', 'danger-full-access'].includes(value)
/** This is a diagnosis of persisted command output, not proof that a test assertion ran. */
export function hasWindowsChildPipeFailure(text: string): boolean {
  const exit = /\[exit code: (-?\d+)\]\s*$/.exec(text)
  return (
    /\bspawn(?:Sync)? EPERM\b/.test(text) &&
    /node:(?:internal\/)?child_process/.test(text) &&
    Boolean(exit && Number.isSafeInteger(Number(exit[1])) && Number(exit[1]) !== 0)
  )
}
function capture(args: any, seq: number, mode?: string): Candidate {
  const candidate: Candidate = {
    seq,
    mode: validMode(args.sandbox_permissions) ? args.sandbox_permissions : mode,
    chars: 0
  }
  if (typeof args.command === 'string' && args.command.length <= 20000)
    candidate.commandKey = 'command:' + createHash('sha256').update(args.command).digest('hex')
  if (
    typeof args.command !== 'string' ||
    !args.command.trim() ||
    args.command.length > 20000 ||
    typeof args.workdir !== 'string' ||
    args.workdir.length > 4096 ||
    !/^(?:[a-z]:[\\/]|\\\\[^\\/]+[\\/])/i.test(args.workdir) ||
    args.run_in_background === true
  )
    return candidate
  if (
    args.timeoutMs !== undefined &&
    (typeof args.timeoutMs !== 'number' || !Number.isFinite(args.timeoutMs) || args.timeoutMs <= 0)
  )
    return candidate
  candidate.request = {
    command: args.command,
    workdir: args.workdir,
    ...(args.timeoutMs === undefined ? {} : { timeoutMs: args.timeoutMs })
  }
  candidate.key = createHash('sha256')
    .update(win32.normalize(args.workdir).toLowerCase() + '\0' + args.command)
    .digest('hex')
  candidate.chars = args.command.length + args.workdir.length
  return candidate
}
/** Minimal command facts only; approvals and current policy stay owned by native DSH. */
export class CommandGuidanceIndex {
  private pending = new Map<string, Candidate>()
  private failures = new Map<string, Candidate>()
  private approvals = new Map<string, { key: string; commandKey?: string }>()
  private blocked = new Set<string>()
  private returned = new Map<string, number>()
  private mode: string | undefined
  private approval: string | undefined
  private chars = 0
  get cacheCost(): number {
    return (
      this.chars * 2 +
      (this.pending.size +
        this.failures.size +
        this.approvals.size +
        this.blocked.size +
        this.returned.size) *
        160
    )
  }
  observe(type: string, data: any): void {
    if (type === 'sandbox/mode' && validMode(data.mode)) this.mode = data.mode
    if (type === 'approval/policy' && ['ask', 'never'].includes(data.policy)) this.approval = data.policy
    if (type === 'approval/asked' && data.toolName === 'pwsh' && typeof data.id === 'string') {
      const candidate = this.pending.get(data.callId) ?? this.failures.get(data.callId)
      if (candidate?.key || candidate?.commandKey)
        this.approvals.set(data.id, {
          key: candidate.key ?? candidate.commandKey!,
          commandKey: candidate.commandKey
        })
    }
    if (type === 'approval/decided') {
      const approval = this.approvals.get(data.id)
      if (approval) {
        if (['rejected', 'cancelled', 'unavailable'].includes(data.outcome)) this.blocked.add(approval.key)
        else if (data.outcome === 'allowed-once') {
          this.blocked.delete(approval.key)
          if (approval.commandKey) this.blocked.delete(approval.commandKey)
        }
        this.approvals.delete(data.id)
      }
    }
    if (['turn/start', 'turn/end', 'session/end-seed'].includes(type)) {
      for (const candidate of this.pending.values()) this.chars -= candidate.chars
      this.pending.clear()
      this.approvals.clear()
    }
  }
  start(id: string, tool: string, args: unknown, seq: number): void {
    for (const map of [this.pending, this.failures]) {
      const old = map.get(id)
      if (old) this.chars -= old.chars
      map.delete(id)
    }
    if (tool !== 'pwsh' || !args || typeof args !== 'object') return
    const candidate = capture(args, seq, this.mode)
    this.pending.set(id, candidate)
    this.chars += candidate.chars
  }
  finish(id: string, outcome: string, text: string): void {
    const candidate = this.pending.get(id)
    if (!candidate) return
    this.pending.delete(id)
    if (outcome === 'error' && hasWindowsChildPipeFailure(text)) this.failures.set(id, candidate)
    else {
      this.chars -= candidate.chars
      if (outcome === 'returned' && candidate.key) this.returned.set(candidate.key, candidate.seq)
    }
  }
  guidance(id: string, platform = process.platform): CommandGuidance | undefined {
    const candidate = this.failures.get(id)
    if (!candidate || platform !== 'win32') return undefined
    const guide: CommandGuidance = {
      kind: 'windows-child-pipe',
      message:
        '记录包含非零退出标记和 spawn EPERM。Windows 受限环境不支持部分子进程命名管道操作，默认 Node 测试等命令可能在运行断言前停止。一次性批准路径仍由 DSH 原生审批处理。'
    }
    if (!candidate.request)
      guide.unavailableReason = '记录缺少完整原命令或明确工作目录，不能从摘要自动准备重试。'
    else if (
      (candidate.key && this.blocked.has(candidate.key)) ||
      (candidate.commandKey && this.blocked.has(candidate.commandKey))
    )
      guide.unavailableReason = '该命令的审批已被拒绝、取消或未完成，保持停止；不会继续建议授权重试。'
    else if (candidate.key && (this.returned.get(candidate.key) ?? -1) > candidate.seq)
      guide.unavailableReason = '之后已有同命令正常返回的记录，请先核对后续结果，避免重复执行。'
    else if (!candidate.mode || !['read-only', 'workspace-write'].includes(candidate.mode))
      guide.unavailableReason = '无法确认该调用处于受限模式；此错误不能直接作为扩大权限的依据。'
    else if (!this.mode || !['read-only', 'workspace-write'].includes(this.mode))
      guide.unavailableReason = '当前会话不处于可确认的受限模式，不准备重复扩大权限请求。'
    else if (this.approval !== 'ask')
      guide.unavailableReason = '当前会话未启用可确认的审批模式，保持命令停止。'
    else guide.request = { ...candidate.request }
    return guide
  }
}
