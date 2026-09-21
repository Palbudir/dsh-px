/** 处理分块日志：认证链接只交给窗口，不写入持久日志。保留有界诊断尾部。 */
export class HarnessOutput {
  private pending = ''
  private tail = ''
  private announced: string | null = null
  constructor (private readonly log: (text: string) => void) {}
  push (text: string): string | null {
    this.pending += text
    const lines = this.pending.split('\n')
    this.pending = lines.pop() ?? ''
    for (const line of lines) this.consume(line)
    // 未换行的异常超长输出直接丢弃中间部分，防止无限积累。
    if (this.pending.length > 32768) this.pending = '[超长日志行已截断]'
    return this.announced
  }
  private consume (line: string): void {
    const match = line.match(/dsh web:\s*(http:\/\/\S+)/)
    if (match) this.announced = match[1]
    const safe = line.replace(/([?&]token=)[^\s&]+/g, '$1[redacted]')
    this.tail = (this.tail + safe + '\n').slice(-4000)
    this.log(safe + '\n')
  }
  flush (): void { if (this.pending) this.consume(this.pending); this.pending = '' }
  get diagnostic (): string { return this.tail }
}
