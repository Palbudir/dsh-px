import { createHash, randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { parseTabs, type ServiceLayout } from '../../shared/session-layout'

export function serviceIdentity(home: string, platform = process.platform): string {
  const path = resolve(home)
  return createHash('sha256')
    .update(platform === 'win32' ? path.toLowerCase() : path)
    .digest('hex')
    .slice(0, 24)
}
export class LayoutError extends Error {
  constructor(
    message: string,
    readonly status = 400
  ) {
    super(message)
  }
}
export function createLayoutStore(home: string) {
  const dir = join(home, 'storages', 'dsh-px-workbench')
  const path = join(dir, 'session-layout.json')
  const serviceId = serviceIdentity(home)
  function read(): ServiceLayout {
    try {
      if (statSync(path).size > 512000) throw new Error('布局文件过大')
      const value = JSON.parse(readFileSync(path, 'utf8'))
      if (value.version !== 1 || !Number.isSafeInteger(value.revision) || value.revision < 0 || !value.layout)
        throw new Error('布局文件格式无效')
      return { serviceId, revision: value.revision, layout: parseTabs(JSON.stringify(value.layout)) }
    } catch (err: any) {
      if (err?.code === 'ENOENT') return { serviceId, revision: 0, layout: parseTabs(null) }
      throw new LayoutError(
        '无法读取会话布局，原文件已保留。请检查运行日志或恢复有效备份；当前窗口仍可使用。',
        503
      )
    }
  }
  return {
    read,
    write(request: unknown): ServiceLayout {
      const value = request as Partial<ServiceLayout> | null
      if (!value || value.serviceId !== serviceId || !Number.isSafeInteger(value.revision) || !value.layout)
        throw new LayoutError('布局服务身份或修订号无效，请重新读取布局。')
      if (
        JSON.stringify(value.layout).length > 480000 ||
        !Array.isArray(value.layout.ids) ||
        value.layout.ids.length > 1000
      )
        throw new LayoutError('已打开会话过多，请关闭部分标签后重试。', 413)
      const previous = read()
      if (value.revision !== previous.revision)
        throw new LayoutError(
          '另一个窗口已保存新的布局。当前窗口标签已保留，请选择恢复最新布局或保存此窗口布局。',
          409
        )
      const next = {
        serviceId,
        revision: previous.revision + 1,
        layout: parseTabs(JSON.stringify(value.layout))
      }
      mkdirSync(dir, { recursive: true })
      const temp = path + '.' + randomUUID() + '.tmp'
      writeFileSync(temp, JSON.stringify({ version: 1, ...next }) + '\n')
      renameSync(temp, path)
      return next
    }
  }
}
