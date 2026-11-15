import { QqError } from './policy'
import { QqPersonaRoutes, type QqRouteTransition } from './persona-routes'

export interface QqRoutingPorts {
  known(chatId: string): boolean
  available(personaId: string): boolean
  current(chatId: string): { personaId: string; sessionId?: string }
  busy(chatId: string): string[]
  hasPending(chatId: string): boolean
  cancelPending(chatId: string): void
  create(chatId: string, personaId: string, sessionId: string): Promise<void>
  adopt(chatId: string, sessionId: string): Promise<void>
  reset(chatId: string): Promise<void>
  flush(): Promise<void>
  retireDelivery(chatId: string, sessionId?: string): void
  onBegin?(): void
}

/** Serializes ownership changes, not model work. Intent is durable before native creation/adoption. */
export class QqPersonaRouting {
  private readonly changing = new Set<string>()
  private readonly activity = new Map<string, number>()
  private disposed = false
  private readonly operations = new Set<Promise<unknown>>()
  constructor(
    readonly routes: QqPersonaRoutes,
    private readonly ports: QqRoutingPorts
  ) {}
  blocked(chatId: string): boolean {
    return this.disposed || this.changing.has(chatId) || !!this.routes.route(chatId)?.pending
  }
  enter(chatId: string): { revision: number; assert(): void; release(): void } {
    if (this.blocked(chatId)) throw new QqError('此聊天正在切换人格，请稍后处理新消息', 409)
    const revision = this.routes.revision(chatId)
    this.activity.set(chatId, (this.activity.get(chatId) ?? 0) + 1)
    let released = false
    return {
      revision,
      assert: () => {
        if (released || this.blocked(chatId) || this.routes.revision(chatId) !== revision)
          throw new QqError('QQ 聊天归属已经改变，此次旧操作未继续', 409)
      },
      release: () => {
        if (released) return
        released = true
        const count = (this.activity.get(chatId) ?? 1) - 1
        if (count) this.activity.set(chatId, count)
        else this.activity.delete(chatId)
      }
    }
  }
  private assertActive(): void {
    if (this.disposed) throw new QqError('QQ 人格路由已停止', 409)
  }
  private assertIdle(chatId: string): void {
    const reasons = this.ports.busy(chatId)
    if ((this.activity.get(chatId) ?? 0) > 0) reasons.push('消息正在受理或发送')
    if (reasons.length) throw new QqError('请先结束或停止此聊天的工作再切换人格：' + reasons.join('；'), 409)
  }
  private own<T>(chatId: string, work: () => Promise<T>): Promise<T> {
    this.assertActive()
    if (this.changing.has(chatId)) throw new QqError('此聊天的人格切换正在进行，请等待结果', 409)
    if (!this.ports.known(chatId)) throw new QqError('只能配置当前账号已经识别的聊天', 403)
    this.changing.add(chatId)
    const operation = Promise.resolve()
      .then(() => {
        this.assertActive()
        this.assertIdle(chatId)
        return work()
      })
      .finally(() => {
        this.changing.delete(chatId)
        this.operations.delete(operation)
      })
    this.operations.add(operation)
    return operation
  }
  async change(input: {
    chatId: string
    revision: number
    personaId: string
    stopPending: boolean
  }): Promise<void> {
    return this.own(input.chatId, async () => {
      if (!this.ports.available(input.personaId)) throw new QqError('所选人格不可用或已归档', 409)
      if (this.ports.hasPending(input.chatId) && input.stopPending !== true)
        throw new QqError('此聊天还有未处理消息。请先处理，或明确选择停止旧输入后切换；原记录保留。', 409)
      const previous = this.ports.current(input.chatId)
      // Persist intent first: failures retain both transcript ownership and an inspectable recovery path.
      const transition = this.routes.begin(input.chatId, input.revision, input.personaId, previous)
      this.ports.onBegin?.()
      if (input.stopPending) this.ports.cancelPending(input.chatId)
      await this.complete(input.chatId, transition)
    })
  }
  private async complete(chatId: string, transition: QqRouteTransition): Promise<void> {
    this.assertActive()
    if (!this.ports.available(transition.targetPersonaId))
      throw new QqError('目标人格已归档，切换暂未完成', 409)
    await this.ports.create(chatId, transition.targetPersonaId, transition.targetSessionId)
    this.assertActive()
    this.assertIdle(chatId)
    await this.ports.adopt(chatId, transition.targetSessionId)
    this.assertActive()
    await this.ports.flush()
    this.assertActive()
    this.ports.retireDelivery(chatId, transition.previousSessionId)
    this.routes.finish(chatId, transition.id, 'commit')
  }
  async recover(chatId: string, transitionId: string, operation: 'retry' | 'abort'): Promise<void> {
    return this.own(chatId, async () => {
      const pending = this.routes.route(chatId)?.pending
      if (!pending || pending.id !== transitionId) throw new QqError('切换记录已变化，请刷新后重试', 409)
      if (operation === 'retry') return this.complete(chatId, pending)
      if (operation !== 'abort') throw new QqError('恢复操作无效')
      if (pending.previousSessionId) await this.ports.adopt(chatId, pending.previousSessionId)
      else await this.ports.reset(chatId)
      this.assertActive()
      await this.ports.flush()
      this.assertActive()
      this.ports.retireDelivery(chatId, pending.targetSessionId)
      this.routes.finish(chatId, pending.id, 'abort')
    })
  }
  async dispose(): Promise<void> {
    this.disposed = true
    await Promise.allSettled([...this.operations])
  }
}
