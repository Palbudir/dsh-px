import { createHash } from 'node:crypto'
import { lstatSync, readFileSync, readdirSync, realpathSync, mkdirSync, watch } from 'node:fs'
import { join, resolve, relative, sep } from 'node:path'
import type {
  SkillCandidate,
  SkillDefinition,
  SkillProvider,
  SkillProviderControl
} from '@deepseek-ai/dsh-skill'
import { MemoryError, publicSession, validId, type MemoryStore } from './store'

export const PERSONA_SKILL_PROVIDER = 'dsh-px-persona'
const NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

export function personaSkillDirectory(home: string, personaId: string): string {
  validId(personaId)
  return resolve(
    home,
    'storages',
    'dsh-px-persona-skills',
    createHash('sha256').update(personaId).digest('hex')
  )
}

interface PrivateSkill extends SkillDefinition {
  path: string
  version: string
}

/** Only this managed root is read. Native registry scope owns discovery and invocation. */
export class PersonaSkillFiles {
  constructor(private readonly home: string) {}
  directory(personaId: string): string {
    return personaSkillDirectory(this.home, personaId)
  }
  async read(personaId: string, name: string): Promise<PrivateSkill | undefined> {
    const { parse: parseYaml } = await import('yaml')
    if (!NAME.test(name) || name.length > 80) throw new MemoryError('技能名无效')
    const root = this.directory(personaId),
      dir = join(root, name),
      path = join(dir, 'SKILL.md')
    let info
    try {
      for (const target of [root, dir, path])
        if (lstatSync(target).isSymbolicLink()) throw new MemoryError('人格技能不能通过链接读取其他位置', 409)
      const actual = realpathSync.native(path),
        base = realpathSync.native(root),
        rel = relative(base, actual)
      if (rel === '..' || rel.startsWith('..' + sep) || resolve(base, rel) !== actual)
        throw new MemoryError('人格技能超出所属目录', 409)
      info = lstatSync(path)
    } catch (error: any) {
      if (error?.code === 'ENOENT') return
      throw error
    }
    if (!info.isFile() || info.size > 96000) throw new MemoryError('人格技能文件格式或大小无效', 409)
    const raw = readFileSync(path, 'utf8'),
      match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(raw)
    if (!match) throw new MemoryError('人格技能缺少 frontmatter', 409)
    const meta = parseYaml(match[1]),
      content = raw.slice(match[0].length).trim()
    if (
      !meta ||
      typeof meta !== 'object' ||
      Array.isArray(meta) ||
      meta.name !== name ||
      typeof meta.description !== 'string' ||
      !meta.description.trim() ||
      meta.description.length > 1000 ||
      !content ||
      content.length > 64000 ||
      meta['dsh-px-persona'] !== personaId ||
      meta['dsh-px-managed'] !== true ||
      (meta['disable-model-invocation'] !== undefined &&
        typeof meta['disable-model-invocation'] !== 'boolean') ||
      (meta['user-invocable'] !== undefined && typeof meta['user-invocable'] !== 'boolean')
    )
      throw new MemoryError('人格技能身份或内容无效', 409)
    return {
      name,
      path,
      description: meta.description.trim(),
      content,
      source: 'persona-private',
      provider: PERSONA_SKILL_PROVIDER,
      resourceBase: { kind: 'directory', path: dir },
      invocation: {
        modelInvocable: meta['disable-model-invocation'] !== true,
        userInvocable: meta['user-invocable'] !== false
      },
      metadata: { 'dsh-px-managed': true, 'dsh-px-persona': personaId },
      version: createHash('sha256').update(raw).digest('hex')
    }
  }
  async list(personaId: string): Promise<PrivateSkill[]> {
    const root = this.directory(personaId)
    let names: string[]
    try {
      if (lstatSync(root).isSymbolicLink()) throw new MemoryError('人格技能目录不能为链接', 409)
      names = readdirSync(root, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && NAME.test(entry.name))
        .map((entry) => entry.name)
        .sort()
    } catch (error: any) {
      if (error?.code === 'ENOENT') return []
      throw error
    }
    if (names.length > 100) throw new MemoryError('每个人格最多管理 100 个私有技能', 409)
    return (await Promise.all(names.map((name) => this.read(personaId, name)))).filter(
      (skill): skill is PrivateSkill => !!skill
    )
  }
}

/** Register through an agent-scoped context, never on the global or shared preset layer. */
export function personaSkillProvider(
  files: PersonaSkillFiles,
  owner: () => string | undefined,
  control: Pick<SkillProviderControl, 'signal'>
): SkillProvider {
  return {
    name: PERSONA_SKILL_PROVIDER,
    list: async ({ signal }) => {
      control.signal.throwIfAborted()
      signal?.throwIfAborted()
      const id = owner()
      const candidates: SkillCandidate[] = id
        ? (await files.list(id)).map(({ content: _content, version, ...skill }) => ({
            ...skill,
            rank: 300,
            locator: { personaId: id, name: skill.name, version }
          }))
        : []
      control.signal.throwIfAborted()
      signal?.throwIfAborted()
      // The owner invalidates on identity/file changes and before prompt/catalog reads.
      // An incomplete catalog would let native consumers retain older private summaries.
      return { candidates: owner() === id ? candidates : [], complete: true }
    },
    get: async (candidate, { signal }) => {
      control.signal.throwIfAborted()
      signal?.throwIfAborted()
      const id = owner(),
        locator = candidate.locator as any
      if (!id || locator?.personaId !== id || locator?.name !== candidate.name) return
      const skill = await files.read(id, candidate.name)
      control.signal.throwIfAborted()
      signal?.throwIfAborted()
      if (owner() !== id) return
      if (!skill || skill.version !== locator.version) return
      const { version: _version, ...definition } = skill
      return definition
    }
  }
}

export function installPersonaSkillProviders(ctx: any, store: MemoryStore, home: string): () => void {
  const files = new PersonaSkillFiles(home),
    mounted = new Map<any, any>()
  const controls = new Map<any, SkillProviderControl>()
  const invalidate = () => {
    for (const control of controls.values()) control.invalidate()
  }
  const root = join(home, 'storages', 'dsh-px-persona-skills')
  mkdirSync(root, { recursive: true })
  const watcher = watch(root, { recursive: true }, invalidate)
  watcher.unref()
  watcher.on('error', (error) => {
    invalidate()
    ctx.logger?.warn('人格技能目录监听失败，模型请求与界面读取仍会重新核对：%s', String(error))
  })
  const unsubscribe = store.subscribe(invalidate)
  const provided = ctx.provide('pxPersonaSkills', { invalidate })
  const injection = ctx.inject(['skills', 'agents'], (host: any) => {
    const mount = (agent: any) => {
      if (!agent?.ctx?.inject || mounted.has(agent)) return
      const registration = agent.ctx.inject(['skills'], (scoped: any) =>
        scoped.skills.registerProvider((control: SkillProviderControl) => {
          controls.set(agent, control)
          return personaSkillProvider(
            files,
            () => {
              const state = store.read(),
                binding = state.bindings[agent.session.id]
              const persona = state.personas.find((p) => p.id === binding?.personaId)
              if (
                !binding ||
                binding.pending ||
                binding.purpose ||
                publicSession(binding) ||
                persona?.archived
              )
                return
              return persona?.id
            },
            control
          )
        })
      )
      mounted.set(agent, registration)
    }
    return host.effect(function* () {
      yield host.on('agent/created', ({ agent }: any) => mount(agent))
      yield host.on(
        'system-prompt/assemble',
        async (_assembly: any, context: any, next: () => Promise<any>) => {
          if (context.agent) {
            mount(context.agent)
            await mounted.get(context.agent)?.await()
            controls.get(context.agent)?.invalidate()
          }
          return next()
        },
        { prepend: true }
      )
      yield host.on('agent/disposed', ({ agent }: any) => {
        mounted.delete(agent)
        controls.delete(agent)
      })
      for (const agent of host.agents.list()) mount(agent)
      yield async () => {
        const pending = [...mounted.values()].map((fiber) => fiber.dispose())
        mounted.clear()
        controls.clear()
        await Promise.all(pending)
      }
    }, 'memory: native persona skill providers')
  })
  return () => {
    watcher.close()
    unsubscribe()
    if (typeof provided === 'function') provided()
    return injection.dispose()
  }
}
