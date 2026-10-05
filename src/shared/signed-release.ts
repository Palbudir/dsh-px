import { createPublicKey, sign, verify } from 'node:crypto'
import { versionGeneration } from './product-contract'

export interface ReleaseFile {
  role: 'installer' | 'blockmap' | 'pack'
  name: string
  url: string
  size: number
  sha256: string
  sha512: string
}
export interface ReleaseManifest {
  schemaVersion: 1
  product: 'pack' | 'desktop'
  channel: 'stable' | 'preview'
  platform: 'any' | 'win32-x64'
  version: string
  packVersion: string
  protocolGeneration: number
  upgradeFromGenerations: number[]
  hostVersion: string
  upstreamCommit: string
  sourceCommit: string
  issuedAt: string
  files: ReleaseFile[]
}
export interface SignedRelease {
  keyId: string
  payload: ReleaseManifest
  signature: string
}
export interface ReleaseTarget {
  product: ReleaseManifest['product']
  channel: ReleaseManifest['channel']
  platform: ReleaseManifest['platform']
  protocolGeneration: number
}

/** Same representation for signing and verification; unknown fields are rejected by the schema below. */
export function canonicalRelease(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonicalRelease).join(',') + ']'
  if (value && typeof value === 'object')
    return (
      '{' +
      Object.entries(value)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, item]) => JSON.stringify(key) + ':' + canonicalRelease(item))
        .join(',') +
      '}'
    )
  return JSON.stringify(value)
}
function exact(value: unknown, fields: string[]): asserts value is Record<string, any> {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).length !== fields.length ||
    fields.some((key) => !Object.hasOwn(value, key))
  )
    throw new Error('更新清单字段不完整或包含未知字段')
}
function base64(value: unknown, bytes: number): boolean {
  return (
    typeof value === 'string' &&
    Buffer.from(value, 'base64').length === bytes &&
    Buffer.from(value, 'base64').toString('base64') === value
  )
}
export function validateReleaseManifest(value: unknown): asserts value is ReleaseManifest {
  exact(value, [
    'schemaVersion',
    'product',
    'channel',
    'platform',
    'version',
    'packVersion',
    'protocolGeneration',
    'upgradeFromGenerations',
    'hostVersion',
    'upstreamCommit',
    'sourceCommit',
    'issuedAt',
    'files'
  ])
  if (
    value.schemaVersion !== 1 ||
    !['pack', 'desktop'].includes(value.product) ||
    !['stable', 'preview'].includes(value.channel) ||
    value.platform !== (value.product === 'pack' ? 'any' : 'win32-x64')
  )
    throw new Error('更新产品或平台无效')
  if (
    !Number.isSafeInteger(value.protocolGeneration) ||
    value.protocolGeneration < 1 ||
    versionGeneration(value.version) !== value.protocolGeneration ||
    versionGeneration(value.packVersion) !== value.protocolGeneration
  )
    throw new Error('更新版本与协议代际不一致')
  if (value.product === 'pack' && value.packVersion !== value.version) throw new Error('Pack 版本不一致')
  if (
    !Array.isArray(value.upgradeFromGenerations) ||
    value.upgradeFromGenerations.length > 16 ||
    value.upgradeFromGenerations.some(
      (generation: unknown) =>
        !Number.isSafeInteger(generation) ||
        Number(generation) < 1 ||
        Number(generation) > value.protocolGeneration
    ) ||
    new Set(value.upgradeFromGenerations).size !== value.upgradeFromGenerations.length ||
    (value.product === 'pack'
      ? value.upgradeFromGenerations.length !== 0
      : !value.upgradeFromGenerations.includes(value.protocolGeneration))
  )
    throw new Error('更新代际迁移许可无效')
  if (value.channel === 'stable' && value.version.includes('-')) throw new Error('稳定通道不能发布预览版本')
  if (
    !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(value.hostVersion) ||
    !/^[a-f0-9]{40}$/.test(value.sourceCommit) ||
    !/^[a-f0-9]{40}$/.test(value.upstreamCommit) ||
    typeof value.issuedAt !== 'string' ||
    !Number.isFinite(Date.parse(value.issuedAt)) ||
    new Date(value.issuedAt).toISOString() !== value.issuedAt
  )
    throw new Error('更新来源或时间无效')
  if (!Array.isArray(value.files) || value.files.length < 1 || value.files.length > 2)
    throw new Error('更新文件清单无效')
  const names = new Set(),
    roles = new Set()
  for (const file of value.files) {
    exact(file, ['role', 'name', 'url', 'size', 'sha256', 'sha512'])
    if (
      !['installer', 'blockmap', 'pack'].includes(file.role) ||
      typeof file.name !== 'string' ||
      !/^[A-Za-z0-9][A-Za-z0-9._-]{0,149}$/.test(file.name) ||
      file.name.includes('..') ||
      names.has(file.name) ||
      roles.has(file.role) ||
      !Number.isSafeInteger(file.size) ||
      file.size < 1 ||
      file.size > 8 * 1024 ** 3 ||
      !/^[a-f0-9]{64}$/.test(file.sha256) ||
      !base64(file.sha512, 64)
    )
      throw new Error('更新文件身份或摘要无效')
    const expected = `https://github.com/Palbudir/dsh-px/releases/download/${value.product}-v${value.version}/${file.name}`
    if (file.url !== expected) throw new Error('更新文件必须来自该产品的固定发行地址')
    if (
      (file.role === 'installer' && !file.name.endsWith('.exe')) ||
      (file.role === 'pack' && !file.name.endsWith('.tgz')) ||
      (file.role === 'blockmap' && !file.name.endsWith('.exe.blockmap'))
    )
      throw new Error('更新文件类型不一致')
    names.add(file.name)
    roles.add(file.role)
  }
  if (
    value.product === 'pack'
      ? roles.size !== 1 || !roles.has('pack')
      : !roles.has('installer') || roles.has('pack')
  )
    throw new Error('更新文件与产品不匹配')
  const blockmap = value.files.find((file: ReleaseFile) => file.role === 'blockmap')
  const installer = value.files.find((file: ReleaseFile) => file.role === 'installer')
  if (blockmap && blockmap.name !== installer.name + '.blockmap') throw new Error('差分文件与安装器不匹配')
}
export function signRelease(
  payload: ReleaseManifest,
  keyId: string,
  privateKey: string | Buffer
): SignedRelease {
  validateReleaseManifest(payload)
  if (!/^[a-f0-9]{24}$/.test(keyId) || createPublicKey(privateKey).asymmetricKeyType !== 'ed25519')
    throw new Error('更新签名密钥无效')
  return {
    keyId,
    payload,
    signature: sign(null, Buffer.from(canonicalRelease(payload)), privateKey).toString('base64')
  }
}
export function verifySignedRelease(
  source: string,
  keys: Readonly<Record<string, string>>,
  target: ReleaseTarget
): ReleaseManifest {
  if (Buffer.byteLength(source) > 64 * 1024) throw new Error('更新清单过大')
  const envelope: unknown = JSON.parse(source)
  exact(envelope, ['keyId', 'payload', 'signature'])
  if (
    typeof envelope.keyId !== 'string' ||
    !Object.hasOwn(keys, envelope.keyId) ||
    !base64(envelope.signature, 64)
  )
    throw new Error('更新签名或密钥不受信任')
  const key = createPublicKey(keys[envelope.keyId])
  if (
    key.asymmetricKeyType !== 'ed25519' ||
    !verify(
      null,
      Buffer.from(canonicalRelease(envelope.payload)),
      key,
      Buffer.from(envelope.signature, 'base64')
    )
  )
    throw new Error('更新签名校验失败')
  validateReleaseManifest(envelope.payload)
  for (const field of ['product', 'channel', 'platform'] as const)
    if (envelope.payload[field] !== target[field]) throw new Error('更新清单不属于当前产品、通道或协议代际')
  const payload = envelope.payload
  // Generation mismatches are expected across releases; say what the user can do next.
  if (payload.product === 'desktop' && !payload.upgradeFromGenerations.includes(target.protocolGeneration))
    throw new Error(`客户端 ${payload.version} 不支持从当前版本直接升级，请从发布页下载安装程序。`)
  if (payload.product === 'pack' && payload.protocolGeneration > target.protocolGeneration)
    throw new Error(`新版插件包 ${payload.version} 需要先更新桌面客户端；客户端更新后会包含匹配的插件包。`)
  if (payload.product === 'pack' && payload.protocolGeneration < target.protocolGeneration)
    throw new Error('更新服务暂时只提供较旧的插件包，当前已是可用的最新版本；请稍后再检查。')
  for (const file of envelope.payload.files) Object.freeze(file)
  Object.freeze(envelope.payload.files)
  Object.freeze(envelope.payload.upgradeFromGenerations)
  return Object.freeze(envelope.payload)
}
