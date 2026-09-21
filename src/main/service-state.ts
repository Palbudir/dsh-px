import { mkdirSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ServiceState } from '../../packages/dsh-px-workbench/src/status'

/** 外壳心跳，不含鉴权 URL、模型密钥和会话正文。 */
export function createServiceState (dir: string): {
  set: (phase: ServiceState['phase'], message: string, pid?: number | null) => void
  dispose: () => void
} {
  let state: ServiceState = { phase: 'starting', message: '正在启动服务', pid: null, updatedAt: '' }
  const write = (): void => {
    try {
      mkdirSync(dir, { recursive: true })
      const path = join(dir, 'service-state.json')
      writeFileSync(path + '.tmp', JSON.stringify({ ...state, updatedAt: new Date().toISOString() }))
      renameSync(path + '.tmp', path)
    } catch (err) { process.stderr.write(`[dsh-px] 无法更新服务状态：${String(err)}\n`) }
  }
  const timer = setInterval(write, 4000)
  timer.unref()
  return {
    set: (phase, message, pid = null) => { state = { ...state, phase, message, pid }; write() },
    dispose: () => { clearInterval(timer); state = { ...state, phase: 'stopped', message: '桌面服务已停止', pid: null }; write() }
  }
}
