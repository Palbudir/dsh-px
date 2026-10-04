import {
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  writeFileSync,
  unlinkSync,
  openSync,
  fsyncSync,
  closeSync
} from 'node:fs'
import { dirname, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'

export interface MemoryEntry {
  id: string
  text: string
  project: string | null
  updatedAt: string
}
export interface Persona {
  id: string
  name: string
  instructions: string
  memoryEnabled: boolean
  memories: MemoryEntry[]
}
export interface MemoryState {
  schemaVersion: 1
  revision: number
  personas: Persona[]
  sessions: Record<string, string>
}
export class MemoryError extends Error {
  constructor(
    message: string,
    public status = 400
  ) {
    super(message)
  }
}
export function projectKey(cwd?: string): string | null {
  if (!cwd) return null
  let path = resolve(cwd)
  try {
    path = realpathSync.native(path)
  } catch {
    /* A removed workspace keeps its original scope. */
  }
  return process.platform === 'win32' ? path.toLowerCase() : path
}
function text(value: unknown, max: number, required = false): string {
  if (typeof value !== 'string' || value.length > max || (required && !value.trim()))
    throw new MemoryError('内容为空或超过长度限制')
  return value.trim()
}
export function validId(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{1,200}$/.test(value)) throw new MemoryError('标识无效')
  return value
}
function initial(): MemoryState {
  return {
    schemaVersion: 1,
    revision: 0,
    personas: [{ id: 'default', name: '默认助手', instructions: '', memoryEnabled: true, memories: [] }],
    sessions: {}
  }
}
function validate(value: MemoryState): void {
  if (
    !value ||
    value.schemaVersion !== 1 ||
    !Number.isSafeInteger(value.revision) ||
    value.revision < 0 ||
    !Array.isArray(value.personas) ||
    value.personas.length > 30 ||
    !value.sessions ||
    typeof value.sessions !== 'object' ||
    Array.isArray(value.sessions)
  )
    throw new MemoryError('记忆文件格式不兼容；请保留原文件', 503)
  const ids = new Set<string>()
  for (const p of value.personas) {
    validId(p.id)
    text(p.name, 60, true)
    text(p.instructions, 2000)
    if (
      ids.has(p.id) ||
      typeof p.memoryEnabled !== 'boolean' ||
      !Array.isArray(p.memories) ||
      p.memories.length > 40
    )
      throw new MemoryError('人格配置无效', 503)
    ids.add(p.id)
    const entries = new Set<string>()
    for (const m of p.memories) {
      validId(m.id)
      text(m.text, 2000, true)
      if (
        entries.has(m.id) ||
        (m.project !== null && typeof m.project !== 'string') ||
        !Number.isFinite(Date.parse(m.updatedAt))
      )
        throw new MemoryError('记忆条目无效', 503)
      entries.add(m.id)
    }
    if (p.memories.reduce((n, m) => n + m.text.length, 0) > 8000)
      throw new MemoryError('每个人格的记忆合计最多 8000 字，请精简后保存')
  }
  if (!ids.has('default') || Object.keys(value.sessions).length > 20000)
    throw new MemoryError('人格或会话绑定无效', 503)
  for (const [id, persona] of Object.entries(value.sessions)) {
    validId(id)
    if (!ids.has(persona)) throw new MemoryError('会话引用了不存在的人格', 503)
  }
}
/** One synchronous transaction per host; disk revision also rejects stale UI and hot-reload writers. */
export class MemoryStore {
  constructor(private path: string) {}
  read(): MemoryState {
    if (!existsSync(this.path)) return initial()
    const raw = readFileSync(this.path, 'utf8')
    if (raw.length > 3_000_000) throw new MemoryError('记忆文件过大，请保留原文件并检查', 503)
    const state = JSON.parse(raw) as MemoryState
    validate(state)
    return state
  }
  change(revision: unknown, update: (state: MemoryState) => void): MemoryState {
    const state = this.read()
    if (revision !== state.revision) throw new MemoryError('记录已变化，请刷新后重试；未覆盖你的修改', 409)
    update(state)
    state.revision++
    validate(state)
    const serialized = JSON.stringify(state, null, 2)
    if (serialized.length > 3_000_000) throw new MemoryError('记忆配置已达到容量限制，未保存本次修改')
    mkdirSync(dirname(this.path), { recursive: true })
    const temporary = this.path + '.' + randomUUID() + '.tmp'
    try {
      const fd = openSync(temporary, 'wx')
      try {
        writeFileSync(fd, serialized, 'utf8')
        fsyncSync(fd)
      } finally {
        closeSync(fd)
      }
      renameSync(temporary, this.path)
    } finally {
      if (existsSync(temporary)) unlinkSync(temporary)
    }
    return state
  }
  persona(state: MemoryState, sessionId: string): Persona {
    return (
      state.personas.find((p) => p.id === state.sessions[sessionId]) ??
      state.personas.find((p) => p.id === 'default')!
    )
  }
  action(revision: unknown, action: any, sessionId: string, project: string | null): MemoryState {
    validId(sessionId)
    if (!action || typeof action !== 'object' || Array.isArray(action)) throw new MemoryError('操作内容无效')
    return this.change(revision, (state) => {
      const p = this.persona(state, sessionId)
      switch (action.type) {
        case 'create': {
          const id = randomUUID()
          state.personas.push({
            id,
            name: text(action.name, 60, true),
            instructions: '',
            memoryEnabled: true,
            memories: []
          })
          state.sessions[sessionId] = id
          break
        }
        case 'select': {
          if (!state.personas.some((p) => p.id === action.personaId)) throw new MemoryError('人格不存在')
          state.sessions[sessionId] = action.personaId
          break
        }
        case 'configure': {
          p.name = text(action.name, 60, true)
          p.instructions = text(action.instructions, 2000)
          if (typeof action.memoryEnabled !== 'boolean') throw new MemoryError('记忆开关无效')
          p.memoryEnabled = action.memoryEnabled
          break
        }
        case 'delete-persona': {
          if (p.id === 'default') throw new MemoryError('默认助手不能删除')
          state.personas = state.personas.filter((item) => item.id !== p.id)
          for (const id of Object.keys(state.sessions))
            if (state.sessions[id] === p.id) state.sessions[id] = 'default'
          break
        }
        case 'save': {
          const content = text(action.text, 2000, true)
          if (action.scope !== 'persona' && action.scope !== 'project') throw new MemoryError('记忆范围无效')
          if (action.scope === 'project' && !project) throw new MemoryError('当前会话没有项目目录')
          const old = action.id ? p.memories.find((m) => m.id === validId(action.id)) : undefined
          if (action.id && !old) throw new MemoryError('记忆已移除，请刷新', 409)
          const entry = {
            id: old?.id ?? randomUUID(),
            text: content,
            project: action.scope === 'project' ? project : null,
            updatedAt: new Date().toISOString()
          }
          if (old) p.memories[p.memories.indexOf(old)] = entry
          else p.memories.push(entry)
          break
        }
        case 'forget': {
          const at = p.memories.findIndex((m) => m.id === validId(action.id))
          if (at < 0) throw new MemoryError('记忆已移除，请刷新', 409)
          p.memories.splice(at, 1)
          break
        }
        default:
          throw new MemoryError('操作无效')
      }
    })
  }
}
export function selectedMemories(persona: Persona, project: string | null): MemoryEntry[] {
  return persona.memoryEnabled
    ? persona.memories.filter((m) => m.project === null || m.project === project)
    : []
}
export function memoryContext(persona: Persona, project: string | null): string {
  return `PX 当前人格：${persona.name}\n职责与协作方式：${persona.instructions || '沿用宿主默认方式'}\n人格不改变实际模型、工具或权限。以下是用户保存的参考记忆；当前明确指令优先，项目与运行事实须按需要重新核实。\n${persona.memoryEnabled ? JSON.stringify(selectedMemories(persona, project).map((m) => ({ id: m.id, text: m.text, updatedAt: m.updatedAt }))) : '本轮不使用长期记忆。'}`
}
