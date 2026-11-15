import { randomUUID } from 'node:crypto'
import { ComputerUseRefusal } from './runtime'

export interface ForegroundLease {
  sessionId: string
  generation: string
  expiresAt: number
  activeCalls: number
  releasing: boolean
}

/** Coordination only: a reservation never activates a window or grants input permission. */
export class ForegroundResource {
  private lease?: ForegroundLease
  private timer?: ReturnType<typeof setTimeout>
  private readonly listeners = new Set<() => void>()
  constructor(private readonly now: () => number = Date.now) {}

  private refresh(): void {
    if (this.lease && this.lease.expiresAt <= this.now()) this.lease.releasing = true
    if (this.lease?.releasing && !this.lease.activeCalls) this.lease = undefined
  }
  private changed(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = undefined
    this.refresh()
    if (this.lease && !this.lease.releasing) {
      this.timer = setTimeout(() => this.changed(), Math.max(1, this.lease.expiresAt - this.now()))
      this.timer.unref?.()
    }
    for (const listener of [...this.listeners]) listener()
  }
  snapshot(): ForegroundLease | null {
    this.refresh()
    return this.lease ? { ...this.lease } : null
  }
  availability(owner: string) {
    const current = this.snapshot()
    return {
      resource: 'desktop-foreground',
      available: !current || (current.sessionId === owner && !current.releasing),
      owned: current?.sessionId === owner,
      expiresAt: current?.expiresAt ?? null,
      releasing: current?.releasing ?? false,
      ...(current?.sessionId === owner ? { generation: current.generation } : {})
    }
  }
  reserve(owner: string, durationMs = 30_000, generation?: string): ForegroundLease {
    if (!owner || !Number.isSafeInteger(durationMs) || durationMs < 1000 || durationMs > 60_000)
      throw new ComputerUseRefusal('前台占用期限需为 1～60 秒')
    this.refresh()
    if (generation && (this.lease?.sessionId !== owner || this.lease.generation !== generation))
      throw new ComputerUseRefusal('前台占用记录已变化，请重新查看；旧记录不能延长新占用')
    if (this.lease && (this.lease.sessionId !== owner || this.lease.releasing))
      throw new ComputerUseRefusal(
        '前台正被其他活动占用或正在释放。用 computer_desktop_resource 等待，继续其他工作；不要重放旧动作。'
      )
    this.lease ??= {
      sessionId: owner,
      generation: randomUUID(),
      expiresAt: 0,
      activeCalls: 0,
      releasing: false
    }
    this.lease.expiresAt = Math.max(this.lease.expiresAt, this.now() + durationMs)
    this.changed()
    return { ...this.lease }
  }
  enter(owner: string, generation: string): void {
    this.assertCurrent(owner, generation)
    this.lease!.activeCalls++
  }
  assertCurrent(owner: string, generation: string): void {
    this.refresh()
    if (
      !this.lease ||
      this.lease.sessionId !== owner ||
      this.lease.generation !== generation ||
      this.lease.releasing
    )
      throw new ComputerUseRefusal('前台占用已到期或被释放，排队动作未执行；重新观察后再操作')
  }
  leave(owner: string, generation: string): void {
    if (this.lease?.sessionId !== owner || this.lease.generation !== generation) return
    this.lease.activeCalls = Math.max(0, this.lease.activeCalls - 1)
    this.changed()
  }
  release(owner: string, generation: string): void {
    this.refresh()
    if (this.lease?.sessionId !== owner || this.lease.generation !== generation)
      throw new ComputerUseRefusal('前台占用记录已变化；旧记录不能释放新的占用')
    this.lease.releasing = true
    this.changed()
  }
  cancelOwner(owner: string, generation?: string): void {
    if (this.lease?.sessionId !== owner || (generation && this.lease.generation !== generation)) return
    this.lease.releasing = true
    this.changed()
  }
  reset(): void {
    if (this.lease) this.lease.releasing = true
    this.changed()
  }
  async waitAvailable(owner: string, signal: AbortSignal, timeoutMs: number) {
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 60_000)
      throw new ComputerUseRefusal('等待时限需为 1～60 秒')
    signal.throwIfAborted()
    if (this.availability(owner).available) return this.availability(owner)
    return new Promise<ReturnType<ForegroundResource['availability']>>((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timer)
        this.listeners.delete(check)
        signal.removeEventListener('abort', abort)
      }
      const check = () => {
        const status = this.availability(owner)
        if (status.available) {
          cleanup()
          resolve(status)
        }
      }
      const abort = () => {
        cleanup()
        reject(signal.reason)
      }
      const timer = setTimeout(() => {
        cleanup()
        resolve(this.availability(owner))
      }, timeoutMs)
      this.listeners.add(check)
      signal.addEventListener('abort', abort, { once: true })
      if (signal.aborted) abort()
      else check()
    })
  }
}
