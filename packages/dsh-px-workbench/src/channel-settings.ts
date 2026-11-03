import { createHash } from 'node:crypto'
import { isAbsolute } from 'node:path'
import type { ChannelAttentionRouting } from '../../shared/channel-attention'

export interface ChannelAccount {
  provider: 'feishu'
  accountId: string
  fingerprint: string
  enabled: boolean
  personaId: string
  workspace: string
  routeRevision: number
  authorizedUsers: string[]
  publicInstructions: string
  attention: ChannelAttentionRouting
}
export interface ChannelConfiguration {
  version: 1
  accounts: ChannelAccount[]
}
export class ChannelError extends Error {
  constructor(
    message: string,
    readonly status = 400
  ) {
    super(message)
  }
}
const identifier = (value: unknown, max = 200): value is string =>
  typeof value === 'string' &&
  !!value.trim() &&
  value === value.trim() &&
  value.length <= max &&
  !/[\r\n\0]/.test(value)
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value)
const only = (value: Record<string, unknown>, keys: string[]) =>
  Object.keys(value).every((key) => keys.includes(key))
const list = (value: unknown, max = 200): value is string[] =>
  Array.isArray(value) &&
  value.length <= max &&
  value.every((x) => identifier(x, 512)) &&
  new Set(value).size === value.length
export const defaultChannelAttention = (): ChannelAttentionRouting => ({
  mode: 'normal',
  focusedChats: [],
  mutedChats: [],
  notifyDirect: true,
  notifyMentions: true,
  notifyGroups: false,
  mentionOverridesMute: true
})
export function parseChannelConfiguration(
  value: unknown = { version: 1, accounts: [] }
): ChannelConfiguration {
  if (
    !object(value) ||
    !only(value, ['version', 'accounts']) ||
    value.version !== 1 ||
    !Array.isArray(value.accounts) ||
    value.accounts.length > 20
  )
    throw new ChannelError('渠道配置格式或版本无效，未覆盖原设置')
  const ids = new Set<string>()
  const accounts = value.accounts.map((raw) => {
    if (
      !object(raw) ||
      !only(raw, [
        'provider',
        'accountId',
        'fingerprint',
        'enabled',
        'personaId',
        'workspace',
        'routeRevision',
        'authorizedUsers',
        'publicInstructions',
        'attention'
      ]) ||
      raw.provider !== 'feishu' ||
      !identifier(raw.accountId, 128) ||
      !/^[A-Za-z0-9_-]+$/.test(raw.accountId) ||
      typeof raw.fingerprint !== 'string' ||
      !/^[a-f0-9]{64}$/.test(raw.fingerprint) ||
      typeof raw.enabled !== 'boolean' ||
      !identifier(raw.personaId) ||
      typeof raw.workspace !== 'string' ||
      raw.workspace.length > 4096 ||
      raw.workspace.includes('\0') ||
      !isAbsolute(raw.workspace) ||
      !Number.isSafeInteger(raw.routeRevision) ||
      Number(raw.routeRevision) < 1 ||
      !list(raw.authorizedUsers, 32) ||
      typeof raw.publicInstructions !== 'string' ||
      raw.publicInstructions.length > 2000 ||
      raw.publicInstructions.includes('\0')
    )
      throw new ChannelError('渠道账号、人格、工作区或授权成员无效')
    if (ids.has(raw.accountId)) throw new ChannelError('同一飞书机器人只能配置一个接收方')
    ids.add(raw.accountId)
    const attention = raw.attention
    if (
      !object(attention) ||
      !only(attention, [
        'mode',
        'focusedChats',
        'mutedChats',
        'openedChats',
        'notifyDirect',
        'notifyMentions',
        'notifyGroups',
        'mentionOverridesMute'
      ]) ||
      !['focus', 'normal', 'notifications'].includes(String(attention.mode)) ||
      !list(attention.focusedChats) ||
      !list(attention.mutedChats) ||
      (attention.openedChats !== undefined && !list(attention.openedChats)) ||
      ['notifyDirect', 'notifyMentions', 'notifyGroups', 'mentionOverridesMute'].some(
        (key) => typeof attention[key] !== 'boolean'
      )
    )
      throw new ChannelError('渠道接收模式与关注设置无效')
    return structuredClone(raw) as unknown as ChannelAccount
  })
  return { version: 1, accounts }
}
const digest = (value: unknown) =>
  createHash('sha256')
    .update(JSON.stringify(value ?? {}))
    .digest('hex')

/** Configuration stays in the native profile; the inbox contains transport receipts, never account credentials. */
export class NativeChannelSettings {
  constructor(private readonly editor: any) {}
  private entry() {
    const rows = this.editor
      .configuration()
      .filter((row: any) => row.entry?.options?.id === 'dsh-px-workbench')
    if (rows.length !== 1) throw new ChannelError('PX 工作台配置入口不唯一或尚未就绪', 503)
    return rows[0].entry
  }
  read(): { revision: string; configuration: ChannelConfiguration } {
    const config = this.entry().options.config ?? {}
    return { revision: digest(config), configuration: parseChannelConfiguration(config.pxChannels) }
  }
  async save(revision: unknown, proposed: unknown) {
    const entry = this.entry(),
      before = this.read(),
      next = parseChannelConfiguration(proposed)
    if (revision !== before.revision) throw new ChannelError('渠道设置已变化，请刷新；未覆盖其他修改', 409)
    for (const account of next.accounts) {
      const old = before.configuration.accounts.find((row) => row.accountId === account.accountId)
      const routing = (row: ChannelAccount) =>
        JSON.stringify([row.fingerprint, row.personaId, row.workspace, row.publicInstructions])
      account.routeRevision = old ? old.routeRevision + (routing(old) === routing(account) ? 0 : 1) : 1
      if (!Number.isSafeInteger(account.routeRevision)) throw new ChannelError('路由修订已达到上限', 409)
    }
    await this.editor.edit(entry, (fresh: any) => {
      if (digest(fresh) !== revision) throw new ChannelError('其他窗口已修改原生配置，未覆盖其修改', 409)
      return { ...fresh, pxChannels: next }
    })
    return this.read()
  }
}
