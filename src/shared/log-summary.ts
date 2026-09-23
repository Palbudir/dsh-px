export interface BootSummary { version: string, startedAt: string, updaterFailureLines: number, exits: { expected: number, unexplained: number } }
/** Count only diagnostic patterns. Tool output containing the word Error is not a crash. */
export function summarizeAppLog (text: string): { boots: BootSummary[], structuredEvents: Record<string, number>, note: string } {
  const boots: BootSummary[] = [], structuredEvents: Record<string, number> = {}
  let current: BootSummary | undefined, lastIntent = -1000
  const allowed = new Set(['schedule.dispatching', 'schedule.settled', 'annotation.saved', 'annotation.deleted', 'schedule.saved', 'schedule.deleted'])
  const lines = text.split(/\r?\n/)
  lines.forEach((line, index) => {
    const boot = /\[dsh-px\] 启动 (\S+)\s+版本 (\d+\.\d+\.\d+[\w.+-]*)/.exec(line)
    if (boot) { current = { startedAt: boot[1], version: boot[2], updaterFailureLines: 0, exits: { expected: 0, unexplained: 0 } }; boots.push(current); lastIntent = -1000 }
    if (/Install on explicit quitAndInstall|处理界面请求：restart|正在重启 Agent 服务/.test(line)) lastIntent = index
    if (current && /\[dsh-px\] 检查更新失败：/.test(line)) current.updaterFailureLines++
    if (current && /harness exited code=/.test(line)) {
      if (index - lastIntent < 30 || /code=0 /.test(line)) current.exits.expected++
      else current.exits.unexplained++
    }
    const marker = '[dsh-px-event] ', start = line.indexOf(marker)
    if (start >= 0) try {
      const data = JSON.parse(line.slice(start + marker.length))
      if (allowed.has(data.event)) structuredEvents[data.event] = (structuredEvents[data.event] ?? 0) + 1
    } catch { /* Do not echo malformed log bodies. */ }
  })
  return { boots, structuredEvents, note: '按日志行计数；未标明原因的退出需结合操作时间核对，不能自动认定为崩溃。未导出正文、路径或凭据。' }
}
