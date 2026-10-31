import { createHash } from 'node:crypto'
import { isAbsolute } from 'node:path'
import { DEFAULT_QQ_SETTINGS, QqError, localEndpoint, qqId, type QqSettings } from './policy'
import { parseAttention } from './attention'

const keys = [...Object.keys(DEFAULT_QQ_SETTINGS), 'model', 'attention']
export function parseQqSettings(value: unknown): QqSettings {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new QqError('QQ 设置格式无效')
  const input = value as Record<string, unknown>
  if (Object.keys(input).some((key) => !keys.includes(key))) throw new QqError('QQ 设置包含未知字段')
  const result = { ...DEFAULT_QQ_SETTINGS, ...input } as QqSettings
  if (typeof result.enabled !== 'boolean') throw new QqError('QQ 开关必须为布尔值')
  for (const key of keys.filter(
    (key) => !['enabled', 'authorizedUsers', 'model', 'attention'].includes(key)
  )) {
    const text = result[key as keyof QqSettings]
    if (
      typeof text !== 'string' ||
      text.length > (key === 'publicIntroduction' ? 2000 : 4096) ||
      text.includes('\0')
    )
      throw new QqError('QQ 设置文字为空或超出长度限制')
  }
  if (!Array.isArray(result.authorizedUsers) || result.authorizedUsers.length > 30)
    throw new QqError('授权成员列表无效')
  result.authorizedUsers = [...new Set(result.authorizedUsers.map(qqId))]
  if (result.attention !== undefined) {
    try {
      result.attention = parseAttention(result.attention)
    } catch (error) {
      throw new QqError(error instanceof Error ? error.message : 'QQ 消息模式无效')
    }
  }
  if (result.model !== undefined) {
    const route = result.model
    if (
      !route ||
      typeof route !== 'object' ||
      Array.isArray(route) ||
      Object.keys(route).some((key) => !['provider', 'model', 'reasoningEffort'].includes(key)) ||
      [route.provider, route.model].some(
        (value) => typeof value !== 'string' || !value.trim() || value.length > 300 || /[\r\n\0]/.test(value)
      ) ||
      (route.reasoningEffort !== undefined &&
        (typeof route.reasoningEffort !== 'string' ||
          !route.reasoningEffort ||
          route.reasoningEffort.length > 80 ||
          /[\r\n\0]/.test(route.reasoningEffort)))
    )
      throw new QqError('请选择有效的 QQ 默认模型')
    result.model = { ...route }
  }
  if (result.accountId) qqId(result.accountId)
  if (result.authorizedUsers.includes(result.accountId))
    throw new QqError('负责人应填写你的 QQ 号，而不是机器人账号')
  result.endpoint = localEndpoint(result.endpoint)
  if (result.secretRef && !/^[A-Za-z_][A-Za-z0-9_]{0,159}$/.test(result.secretRef))
    throw new QqError('原生凭据引用无效，请重新配置连接令牌')
  for (const key of ['workspace'] as const)
    if (result[key] && !isAbsolute(result[key])) throw new QqError('请填写完整的本机路径')
  if (
    result.enabled &&
    (!result.accountId ||
      !result.authorizedUsers.length ||
      !result.personaId ||
      !result.workspace ||
      !result.secretRef)
  )
    throw new QqError('启用前请填写账号、授权成员、工作区、人格和连接令牌')
  return result
}

/** The native profile row is the sole configuration source; configEditor owns locking and rollback. */
export class NativeQqSettings {
  constructor(private readonly editor: any) {}
  private entry(): any {
    const rows = this.editor.configuration()
    const entries = rows.filter((row: any) => row.entry?.options?.id === 'dsh-onebot')
    if (entries.length !== 1) throw new QqError('QQ 社区成员未就绪，请检查插件是否已安装并启用', 503)
    return entries[0].entry
  }
  private revision(value: unknown): string {
    return createHash('sha256')
      .update(JSON.stringify(value ?? {}))
      .digest('hex')
  }
  read(): { revision: string; settings: QqSettings } {
    const config = this.entry().options.config ?? {}
    return { revision: this.revision(config), settings: parseQqSettings(config.pxQq ?? {}) }
  }
  componentEnabled(): boolean {
    return this.entry().options.disabled !== true
  }
  async save(revision: unknown, settings: QqSettings): Promise<{ revision: string; settings: QqSettings }> {
    const entry = this.entry(),
      clean = parseQqSettings(settings)
    if (revision !== this.revision(entry.options.config))
      throw new QqError('设置已变化，请刷新后重试，未覆盖其他修改', 409)
    await this.editor.edit(entry, (fresh: any) => {
      if (revision !== this.revision(fresh)) throw new QqError('设置已被其他窗口修改', 409)
      return { ...fresh, pxQq: clean }
    })
    return this.read()
  }
}
