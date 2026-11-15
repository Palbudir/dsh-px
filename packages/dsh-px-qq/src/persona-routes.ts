import { randomUUID } from 'node:crypto'
import { QqError } from './policy'
import { validAttentionChat } from './attention'

export interface QqRouteTransition {
  id: string
  targetPersonaId: string
  targetSessionId: string
  previousSessionId?: string
}
export interface QqPersonaRoute {
  personaId: string
  revision: number
  sessions: Record<string, string>
  pending?: QqRouteTransition
}
export interface QqPersonaRouteState {
  schema: 1
  revision: number
  chats: Record<string, QqPersonaRoute>
}
const identifier = (value: unknown): value is string =>
  typeof value === 'string' && !!value.trim() && value.length <= 200 && !/[\r\n\0]/.test(value)
const integer = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0
const own = <T>(rows: Record<string, T>, id: string): T | undefined =>
  Object.hasOwn(rows, id) ? rows[id] : undefined

/** Local transport configuration only. Original transcripts remain in native sessions. */
export function parsePersonaRoutes(value: unknown): QqPersonaRouteState {
  if (value === undefined) return { schema: 1, revision: 0, chats: Object.create(null) }
  const state = structuredClone(value) as QqPersonaRouteState
  if (
    !state ||
    state.schema !== 1 ||
    !integer(state.revision) ||
    !state.chats ||
    typeof state.chats !== 'object' ||
    Array.isArray(state.chats) ||
    Object.keys(state.chats).length > 500
  )
    throw new QqError('QQ 人格路由记录无效，未覆盖原记录', 503)
  for (const [chatId, route] of Object.entries(state.chats)) {
    if (
      !validAttentionChat(chatId) ||
      !route ||
      !identifier(route.personaId) ||
      !integer(route.revision) ||
      !route.sessions ||
      typeof route.sessions !== 'object' ||
      Array.isArray(route.sessions) ||
      Object.keys(route.sessions).length > 30 ||
      Object.entries(route.sessions).some(
        ([persona, session]) => !identifier(persona) || !identifier(session)
      )
    )
      throw new QqError('QQ 人格路由条目无效，未覆盖原记录', 503)
    if (route.pending !== undefined) {
      const p = route.pending
      if (
        !p ||
        !identifier(p.id) ||
        !identifier(p.targetPersonaId) ||
        !identifier(p.targetSessionId) ||
        (p.previousSessionId !== undefined && !identifier(p.previousSessionId))
      )
        throw new QqError('QQ 人格切换记录无效，未自动恢复', 503)
    }
  }
  return state
}

/** The inbox SQLite owner commits one small routing record using compare-and-swap. */
export class QqPersonaRoutes {
  constructor(
    private readonly persistence: {
      read(): QqPersonaRouteState
      write(expectedRevision: number, next: QqPersonaRouteState): void
    }
  ) {}
  snapshot(): QqPersonaRouteState {
    return parsePersonaRoutes(this.persistence.read())
  }
  route(chatId: string): QqPersonaRoute | undefined {
    if (!validAttentionChat(chatId)) throw new QqError('QQ 聊天标识无效')
    return own(this.snapshot().chats, chatId)
  }
  begin(
    chatId: string,
    revision: number,
    targetPersonaId: string,
    previous: { personaId: string; sessionId?: string }
  ): QqRouteTransition {
    if (
      !validAttentionChat(chatId) ||
      !identifier(targetPersonaId) ||
      !identifier(previous.personaId) ||
      (previous.sessionId !== undefined && !identifier(previous.sessionId))
    )
      throw new QqError('QQ 人格切换参数无效')
    const state = this.snapshot(),
      old = own(state.chats, chatId)
    if (revision !== state.revision) throw new QqError('QQ 人格路由已变化，请刷新后重试', 409)
    if (old?.pending) throw new QqError('这个聊天仍有未完成的人格切换，请先恢复或取消', 409)
    const sessions = { ...(old?.sessions ?? {}) }
    if (previous.sessionId)
      Object.defineProperty(sessions, previous.personaId, {
        value: previous.sessionId,
        enumerable: true,
        writable: true,
        configurable: true
      })
    const pending: QqRouteTransition = {
      id: randomUUID(),
      targetPersonaId,
      targetSessionId: own(sessions, targetPersonaId) ?? 'px-qq-persona-' + randomUUID(),
      ...(previous.sessionId ? { previousSessionId: previous.sessionId } : {})
    }
    const route: QqPersonaRoute = {
      personaId: previous.personaId,
      revision: (old?.revision ?? 0) + 1,
      sessions,
      pending
    }
    const next = parsePersonaRoutes({
      ...state,
      revision: state.revision + 1,
      chats: { ...state.chats, [chatId]: route }
    })
    this.persistence.write(state.revision, next)
    return structuredClone(pending)
  }
  finish(chatId: string, transitionId: string, mode: 'commit' | 'abort'): QqPersonaRoute {
    if (!['commit', 'abort'].includes(mode)) throw new QqError('人格路由提交操作无效')
    const state = this.snapshot(),
      route = own(state.chats, chatId),
      pending = route?.pending
    if (!route || !pending || pending.id !== transitionId)
      throw new QqError('人格切换记录已经改变，未提交旧结果', 409)
    const sessions = { ...route.sessions }
    if (mode === 'commit')
      Object.defineProperty(sessions, pending.targetPersonaId, {
        value: pending.targetSessionId,
        enumerable: true,
        writable: true,
        configurable: true
      })
    const nextRoute: QqPersonaRoute = {
      personaId: mode === 'commit' ? pending.targetPersonaId : route.personaId,
      revision: route.revision + 1,
      sessions
    }
    this.persistence.write(
      state.revision,
      parsePersonaRoutes({
        ...state,
        revision: state.revision + 1,
        chats: { ...state.chats, [chatId]: nextRoute }
      })
    )
    return nextRoute
  }
  assertSettled(chatId: string): void {
    if (this.route(chatId)?.pending)
      throw new QqError('此聊天的人格切换尚未完成，新消息已保留，请先在 QQ 设置中恢复或取消', 409)
  }
  revision(chatId: string): number {
    return this.route(chatId)?.revision ?? 0
  }
}
