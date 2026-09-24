import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createPrivateKey, sign } from 'node:crypto'

export const APP_PERMISSIONS = Object.freeze({
  contents: 'read',
  pull_requests: 'read',
  actions: 'read',
  checks: 'write'
})
export function appJwt(appId, pem, now = Date.now()) {
  if (!Number.isSafeInteger(appId) || appId <= 0)
    throw new Error('The dedicated GitHub App is not configured')
  const key = createPrivateKey(pem)
  if (key.asymmetricKeyType !== 'rsa') throw new Error('Expected a GitHub-issued RSA App private key')
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url')
  const unsigned = `${encode({ alg: 'RS256', typ: 'JWT' })}.${encode({ iat: Math.floor(now / 1000) - 60, exp: Math.floor(now / 1000) + 540, iss: String(appId) })}`
  return unsigned + '.' + sign('RSA-SHA256', Buffer.from(unsigned), key).toString('base64url')
}
export function assertAppPermissions(permissions) {
  for (const [name, value] of Object.entries(APP_PERMISSIONS))
    if (permissions?.[name] !== value) throw new Error(`GitHub App permission mismatch: ${name}`)
  for (const [name, value] of Object.entries(permissions ?? {}))
    if (name !== 'metadata' && !Object.hasOwn(APP_PERMISSIONS, name) && value !== 'none')
      throw new Error(`Unapproved GitHub App permission: ${name}`)
}
export async function createAppClient(config, fetcher = fetch) {
  const app = config.githubApp
  if (
    !app ||
    !Number.isSafeInteger(app.installationId) ||
    app.installationId <= 0 ||
    !Number.isSafeInteger(app.repositoryId) ||
    app.repositoryId <= 0
  )
    throw new Error('App creation/installation requires explicit user authorization and configuration')
  const pem = readFileSync(join(config.directory, 'github-app.pem'))
  const request = async (route, token, options = {}) => {
    if (
      !/^(?:app(?:\/|$)|repos\/|installation\/)/.test(route) ||
      route.split('/').some((part) => part === '..') ||
      /[\r\n]/.test(route)
    )
      throw new Error('Invalid GitHub API route')
    const response = await fetcher(`https://api.github.com/${route}`, {
      method: options.method ?? 'GET',
      signal: AbortSignal.timeout(30000),
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2026-03-10',
        'Content-Type': 'application/json'
      },
      ...(options.body ? { body: JSON.stringify(options.body) } : {})
    })
    if (!response.ok) throw new Error(`GitHub App request failed (${response.status})`)
    return response.status === 204 ? null : await response.json()
  }
  const identity = await request('app', appJwt(app.appId, pem))
  if (identity.id !== app.appId) throw new Error('App private key does not match the configured App')
  assertAppPermissions(identity.permissions)
  let token = '',
    expires = 0
  const refresh = async () => {
    const value = await request(
      `app/installations/${app.installationId}/access_tokens`,
      appJwt(app.appId, pem),
      {
        method: 'POST',
        body: { repository_ids: [app.repositoryId], permissions: APP_PERMISSIONS }
      }
    )
    assertAppPermissions(value.permissions)
    if (typeof value.token !== 'string' || !Number.isFinite(Date.parse(value.expires_at)))
      throw new Error('Invalid installation token response')
    token = value.token
    expires = Date.parse(value.expires_at)
  }
  const api = async (route, options = {}) => {
    if (Date.now() + 60000 >= expires) await refresh()
    return request(route, token, options)
  }
  const repositories = await api('installation/repositories?per_page=100')
  if (
    repositories.total_count !== 1 ||
    repositories.repositories[0]?.id !== app.repositoryId ||
    repositories.repositories[0]?.full_name !== config.repository
  )
    throw new Error('App token must be scoped only to the configured DSH-PX repository')
  return api
}
