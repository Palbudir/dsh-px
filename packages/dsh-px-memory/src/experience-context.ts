import { randomUUID } from 'node:crypto'
import { historyRecord, service, type HistoryEvent } from './history'
import { MemoryError, type MemoryStore } from './store'
import type { ExperienceCaller } from './experience'

/** Best-effort minimization for common credential forms, not a claim that arbitrary prose is secret-free. */
export function redactExperienceText(text: string): string {
  return text
    .replace(/\b(?:sk|sk-proj)-[A-Za-z0-9_-]{12,}\b/g, '[redacted-key]')
    .replace(/\bBearer\s+[^\s"'<>]+/gi, 'Bearer [redacted]')
    .replace(/(https?:\/\/)[^\s/@:]+:[^\s/@]+@/gi, '$1[redacted]@')
    .replace(/([?&](?:token|key|access_token|api_key|auth)=)[^\s&#"'<>]+/gi, '$1[redacted]')
    .replace(
      /((?:api[_-]?key|access[_-]?token|client[_-]?secret|password)\s*[=:]\s*)(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s,;}]+)/gi,
      '$1[redacted]'
    )
}

/** Completed source events only: no hidden reasoning, system prompt, private-memory copies or unfinished tail. */
export function experienceWindow(events: readonly HistoryEvent[], sessionId: string, project: string) {
  const end = events.findLastIndex((e) => e.type === 'turn/end')
  if (end < 0) throw new MemoryError('当前会话还没有已结束的轮次可整理', 409)
  const cut = events[end].seq,
    names = new Map<string, string>(),
    turns: Array<{ seq: number; turn: number }> = []
  let config: any
  // Inspect metadata once. Do not concatenate, redact or retain every historical message body.
  for (let i = 0; i <= end; i++) {
    const event = events[i]
    if (event.type === 'turn/start')
      turns.push({ seq: event.seq, turn: event.data?.turn ?? turns.at(-1)?.turn ?? 0 })
    if (['tool/call', 'tool/ptc-dispatch-start'].includes(event.type))
      names.set(event.data.callId ?? event.data.subCallId, event.data.name)
    if (event.type === 'request/header') config = event.data?.header?.config
  }
  const turnAt = (seq: number): number => {
    let low = 0,
      high = turns.length
    while (low < high) {
      const mid = (low + high) >>> 1
      if (turns[mid].seq <= seq) low = mid + 1
      else high = mid
    }
    return turns[low - 1]?.turn ?? 0
  }
  const rows: Array<{
    index: number
    turn: number
    kind: 'user' | 'assistant' | 'tool'
    text: string
    tool?: { name: string; ok: boolean }
    at: string
  }> = []
  let latestUser: (typeof rows)[number] | undefined
  for (let i = end; i >= 0; i--) {
    if (rows.length >= 80 && latestUser) break
    const event = events[i]
    if (!['user/message', 'assistant/message', 'tool/result', 'tool/ptc-dispatch'].includes(event.type))
      continue
    // A long tool-only turn can have its user requirement much earlier than the recent 80 rows.
    if (rows.length >= 80 && event.type !== 'user/message') continue
    const record = historyRecord(event, (id) => names.get(id))
    if (
      !record ||
      !(
        ['user', 'assistant', 'tool-result'].includes(record.kind) ||
        (record.kind === 'ledger' && record.tool === 'task_checkpoint')
      )
    )
      continue
    const raw = redactExperienceText(record.text)
    const text = raw.length > 2000 ? raw.slice(0, 1970) + '\n…（原始记录较长，已截断）' : raw
    if (!text.trim()) continue
    const blocks =
      event.type === 'tool/ptc-dispatch'
        ? [event.data]
        : event.data?.message?.role === 'tool'
          ? [event.data.message]
          : (event.data?.message?.content ?? [])
    const row: (typeof rows)[number] = {
      index: event.seq + 1,
      turn: turnAt(event.seq),
      kind: record.tool ? 'tool' : (record.kind as 'user' | 'assistant'),
      text: `事件 ${event.seq}: ${text}`,
      ...(record.tool
        ? { tool: { name: record.tool, ok: !blocks.some((b: any) => b.isError === true) } }
        : {}),
      at: new Date(event.time).toISOString()
    }
    if (row.kind === 'user' && !latestUser) latestUser = row
    if (rows.length < 80) rows.push(row)
  }
  // Keep a bounded recent window; source indices remain exact native event positions.
  if (!latestUser) throw new MemoryError('来源会话没有可见的用户要求', 409)
  const steps: typeof rows = [latestUser]
  let chars = latestUser.text.length
  for (const row of rows) {
    if (row === latestUser) continue
    if (chars + row.text.length > 16_000) break
    steps.push(row)
    chars += row.text.length
  }
  steps.sort((a, b) => a.index - b.index)
  if (typeof config?.provider !== 'string' || typeof config?.model !== 'string')
    throw new MemoryError('来源会话没有可用的模型记录', 409)
  return {
    throughSeq: cut,
    model: {
      provider: config.provider,
      model: config.model,
      ...(typeof config.reasoningEffort === 'string' ? { reasoningEffort: config.reasoningEffort } : {})
    },
    trajectory: {
      sessionId,
      workspace: project,
      startedAt: steps[0].at,
      endedAt: steps.at(-1)!.at,
      steps,
      stats: {
        turns: new Set(steps.map((s) => s.turn)).size,
        userCharacters: steps.filter((s) => s.kind === 'user').reduce((n, s) => n + s.text.length, 0),
        toolCalls: steps.filter((s) => s.kind === 'tool').length,
        toolFailures: steps.filter((s) => s.tool?.ok === false).length,
        uniqueTools: new Set(steps.filter((s) => s.tool).map((s) => s.tool!.name)).size,
        skills: []
      },
      annotations: []
    }
  }
}

/** Native non-activating projection owns the last used route; no full event log is requested here. */
export async function experienceSessionModel(host: any, sessionId: string) {
  if (typeof host.sessionController?.projections !== 'function')
    throw new MemoryError('原生模型投影暂不可用', 503)
  const snapshot = await host.sessionController.projections({ sessionId }, new AbortController().signal)
  const model = snapshot?.kind === 'sequenced' ? snapshot.values?.modelSelection?.lastUsed : undefined
  if (
    typeof model?.provider !== 'string' ||
    !model.provider ||
    typeof model?.model !== 'string' ||
    !model.model
  )
    throw new MemoryError('来源会话没有可用的模型记录', 409)
  return {
    provider: model.provider,
    model: model.model,
    ...(typeof model.reasoningEffort === 'string' ? { reasoningEffort: model.reasoningEffort } : {})
  }
}

/** A clean native task root avoids waking or resuming the source conversation and its Goal. */
export async function createExperienceParent(
  host: any,
  store: MemoryStore,
  caller: ExperienceCaller,
  model: { provider: string; model: string; reasoningEffort?: string },
  signal: AbortSignal
) {
  const agents = service(host, 'agents')
  if (!agents?.create) throw new MemoryError('原生后台任务服务不可用', 503)
  const llm = service(host, 'llm')
  const info = await llm?.resolveModelInfo?.(model.provider, model.model, signal)
  const route = experienceModel(model, info?.reasoning)
  const id = 'px-experience-root-' + randomUUID()
  store.bind(id, {
    parent: caller.sessionId,
    locked: true,
    purpose: 'experience',
    createdFrom: caller.sessionId
  })
  try {
    signal.throwIfAborted()
    const owned = await agents.create({
      sessionId: id,
      // Analysis has no interactive preset. Children inherit this native preset-free composition,
      // not a user preset's scoped delegation tools, terminal services or persona prompt.
      meta: { cwd: caller.project, origin: 'subagent' },
      agentOptions: { ...route, maxTokens: 8000 },
      signal
    })
    return {
      agent: owned.agent,
      dispose: async () => {
        try {
          await owned.dispose()
        } finally {
          store.releaseExperienceBindings([id])
        }
      }
    }
  } catch (error) {
    store.releaseExperienceBindings([id])
    throw error
  }
}

/** This bounded analysis uses a supported low effort; never changes the source conversation. */
export function experienceModel<T extends { provider: string; model: string; reasoningEffort?: string }>(
  model: T,
  reasoning?: { efforts?: readonly { id: string }[]; defaultEffort?: string }
): T {
  const selected = model.reasoningEffort ?? reasoning?.defaultEffort
  if (['off', 'none', 'minimal'].includes(selected ?? '')) return { ...model }
  const low = reasoning?.efforts?.find((effort) => effort.id === 'low')
  return low ? { ...model, reasoningEffort: low.id } : { ...model }
}
