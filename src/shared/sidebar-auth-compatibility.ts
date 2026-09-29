import { createHash } from 'node:crypto'

export const SIDEBAR_AUTH_SOURCE = {
  name: 'dsh-better-sidebar',
  version: '0.24.1',
  integrity:
    'sha512-X5tdu07Ub0isxruG559o46891F7MjxM+CzR6QoGpHZtN5J8gz6FA8Dq632lLI77c4IjL2GP+N6PuWaDnoKPuPQ==',
  sourceSha256: 'a39a18228c1ad1282040b80269358067a26bd61869902778eb2e71b85cfb45c7',
  patchedSha256: 'dda78f7bb5227bced29229f23bbc8f5ce20d1618d5cc790232bff7da5dbfa24f',
  patchId: 'px-sidebar-native-auth-v1'
} as const

/** Applied only to a private copied payload, never to an installed package or pnpm's shared store. */
export function patchSidebarAuthentication(source: string): { code: string; sha256: string } {
  if (createHash('sha256').update(source).digest('hex') !== SIDEBAR_AUTH_SOURCE.sourceSha256)
    throw new Error('侧栏来源与已核验版本不一致，拒绝应用认证补丁')
  const injection = 'const inject = [\n\t"webServer",'
  const fence = 'const fence = (req) => isTrustedApiRequest(req, ctx.webRuntime.trustedHosts);'
  if (source.split(injection).length !== 2 || source.split(fence).length !== 2)
    throw new Error('侧栏认证合约已变化，拒绝应用补丁')
  const code = source
    .replace(injection, 'const inject = [\n\t"connection",\n\t"webServer",')
    .replace(
      fence,
      'const fence = (req) => ctx.connection.requestRejection(req) === void 0 && isTrustedApiRequest(req, ctx.webRuntime.trustedHosts);'
    )
  const sha256 = createHash('sha256').update(code).digest('hex')
  if (sha256 !== SIDEBAR_AUTH_SOURCE.patchedSha256) throw new Error('侧栏认证补丁产物与已核验摘要不一致')
  return { code, sha256 }
}
