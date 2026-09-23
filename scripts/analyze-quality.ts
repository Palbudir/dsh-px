/** Read-only, content-minimizing diagnostics for this local application. */
import { readFileSync, writeFileSync, readdirSync, lstatSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { gunzipSync, zstdDecompressSync } from 'node:zlib'
import { summarizeAppLog } from '../src/shared/log-summary'
import { reviewEvents, type Event } from '../packages/dsh-px-taskflow/src/evidence'

const args = process.argv.slice(2), options: Record<string, string> = {}
for (let i = 0; i < args.length; i += 2) {
  if (!['--log', '--sessions', '--out'].includes(args[i]) || !args[i + 1]) throw new Error('用法：npm run audit:logs -- --log 文件 --sessions 会话目录 --out 汇总.json')
  options[args[i]] = args[i + 1]
}
if (!options['--log'] && !options['--sessions']) throw new Error('请显式指定要读取的日志或会话目录')
function readRows (file: string): any[] {
  const size = lstatSync(file).size
  if (size > 64 * 1024 * 1024) throw new Error('INPUT_LIMIT')
  const bytes = readFileSync(file), chunks: Buffer[] = []; let offset = 0, length = 0
  if (file.endsWith('.zstd')) while (offset < bytes.length) {
    // Node 24 returns engine consumption with info:true; @types/node omits this overload.
    const part = zstdDecompressSync(bytes.subarray(offset), { info: true, maxOutputLength: 128 * 1024 * 1024 - length }) as unknown as { buffer: Buffer, engine: { bytesWritten: number } }
    if (!Buffer.isBuffer(part.buffer) || !part.engine?.bytesWritten) throw new Error('EMPTY_FRAME')
    offset += part.engine.bytesWritten; length += part.buffer.length; chunks.push(part.buffer)
  }
  else chunks.push(file.endsWith('.gz') ? gunzipSync(bytes, { maxOutputLength: 128 * 1024 * 1024 }) : bytes)
  return Buffer.concat(chunks).toString('utf8').split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line))
}
const report: Record<string, unknown> = { capturedAt: new Date().toISOString(), countsIncludeInheritedOrCopiedRecords: true }
if (options['--log']) report.application = summarizeAppLog(readFileSync(resolve(options['--log']), 'utf8'))
if (options['--sessions']) {
  const root = resolve(options['--sessions']), sessions: unknown[] = []
  for (const rel of readdirSync(root, { recursive: true }).filter(p => typeof p === 'string' && /\.jsonl(?:\.zstd|\.gz)?$/.test(p)) as string[]) {
    const file = join(root, rel)
    if (lstatSync(file).isSymbolicLink()) continue
    try {
      const rows = readRows(file), header = rows.shift(), events = rows as Event[]
      const outcomes: Record<string, number> = {}, tools: Record<string, number> = {}, flagged: unknown[] = []
      let beforeSeq: number | undefined, pages = 0, total = 0, truncated = false
      do {
        const page = reviewEvents(events, false, { beforeSeq, limit: 50 }); total = page.total
        for (const call of page.executions) {
          const state = call.outcome === 'interrupted' || call.outcome === 'running' ? 'unsettled_or_interrupted' : call.outcome
          outcomes[state] = (outcomes[state] ?? 0) + 1; tools[call.tool] = (tools[call.tool] ?? 0) + 1
          if (state !== 'returned') flagged.push({ callId: call.id, seq: call.seq, tool: call.tool, state, source: call.outcomeSource })
        }
        beforeSeq = page.nextBeforeSeq ?? undefined
        if (++pages >= 200) { truncated = beforeSeq !== undefined; break }
      } while (beforeSeq !== undefined)
      sessions.push({ id: header.id, origin: header.origin ?? 'main', inherited: Boolean(header.isSeeded), events: events.length, calls: total, outcomes, tools, flagged, truncated })
    } catch (error) { sessions.push({ unreadable: true, errorType: error instanceof Error ? error.name : 'Unknown' }) }
  }
  report.sessions = sessions
}
const output = JSON.stringify(report, null, 2)
if (options['--out']) { writeFileSync(resolve(options['--out']), output + '\n'); process.stdout.write(`已写入诊断汇总：${options['--out']}\n`) }
else process.stdout.write(output + '\n')
