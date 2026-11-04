/** Account lifecycles are independent; configuration delivery is not a second Agent scheduler. */
export interface ManagedChannel<C> {
  matches(config: C): boolean
  refreshAttention(): void
  requestStop(): void
  start(): Promise<void>
  dispose(): Promise<void>
}
export class ChannelSupervisor<
  C extends { accountId: string; enabled: boolean },
  R extends ManagedChannel<C>
> {
  private desired = new Map<string, C>()
  private workers = new Map<string, Promise<void>>()
  private attempted = new Map<string, string>()
  private paused = new Set<string>()
  private closing = false
  constructor(
    readonly runtimes: Map<string, R>,
    private readonly create: (config: C) => R | Promise<R>,
    private readonly failed: (id: string, error: unknown) => void,
    private readonly settled: (id: string) => void = () => {}
  ) {}
  update(configs: readonly C[]): void {
    if (this.closing) return
    this.desired = new Map(
      configs.filter((row) => row.enabled).map((row) => [row.accountId, structuredClone(row)])
    )
    for (const id of new Set([...this.runtimes.keys(), ...this.desired.keys()])) {
      const current = this.runtimes.get(id),
        wanted = this.target(id)
      if (current && (!wanted || !current.matches(wanted))) current.requestStop()
      this.schedule(id)
    }
  }
  retry(id: string): void {
    this.paused.delete(id)
    this.attempted.delete(id)
    this.schedule(id)
  }
  async pause(id: string): Promise<void> {
    this.paused.add(id)
    this.runtimes.get(id)?.requestStop()
    this.schedule(id)
    let pending = this.workers.get(id)
    while (pending) {
      await pending
      if (!this.paused.has(id)) throw Error('停止请求已被后续接收操作取代，请刷新状态')
      pending = this.workers.get(id)
    }
    if (this.runtimes.has(id)) throw Error('渠道尚未完成停止，请核对原生状态后重试')
  }
  private target(id: string): C | undefined {
    return this.closing || this.paused.has(id) ? undefined : this.desired.get(id)
  }
  private schedule(id: string): void {
    if (this.workers.has(id)) return
    let failed = false
    const work = this.apply(id)
      .catch((error) => {
        failed = true
        this.report(id, error)
      })
      .finally(() => {
        this.workers.delete(id)
        const wanted = this.target(id),
          current = this.runtimes.get(id)
        if (
          !failed &&
          !this.closing &&
          ((wanted && this.attempted.get(id) !== JSON.stringify(wanted)) || (!wanted && current))
        ) {
          this.schedule(id)
        }
      })
    this.workers.set(id, work)
  }
  private report(id: string, error: unknown): void {
    try {
      this.failed(id, error)
    } catch {}
  }
  private async apply(id: string): Promise<void> {
    for (;;) {
      const wanted = this.target(id),
        current = this.runtimes.get(id),
        signature = JSON.stringify(wanted)
      if (current && wanted && current.matches(wanted)) {
        current.refreshAttention()
        this.attempted.set(id, signature)
        return
      }
      if (current) {
        current.requestStop()
        await current.dispose()
        if (this.runtimes.get(id) === current) this.runtimes.delete(id)
      }
      if (!wanted) return
      if (this.target(id) !== wanted) continue
      if (this.attempted.get(id) === signature) return
      this.attempted.set(id, signature)
      let runtime: R | undefined
      try {
        runtime = await this.create(wanted)
        this.runtimes.set(id, runtime)
        if (this.target(id) !== wanted) {
          runtime.requestStop()
          await runtime.dispose()
          if (this.runtimes.get(id) === runtime) this.runtimes.delete(id)
          continue
        }
        await runtime.start()
        try {
          this.settled(id)
        } catch {}
      } catch (error) {
        if (runtime) {
          try {
            await runtime.dispose()
            if (this.runtimes.get(id) === runtime) this.runtimes.delete(id)
          } catch (stopError) {
            this.report(id, stopError)
          }
        }
        this.report(id, error)
      }
      if (this.target(id) === wanted) return
    }
  }
  async close(): Promise<void> {
    this.closing = true
    for (const [id, current] of this.runtimes) {
      current.requestStop()
      this.schedule(id)
    }
    await Promise.allSettled([...this.workers.values()])
    const remaining = await Promise.allSettled(
      [...this.runtimes].map(async ([id, current]) => {
        await current.dispose()
        if (this.runtimes.get(id) === current) this.runtimes.delete(id)
      })
    )
    if (remaining.some((result) => result.status === 'rejected')) throw Error('部分渠道尚未完成停止')
  }
}
