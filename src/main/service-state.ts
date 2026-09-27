import { mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { writeShellJson, type ShellHeartbeat } from '../../packages/shared/shell-protocol'

export function createServiceState(
  dir: string,
  identity: Partial<Pick<ShellHeartbeat, 'instanceId' | 'runtimeMode' | 'appVersion'>> = {}
) {
  let previous: Partial<ShellHeartbeat> | null = null
  try {
    previous = JSON.parse(readFileSync(join(dir, 'service-state.json'), 'utf8'))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
      throw new Error('无法核对上次桌面进程记录；已保留原文件，请先检查数据目录中的 service-state.json。')
  }
  if (
    previous &&
    (!['starting', 'running', 'restarting', 'draining', 'error', 'stopped'].includes(previous.phase ?? '') ||
      !(previous.pid === null || (Number.isSafeInteger(previous.pid) && Number(previous.pid) > 0)))
  ) {
    throw new Error('上次桌面进程记录不完整，已保留原文件；请先检查数据目录中的 service-state.json。')
  }
  // A completed shutdown has already awaited child exit; its numeric PIDs may have been reused.
  const previousPids =
    previous?.phase === 'stopped'
      ? []
      : [
          previous?.pid,
          previous?.lastAgentPid,
          previous?.ownerPid === process.pid ? null : previous?.ownerPid
        ]
  for (const pid of new Set(
    previousPids.filter((value): value is number => Number.isSafeInteger(value) && Number(value) > 0)
  )) {
    let alive = true
    try {
      process.kill(pid, 0)
    } catch (error) {
      alive = (error as NodeJS.ErrnoException).code !== 'ESRCH'
    }
    if (alive)
      throw new Error(
        `上次记录的进程编号仍被使用（PID ${pid}），暂不能确认 Agent 已退出。请先核对该服务再重试；不会覆盖进程记录或修改正在使用的数据。`
      )
  }
  let state: ShellHeartbeat = {
    phase: 'starting',
    message: '正在启动服务',
    pid: null,
    updatedAt: '',
    ownerPid: process.pid,
    ownerStartedAt: new Date(Date.now() - process.uptime() * 1000).toISOString(),
    lastAgentPid: previous?.lastAgentPid ?? previous?.pid ?? null,
    instanceId: identity.instanceId ?? randomUUID(),
    runtimeMode: identity.runtimeMode ?? 'development',
    appVersion: identity.appVersion ?? ''
  }
  const write = (required = false): void => {
    try {
      mkdirSync(dir, { recursive: true })
      writeShellJson(join(dir, 'service-state.json'), { ...state, updatedAt: new Date().toISOString() })
    } catch (error) {
      if (required) throw error
      process.stderr.write(`[dsh-px] 无法写入服务状态：${String(error)}\n`)
    }
  }
  // Persist process ownership before any profile mutation or native child can start.
  write(true)
  const timer = setInterval(() => write(), 4000)
  timer.unref()
  return {
    recordChild(pid: number) {
      if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error('Agent 进程编号无效')
      state = { ...state, phase: 'starting', message: '正在连接本机服务', pid, lastAgentPid: pid }
      write(true)
    },
    set(phase: ShellHeartbeat['phase'], message: string, pid: number | null = null) {
      state = { ...state, phase, message, pid, lastAgentPid: pid ?? state.lastAgentPid }
      write()
    },
    origin(currentOrigin: string) {
      state = { ...state, currentOrigin }
      write()
    },
    dispose() {
      clearInterval(timer)
      state = { ...state, phase: 'stopped', message: '桌面服务已停止', pid: null }
      write()
    }
  }
}
