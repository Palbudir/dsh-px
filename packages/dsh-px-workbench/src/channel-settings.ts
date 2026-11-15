import { createHash } from 'node:crypto'
import { isAbsolute } from 'node:path'
import type { ChannelAttentionRouting } from '../../shared/channel-attention'
import { parseMailRelations } from '../../shared/persona-mail-policy'

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
  routes?: Array<{ conversationId: string; personaId: string | null; revision: number }>
  routeCounter?: number
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
export { defaultChannelAttention } from '../../shared/channel-attention'
export function channelRoute(account: ChannelAccount, conversationId: string) {
  const route = account.routes?.find((row) => row.conversationId === conversationId)
  return {
    personaId: route?.personaId ?? account.personaId,
    routeRevision: route?.revision ?? account.routeRevision
  }
}
export function sameChannelAccount(a: ChannelAccount, b: ChannelAccount): boolean {
  return (
    a.accountId === b.accountId &&
    a.fingerprint === b.fingerprint &&
    a.workspace === b.workspace &&
    a.publicInstructions === b.publicInstructions
  )
}
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
        'attention',
        'routes',
        'routeCounter'
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
    if (
      raw.routeCounter !== undefined &&
      (!Number.isSafeInteger(raw.routeCounter) || Number(raw.routeCounter) < 1)
    )
      throw new ChannelError('渠道路由计数无效')
    if (raw.routes !== undefined) {
      if (!Array.isArray(raw.routes) || raw.routes.length > 500)
        throw new ChannelError('每个账号最多配置 500 条聊天路由')
      const chats = new Set<string>()
      for (const route of raw.routes) {
        if (
          !object(route) ||
          !only(route, ['conversationId', 'personaId', 'revision']) ||
          !identifier(route.conversationId, 512) ||
          (route.personaId !== null && !identifier(route.personaId)) ||
          !Number.isSafeInteger(route.revision) ||
          Number(route.revision) < 1 ||
          chats.has(route.conversationId)
        )
          throw new ChannelError('聊天路由或修订无效')
        chats.add(route.conversationId)
      }
    }
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
        'mentionOverridesMute',
        'allowAgentChanges'
      ]) ||
      !['focus', 'normal', 'notifications'].includes(String(attention.mode)) ||
      !list(attention.focusedChats) ||
      !list(attention.mutedChats) ||
      (attention.openedChats !== undefined && !list(attention.openedChats)) ||
      ['notifyDirect', 'notifyMentions', 'notifyGroups', 'mentionOverridesMute'].some(
        (key) => typeof attention[key] !== 'boolean'
      ) ||
      (attention.allowAgentChanges !== undefined && typeof attention.allowAgentChanges !== 'boolean')
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
      .filter((row: any) => row.entry?.options?.id === 'dsh-px-channel-settings')
    if (rows.length !== 1) throw new ChannelError('PX 渠道配置入口不唯一或尚未就绪', 503)
    return rows[0].entry
  }
  read(): { revision: string; configuration: ChannelConfiguration; componentEnabled: boolean } {
    const config = this.entry().options.config ?? {}
    return {
      revision: digest(config),
      configuration: parseChannelConfiguration(config.pxChannels),
      componentEnabled: this.entry().options.disabled !== true
    }
  }
  readMail() {
    const entry = this.entry(),
      config = entry.options.config ?? {}
    return {
      revision: digest(config),
      relations: parseMailRelations(config.pxPersonaMail ?? []),
      componentEnabled: entry.options.disabled !== true
    }
  }
  async saveMail(revision: unknown, relations: unknown) {
    const entry = this.entry(),
      next = parseMailRelations(relations)
    if (revision !== this.readMail().revision)
      throw new ChannelError('通信设置已变化，请刷新；未覆盖其他修改', 409)
    await this.editor.edit(entry, (fresh: any) => {
      if (digest(fresh) !== revision) throw new ChannelError('其他窗口已修改原生配置，未覆盖其修改', 409)
      return { ...fresh, pxPersonaMail: next }
    })
    return this.readMail()
  }
  async changeRoute(
    revision: string,
    accountId: string,
    conversationId: string,
    personaId: string | null,
    restart = false
  ) {
    if (!identifier(conversationId, 512) || (personaId !== null && !identifier(personaId)))
      throw new ChannelError('聊天或人格无效')
    const next = this.read().configuration,
      account = next.accounts.find((row) => row.accountId === accountId)
    if (!account) throw new ChannelError('账号不存在', 404)
    account.routes = [
      ...(account.routes ?? []).filter((row) => row.conversationId !== conversationId),
      { conversationId, personaId, revision: 1 }
    ]
    return this.save(revision, next, { accountId, conversationId, restart })
  }
  async save(
    revision: unknown,
    proposed: unknown,
    routeEdit?: { accountId: string; conversationId: string; restart: boolean }
  ) {
    const entry = this.entry(),
      before = this.read(),
      next = parseChannelConfiguration(proposed)
    if (revision !== before.revision) throw new ChannelError('渠道设置已变化，请刷新；未覆盖其他修改', 409)
    for (const account of next.accounts) {
      const old = before.configuration.accounts.find((row) => row.accountId === account.accountId)
      if (
        routeEdit?.accountId !== account.accountId &&
        JSON.stringify(old?.routes ?? []) !== JSON.stringify(account.routes ?? [])
      )
        throw new ChannelError('请从聊天人格入口更改路由', 409)
      let counter = Math.max(
        old?.routeCounter ?? 0,
        old?.routeRevision ?? 0,
        ...(old?.routes ?? []).map((row) => row.revision)
      )
      const bump = () => {
        if (!Number.isSafeInteger(++counter)) throw new ChannelError('路由修订已达到上限', 409)
        return counter
      }
      const identityChanged = !!old && !sameChannelAccount(old, account),
        defaultChanged = !!old && old.personaId !== account.personaId
      account.routeRevision = !old || identityChanged || defaultChanged ? bump() : old.routeRevision
      if (account.routes)
        account.routes = account.routes.map((route) => {
          const previous = old?.routes?.find((r) => r.conversationId === route.conversationId)
          const changed =
            !previous ||
            previous.personaId !== route.personaId ||
            identityChanged ||
            (defaultChanged && route.personaId === null) ||
            (routeEdit?.accountId === account.accountId &&
              routeEdit.conversationId === route.conversationId &&
              routeEdit.restart)
          return { ...route, revision: changed ? bump() : previous!.revision }
        })
      account.routeCounter = counter
    }
    await this.editor.edit(entry, (fresh: any) => {
      if (digest(fresh) !== revision) throw new ChannelError('其他窗口已修改原生配置，未覆盖其修改', 409)
      return { ...fresh, pxChannels: next }
    })
    return this.read()
  }
}
