/**
 * A small MCP client over stdio (newline-delimited JSON-RPC) for one pinned server. It implements
 * only what the browser provider needs: initialize, tools/call, cancellation and `roots/list`.
 */
import { spawn, type ChildProcess } from 'node:child_process'
import { pathToFileURL } from 'node:url'

export interface McpLaunch {
  command: string
  args: string[]
  cwd: string
  env: Record<string, string>
  /** Folders the server may read files from (Playwright uploads). */
  roots: string[]
}

export interface McpContent {
  type: string
  text?: string
  data?: string
  mimeType?: string
}
export interface McpCallResult {
  content: McpContent[]
  isError?: boolean
}

interface Pending {
  resolve: (value: any) => void
  reject: (error: Error) => void
}

const PROTOCOL = '2025-06-18'

export class McpStdioClient {
  private child: ChildProcess | undefined
  private buffer = ''
  private nextId = 1
  private readonly pending = new Map<number, Pending>()
  private stderr = ''
  private closed = false
  private closing?: Promise<void>
  private exitError: Error | undefined

  constructor(private readonly launch: McpLaunch) {}

  async start(signal: AbortSignal): Promise<void> {
    signal.throwIfAborted()
    if (this.closed || this.child) throw new Error('浏览器服务实例不能重复启动')
    const child = spawn(this.launch.command, this.launch.args, {
      cwd: this.launch.cwd,
      env: this.launch.env,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true
    })
    this.child = child
    child.stdout!.setEncoding('utf8')
    child.stdout!.on('data', (chunk: string) => this.receive(chunk))
    child.stderr!.setEncoding('utf8')
    child.stderr!.on('data', (chunk: string) => {
      this.stderr = (this.stderr + chunk).slice(-4000)
    })
    child.on('error', (error) => this.fail(error))
    child.on('exit', (code) =>
      this.fail(new Error(`浏览器服务已退出（${code ?? 'signal'}）${this.stderrTail()}`))
    )
    await this.request(
      'initialize',
      {
        protocolVersion: PROTOCOL,
        capabilities: { roots: { listChanged: false } },
        clientInfo: { name: 'dsh-px-computer', version: '1' }
      },
      signal,
      60_000
    )
    this.notify('notifications/initialized')
  }

  get alive(): boolean {
    return !this.closed && !!this.child && this.child.exitCode === null && this.child.signalCode === null
  }

  callTool(
    name: string,
    args: Record<string, unknown>,
    signal: AbortSignal,
    timeoutMs = 120_000
  ): Promise<McpCallResult> {
    return this.request('tools/call', { name, arguments: args }, signal, timeoutMs)
  }

  close(): Promise<void> {
    if (this.closing) return this.closing
    this.closed = true
    const child = this.child
    this.fail(new Error('浏览器服务已关闭'))
    if (!child || !child.pid || child.exitCode !== null || child.signalCode !== null) return Promise.resolve()
    const closing = new Promise<void>((resolve, reject) => {
      const finish = (error?: Error) => {
        clearTimeout(grace)
        clearTimeout(deadline)
        child.removeListener('exit', exited)
        error ? reject(error) : resolve()
      }
      const exited = () => finish()
      const grace = setTimeout(() => {
        try {
          child.kill()
        } catch (error) {
          finish(error as Error)
        }
      }, 3000)
      const deadline = setTimeout(
        () => finish(new Error('浏览器服务尚未确认退出，占用仍保留，请重试释放')),
        8000
      )
      child.once('exit', exited)
      child.stdin?.end()
    })
    this.closing = closing
    void closing.catch(() => {
      if (this.closing === closing) this.closing = undefined
    })
    return closing
  }

  private stderrTail(): string {
    const tail = this.stderr.trim().split('\n').slice(-3).join(' ').trim()
    return tail ? `：${tail.slice(0, 400)}` : ''
  }

  private request(method: string, params: unknown, signal: AbortSignal, timeoutMs: number): Promise<any> {
    if (this.exitError) return Promise.reject(this.exitError)
    signal.throwIfAborted()
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      const done = (): void => {
        clearTimeout(timer)
        signal.removeEventListener('abort', abort)
        this.pending.delete(id)
      }
      const abort = (): void => {
        done()
        this.notify('notifications/cancelled', { requestId: id, reason: 'cancelled by the user' })
        reject(signal.reason instanceof Error ? signal.reason : new Error('已取消'))
      }
      const timer = setTimeout(() => {
        done()
        this.notify('notifications/cancelled', { requestId: id, reason: 'timeout' })
        reject(
          Object.assign(new Error(`浏览器操作超时（${Math.round(timeoutMs / 1000)} 秒）`), {
            code: 'mcp_timeout'
          })
        )
      }, timeoutMs)
      signal.addEventListener('abort', abort, { once: true })
      this.pending.set(id, {
        resolve: (value) => {
          done()
          resolve(value)
        },
        reject: (error) => {
          done()
          reject(error)
        }
      })
      this.write({ jsonrpc: '2.0', id, method, params })
    })
  }

  private notify(method: string, params?: unknown): void {
    if (this.alive) this.write({ jsonrpc: '2.0', method, ...(params === undefined ? {} : { params }) })
  }

  private write(message: unknown): void {
    this.child?.stdin?.write(JSON.stringify(message) + '\n')
  }

  private receive(chunk: string): void {
    this.buffer += chunk
    let index: number
    while ((index = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, index).trim()
      this.buffer = this.buffer.slice(index + 1)
      if (!line) continue
      let message: any
      try {
        message = JSON.parse(line)
      } catch {
        continue
      }
      if (message.method && message.id !== undefined) this.answer(message)
      else if (message.id !== undefined) {
        const pending = this.pending.get(message.id)
        if (!pending) continue
        if (message.error) pending.reject(new Error(String(message.error.message ?? '浏览器服务返回错误')))
        else pending.resolve(message.result)
      }
    }
  }

  /** Requests from the server: roots and pings; everything else is declined. */
  private answer(message: { id: number | string; method: string }): void {
    if (message.method === 'roots/list')
      this.write({
        jsonrpc: '2.0',
        id: message.id,
        result: { roots: this.launch.roots.map((root) => ({ uri: pathToFileURL(root).href, name: root })) }
      })
    else if (message.method === 'ping') this.write({ jsonrpc: '2.0', id: message.id, result: {} })
    else
      this.write({ jsonrpc: '2.0', id: message.id, error: { code: -32601, message: 'Method not supported' } })
  }

  private fail(error: Error): void {
    this.exitError ??= error
    for (const pending of [...this.pending.values()]) pending.reject(error)
    this.pending.clear()
  }
}
