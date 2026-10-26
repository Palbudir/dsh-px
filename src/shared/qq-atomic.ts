import { mkdir, open, readFile, rename, rm } from 'node:fs/promises'
import { dirname } from 'node:path'
import { randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'

/** Validate before loading: a damaged mapping must never become an empty, writable replacement. */
export async function qqReadMetadata(
  file: string,
  kind: 'mapping' | 'retired' | 'switchable'
): Promise<string> {
  const text = await readFile(file, 'utf8')
  const id = (v: unknown) => typeof v === 'string' && v.length > 0 && v.length <= 300 && !/[\r\n\0]/.test(v)
  const chat = (v: string) => /^(private|group):[1-9]\d{4,19}$/.test(v)
  try {
    if (text.length > 4_000_000) throw Error('size')
    const value = JSON.parse(text)
    if (kind === 'retired') {
      if (!Array.isArray(value) || !value.every(id)) throw Error('retired')
    } else {
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('object')
      for (const [key, row] of Object.entries<any>(value)) {
        if (!chat(key)) throw Error('chat')
        if (kind === 'switchable') {
          if (!Array.isArray(row) || !row.every((r: any) => r && id(r.id) && Number.isFinite(r.retiredAt)))
            throw Error('list')
        } else if (typeof row === 'string') {
          if (!id(row)) throw Error('id')
        } else if (
          !row ||
          typeof row !== 'object' ||
          Array.isArray(row) ||
          !id(row.session) ||
          (row.interimOverride !== undefined && typeof row.interimOverride !== 'boolean') ||
          ['goal', 'workspacePath'].some((k) => row[k] !== undefined && typeof row[k] !== 'string')
        )
          throw Error('mapping')
      }
    }
  } catch {
    throw Error('QQ 接续记录格式损坏，原文件已保留；请恢复记录后重新启用 QQ 组件')
  }
  return text
}

/** Bounded Windows sharing-violation recovery; never truncates the previous valid file. */
export async function qqAtomicText(
  file: string,
  text: string,
  move: (source: string, destination: string) => Promise<void> = rename
): Promise<void> {
  await mkdir(dirname(file), { recursive: true })
  const temporary = file + '.tmp-' + randomUUID()
  try {
    const handle = await open(temporary, 'wx', 0o600)
    try {
      await handle.writeFile(text, 'utf8')
      await handle.sync()
    } finally {
      await handle.close()
    }
    for (let attempt = 0; ; attempt++) {
      try {
        await move(temporary, file)
        return
      } catch (error: any) {
        if (attempt >= 5 || !['EPERM', 'EACCES', 'EBUSY'].includes(error?.code)) throw error
        await delay(25 * 2 ** attempt)
      }
    }
  } finally {
    await rm(temporary, { force: true }).catch(() => {})
  }
}
