import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { qqAtomicText } from '../../../src/shared/qq-atomic'
import { QqError } from './policy'

export interface AdmissionMetadata {
  sessionId?: string
  messageId?: string
}
interface Receipt {
  status: 'pending' | 'processed'
  at: number
  metadata?: AdmissionMetadata
}
interface State {
  schema: 1
  entries: Record<string, Receipt>
}
export class QqReceiptStorageError extends QqError {
  constructor(message: string) {
    super(message, 503)
  }
}
export class UncertainQqReceipt extends QqError {
  constructor(readonly reference: string) {
    super('此前同一请求的受理状态尚待核对，未自动重跑。请先检查原聊天和当前任务。参考号：' + reference, 409)
  }
}
export function receiptKey(kind: string, identity: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify([kind, identity]))
    .digest('hex')
}
const validMetadata = (value: any): value is AdmissionMetadata =>
  value &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  Object.keys(value).every((key) => ['sessionId', 'messageId'].includes(key)) &&
  Object.values(value).every(
    (v) => typeof v === 'string' && v.length > 0 && v.length <= 200 && !/[\r\n\0]/.test(v)
  )

/** Delivery receipts, not task state. Native sessions/jobs remain authoritative for execution. */
export class QqReceipts {
  private state?: State
  private queue: Promise<unknown> = Promise.resolve()
  private readonly running = new Map<string, Promise<{ duplicate: boolean; metadata?: AdmissionMetadata }>>()
  private readonly completed = new Map<string, Receipt>()
  constructor(private readonly file: string) {}
  private async load(): Promise<State> {
    if (this.state) return this.state
    let raw: string
    try {
      raw = await readFile(this.file, 'utf8')
    } catch (error: any) {
      if (error?.code === 'ENOENT') return (this.state = { schema: 1, entries: Object.create(null) })
      throw new QqReceiptStorageError('QQ 投递回执暂不可读，请检查存储目录')
    }
    try {
      if (raw.length > 4_000_000) throw Error('size')
      const value = JSON.parse(raw)
      if (
        value?.schema !== 1 ||
        !value.entries ||
        typeof value.entries !== 'object' ||
        Array.isArray(value.entries) ||
        Object.keys(value.entries).length > 5000
      )
        throw Error('shape')
      for (const [key, item] of Object.entries<any>(value.entries))
        if (
          !/^[a-f0-9]{64}$/.test(key) ||
          !item ||
          !['pending', 'processed'].includes(item.status) ||
          !Number.isFinite(item.at) ||
          item.at < 0 ||
          (item.metadata !== undefined && !validMetadata(item.metadata))
        )
          throw Error('entry')
      Object.setPrototypeOf(value.entries, null)
      return (this.state = value)
    } catch {
      throw new QqReceiptStorageError('QQ 投递回执格式损坏，已保留原文件；请核对后恢复，未自动重跑请求')
    }
  }
  private serial<T>(work: () => Promise<T>): Promise<T> {
    const task = this.queue.then(work)
    this.queue = task.catch(() => {})
    return task
  }
  private async save(next: State): Promise<void> {
    try {
      await qqAtomicText(this.file, JSON.stringify(next))
    } catch {
      throw new QqReceiptStorageError('QQ 投递回执保存失败，未确认交付；请先检查原聊天和当前任务')
    }
    this.state = next
  }
  ready(): Promise<void> {
    return this.serial(async () => {
      await this.load()
    })
  }
  once(key: string, operation: () => Promise<AdmissionMetadata | undefined>) {
    if (!/^[a-f0-9]{64}$/.test(key)) throw new QqError('回执标识无效')
    const active = this.running.get(key)
    if (active) return active
    if (this.running.size >= 128) throw new QqError('QQ 待处理消息较多，请稍后再发', 429)
    const task = this.run(key, operation)
    this.running.set(key, task)
    void task.finally(() => this.running.delete(key)).catch(() => {})
    return task
  }
  private async run(key: string, operation: () => Promise<AdmissionMetadata | undefined>) {
    const previous = await this.serial(async () => {
      const state = await this.load(),
        found = state.entries[key]
      if (found?.status === 'processed') return found
      if (found) throw new UncertainQqReceipt('QQ-RX-' + key.slice(0, 10))
      const entries = { ...state.entries }
      while (Object.keys(entries).length >= 5000) {
        const oldest = Object.entries(entries)
          .filter(([, row]) => row.status === 'processed')
          .sort((a, b) => a[1].at - b[1].at)[0]
        if (!oldest) throw new QqReceiptStorageError('QQ 待核对回执已达到上限，请先检查已有请求')
        delete entries[oldest[0]]
      }
      await this.save({ schema: 1, entries: { ...entries, [key]: { status: 'pending', at: Date.now() } } })
      return undefined
    })
    if (previous) return { duplicate: true, metadata: previous.metadata }
    const metadata = await operation()
    if (metadata !== undefined && !validMetadata(metadata))
      throw new QqError('原生投递回执无效，未重新执行', 503)
    const completed: Receipt = { status: 'processed', at: Date.now(), ...(metadata ? { metadata } : {}) }
    this.completed.set(key, completed)
    await this.serial(async () => {
      const state = await this.load()
      await this.save({ schema: 1, entries: { ...state.entries, [key]: completed } })
      this.completed.delete(key)
    })
    return { duplicate: false, metadata }
  }
  /** Retry only known completed metadata writes; never dispatch an operation a second time. */
  repair(): Promise<void> {
    return this.serial(async () => {
      const state = await this.load()
      const entries = { ...state.entries, ...Object.fromEntries(this.completed) }
      await this.save({ schema: 1, entries })
      this.completed.clear()
    })
  }
}
