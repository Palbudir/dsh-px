import { join, dirname, resolve } from 'node:path'
import { MemoryError } from './store'
import { service } from './history'
import type { FileReference, KnowledgeCaller } from './knowledge'

export function scopedService(host: any, caller: KnowledgeCaller, name: string): any {
  const agent = service(host, 'agents')?.get(caller.sessionId)
  return (
    (agent?.ctx
      ? (service(host, 'agentPresets')?.serviceFor?.(agent, name) ?? agent.ctx.get?.(name))
      : undefined) ?? service(host, name)
  )
}
export async function observeFile(
  host: any,
  caller: KnowledgeCaller,
  path: string
): Promise<FileReference | undefined> {
  if (typeof path !== 'string' || !path.trim() || path.length > 4096) throw new MemoryError('文件路径无效')
  const fs = scopedService(host, caller, 'fs')
  if (!fs?.resolve || !fs?.stat) throw new MemoryError('当前会话的原生文件服务不可用', 503)
  const target = await fs.resolve(path, { cwd: caller.project }),
    info = await fs.stat(target)
  if (!info) return undefined
  if (info.type !== 'file') throw new MemoryError('来源必须是文件')
  return { path: fs.processPath(target), version: String(info.version), observedAt: new Date().toISOString() }
}
function skillName(value: unknown): string {
  if (typeof value !== 'string' || value.length > 80 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value))
    throw new MemoryError('技能名需使用小写英文、数字和连字符')
  return value
}
/** Match the pinned native filesystem provider: nearest .git ancestor, otherwise the selected cwd. */
export async function nativeSkillProjectRoot(fs: any, cwd: string): Promise<string> {
  let current = resolve(cwd)
  for (;;) {
    try {
      if (await fs.stat(await fs.resolve(join(current, '.git')))) return current
    } catch {}
    const parent = dirname(current)
    if (parent === current) return resolve(cwd)
    current = parent
  }
}
async function frontmatter(raw: string): Promise<{ metadata: any; body: string }> {
  const { parse: parseYaml } = await import('yaml')
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(raw)
  if (!match) throw new MemoryError('技能没有标准 frontmatter')
  const metadata = parseYaml(match[1])
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata))
    throw new MemoryError('技能元数据无效')
  return { metadata, body: raw.slice(match[0].length) }
}
/** All discovery/loading remains owned by the native registry; only explicit human edits write managed filesystem skills. */
export async function skillAction(host: any, caller: KnowledgeCaller, home: string, args: any): Promise<any> {
  const skills = scopedService(host, caller, 'skills'),
    fs = scopedService(host, caller, 'fs'),
    agent = service(host, 'agents')?.get(caller.sessionId)
  if (!skills?.list || !skills?.get) throw new MemoryError('原生 Skills 服务不可用', 503)
  const options = { cwd: caller.project, ...(agent ? { scope: agent } : {}) }
  const projectRoot = caller.project && fs ? await nativeSkillProjectRoot(fs, caller.project) : undefined
  const directories = {
    project: projectRoot ? join(projectRoot, '.dsh', 'skills') : null,
    global: join(home, 'skills')
  }
  if (args.action === 'list') return { skills: await skills.list(options), directories }
  const name = skillName(args.name)
  if (args.action === 'read') {
    const item = await skills.get(name, options)
    if (!item) throw new MemoryError('原生技能不存在', 404)
    let version: string | undefined,
      managed = false
    if (item.path && fs) {
      const target = await fs.resolve(item.path, { cwd: caller.project })
      version = (await fs.stat(target))?.version
      try {
        managed = (await frontmatter(await fs.readText(target))).metadata['dsh-px-managed'] === true
      } catch {}
    }
    return {
      skill: item,
      version,
      managed: managed && ['project-dsh', 'user-dsh'].includes(item.source),
      directories
    }
  }
  if (args.action !== 'save' || !['project', 'global'].includes(args.scope))
    throw new MemoryError('技能操作或范围无效')
  if (!fs?.writeText) throw new MemoryError('原生文件写入服务不可用', 503)
  const sandbox = scopedService(host, caller, 'sandboxPolicy')
  if (!agent || !sandbox?.resolve)
    throw new MemoryError('当前会话的原生文件权限暂不可用，请重新打开会话', 503)
  const policy = sandbox.resolve({ session: agent.session })
  if (args.scope === 'project' && !caller.project) throw new MemoryError('项目技能需要当前项目')
  if (
    typeof args.description !== 'string' ||
    !args.description.trim() ||
    args.description.length > 1000 ||
    typeof args.body !== 'string' ||
    !args.body.trim() ||
    args.body.length > 64000 ||
    typeof args.enabled !== 'boolean'
  )
    throw new MemoryError('请填写有效的技能说明、正文和启用状态')
  const base = args.scope === 'project' ? directories.project! : directories.global,
    path = join(base, name, 'SKILL.md')
  if (args.expectedRoot !== base) throw new MemoryError('技能目录已变化，请刷新列表并确认保存位置', 409)
  const parent = await fs.resolve(base, { cwd: caller.project }),
    target = await fs.resolve(path, { cwd: caller.project })
  if (!fs.contains(parent, target)) throw new MemoryError('技能路径超出受管目录')
  if (args.scope === 'project' && !fs.contains(await fs.resolve(projectRoot), target))
    throw new MemoryError('技能路径不在项目内')
  const info = await fs.stat(target)
  if (info) {
    if (info.type !== 'file' || !args.version || info.version !== args.version)
      throw new MemoryError('技能文件已变化，请重新读取', 409)
    if ((await frontmatter(await fs.readText(target))).metadata['dsh-px-managed'] !== true)
      throw new MemoryError('此技能由其他来源管理，请使用原文件编辑入口', 409)
  } else if (args.version) throw new MemoryError('原技能文件已不存在，请刷新', 409)
  const metadata = {
    name,
    description: args.description.trim(),
    'disable-model-invocation': !args.enabled,
    'user-invocable': args.enabled,
    'dsh-px-managed': true,
    ...(args.knowledge ? { 'dsh-px-knowledge': args.knowledge } : {})
  }
  const { stringify: stringifyYaml } = await import('yaml')
  let result
  try {
    result = await fs.writeText(
      target,
      '---\n' + stringifyYaml(metadata) + '---\n\n' + args.body.trim() + '\n',
      info ? { kind: 'replaceIfVersion', version: info.version } : { kind: 'createIfAbsent' },
      undefined,
      policy
    )
  } catch (error) {
    if (error instanceof Error && (error as any).code === 'FS_SANDBOX_DENIED')
      throw new MemoryError(
        '当前会话的原生文件权限不允许写入此技能目录。请改用允许的项目目录，或在会话访问模式中明确授权后重试；草稿仍保留。',
        403
      )
    throw error
  }
  let discovery = 'pending'
  for (let attempt = 0; attempt < 12; attempt++) {
    try {
      const listed = (await skills.list(options)).find(
        (s: any) => s.name === name && s.path === fs.processPath(target)
      )
      if (
        listed &&
        listed.invocation.modelInvocable === args.enabled &&
        listed.invocation.userInvocable === args.enabled
      ) {
        discovery = 'ready'
        break
      }
    } catch {
      break
    }
    await new Promise((resolve) => setTimeout(resolve, 80))
  }
  return {
    saved: true,
    name,
    path: fs.processPath(target),
    version: result.version,
    enabled: args.enabled,
    discovery
  }
}
