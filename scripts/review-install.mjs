import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  writeFileSync
} from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { generateKeyPairSync, createPublicKey } from 'node:crypto'
import { command } from './review-process.mjs'
import { canonical, sha256, sourceDigest } from './review-core.mjs'

/** Import only model/transport fields; never hooks, MCP servers, plugins, rules, or literal secrets. */
export function codexConfigOverrides(source) {
  const globalKeys = new Set([
    'model',
    'model_provider',
    'model_reasoning_effort',
    'model_context_window',
    'model_auto_compact_token_limit',
    'service_tier'
  ])
  const providerKeys = new Set([
    'name',
    'base_url',
    'wire_api',
    'env_key',
    'requires_openai_auth',
    'request_max_retries',
    'stream_max_retries',
    'stream_idle_timeout_ms',
    'supports_websockets'
  ])
  const selected = /^model_provider\s*=\s*["']([^"']+)["']/m.exec(source)?.[1]
  const overrides = [],
    envKeys = []
  let table = '',
    providerSeen = false,
    modelSeen = false
  for (const raw of source.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    if (line.startsWith('[')) {
      table = line
      continue
    }
    const match = /^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+)$/.exec(line)
    if (!match) continue
    const [, key, value] = match
    const providerTable =
      selected && (table === `[model_providers.${selected}]` || table === `[model_providers."${selected}"]`)
    if ((!table && globalKeys.has(key)) || (providerTable && providerKeys.has(key))) {
      if (!/^(?:"(?:[^"\\]|\\.)*"|'[^']*'|true|false|[0-9]+)$/.test(value))
        throw new Error(
          `Unsupported model configuration syntax for ${key}; use a single literal without inline comments`
        )
      if (key === 'model') modelSeen = true
      if (providerTable) providerSeen = true
      if (key === 'env_key') envKeys.push(value.slice(1, -1))
      overrides.push(`${providerTable ? `model_providers.${selected}.` : ''}${key}=${value}`)
    } else if (providerTable && /token|header|key/i.test(key)) {
      throw new Error(
        'Selected provider uses non-importable inline authentication; configure an environment reference before installing the review worker'
      )
    }
  }
  if (!modelSeen || (selected && selected !== 'openai' && !providerSeen))
    throw new Error('Configured model/provider could not be preserved')
  return { codexOverrides: overrides, codexEnvKeys: envKeys }
}
export function installationDigest(files) {
  return sha256(canonical(files))
}
export function outsideRepository(source, destination) {
  const rel = relative(source, destination)
  return rel === '..' || rel.startsWith('..' + sep) || isAbsolute(rel)
}
async function main() {
  const args = Object.fromEntries(
    process.argv.slice(2).map((value) => {
      const at = value.indexOf('=')
      if (at < 1) throw new Error('Use --name=value arguments')
      return [value.slice(2, at), value.slice(at + 1)]
    })
  )
  const source = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  if (!args.directory || !isAbsolute(args.directory))
    throw new Error('--directory must be an absolute trusted directory outside the repository')
  const root = resolve(args.directory)
  if (!outsideRepository(source, root))
    throw new Error('Trusted worker cannot be installed inside the repository')
  mkdirSync(root, { recursive: true })
  if (!outsideRepository(realpathSync(source), realpathSync(root)))
    throw new Error('Trusted directory resolves inside the source repository')
  const previous = existsSync(join(root, 'worker.json'))
    ? JSON.parse(readFileSync(join(root, 'worker.json'), 'utf8'))
    : {}
  const previousPolicy = existsSync(join(root, 'public-policy.json'))
    ? JSON.parse(readFileSync(join(root, 'public-policy.json'), 'utf8'))
    : {}
  const resolveExe = async (name) =>
    (await command('where.exe', [name])).split(/\r?\n/).find((path) => path.toLowerCase().endsWith('.exe'))
  const codex = args.codex ?? (await resolveExe('codex')),
    git = args.git ?? (await resolveExe('git')),
    gh = args.gh ?? (await resolveExe('gh'))
  if (![codex, git, gh].every((path) => path && isAbsolute(path) && existsSync(path)))
    throw new Error('Codex, Git and gh must resolve to installed absolute executable paths')
  const authHome = process.env.CODEX_HOME ?? join(process.env.USERPROFILE ?? process.env.HOME, '.codex')
  const imported = codexConfigOverrides(readFileSync(join(authHome, 'config.toml'), 'utf8'))
  const publisher = JSON.parse(await command(gh, ['api', 'user'])).login
  if (previous.publisher && previous.publisher !== publisher)
    throw new Error('Existing trusted publisher differs from the current gh identity')
  const numberSetting = (name, fallback) => {
    const value = Number(args[name] ?? fallback ?? 0)
    if (!Number.isSafeInteger(value) || value < 0) throw new Error(`Invalid configuration ID: ${name}`)
    return value
  }
  const githubApp = {
    appId: numberSetting('app-id', previous.githubApp?.appId),
    installationId: numberSetting('installation-id', previous.githubApp?.installationId),
    repositoryId: numberSetting('repository-id', previous.githubApp?.repositoryId)
  }
  if (githubApp.appId === 15368) throw new Error('GitHub Actions cannot act as the dedicated review App')
  if (args['app-private-key']) {
    if (!Object.values(githubApp).every((id) => id > 0))
      throw new Error('Configure the authorized App and installation IDs before importing its key')
    const destination = join(root, 'github-app.pem')
    const keyBytes = readFileSync(args['app-private-key'])
    if (createPublicKey(keyBytes).asymmetricKeyType !== 'rsa') throw new Error('GitHub App key must be RSA')
    if (resolve(args['app-private-key']) !== resolve(destination))
      writeFileSync(destination, keyBytes, { mode: 0o600 })
  }
  const privatePath = join(root, 'signing-key.pem')
  if (!existsSync(privatePath)) {
    const pair = generateKeyPairSync('ed25519')
    writeFileSync(privatePath, pair.privateKey.export({ type: 'pkcs8', format: 'pem' }), {
      flag: 'wx',
      mode: 0o600
    })
  }
  const publicKey = createPublicKey(readFileSync(privatePath))
    .export({ type: 'spki', format: 'pem' })
    .toString()
  const keyId = sha256(publicKey).slice(0, 24)
  const files = {}
  for (const filename of readdirSync(join(source, 'scripts')).filter((name) =>
    /^(?:review|release)-[\w-]+\.mjs$/.test(name)
  )) {
    const from = join(source, 'scripts', filename)
    files[filename] = sha256(readFileSync(from))
    copyFileSync(from, join(root, filename))
  }
  const workerDigest = installationDigest(files)
  const cliVersion = await command(codex, ['--version'])
  writeFileSync(join(root, 'installation.json'), JSON.stringify({ files, workerDigest }, null, 2))
  writeFileSync(
    join(root, 'worker.json'),
    JSON.stringify(
      {
        version: 1,
        directory: realpathSync(root),
        repository: 'Palbudir/dsh-px',
        branch: 'master',
        publisher,
        codex,
        git,
        gh,
        sevenZip: args['seven-zip'] ?? previous.sevenZip ?? 'C:/Program Files/7-Zip/7z.exe',
        githubApp,
        authHome,
        keyId,
        workerDigest,
        cliVersion,
        timeoutMs: 900000,
        ...imported
      },
      null,
      2
    ),
    { mode: 0o600 }
  )
  const policy = {
    version: 1,
    repository: 'Palbudir/dsh-px',
    branch: 'master',
    publisher,
    workerDigest,
    reviewAppId: githubApp.appId,
    maxAgeHours: 168,
    requiredChecks: ['dsh-px/independent-review', 'dsh-px/quality'],
    trustedQuality: {
      workflowId: numberSetting('quality-workflow-id', previousPolicy.trustedQuality?.workflowId),
      path: '.github/workflows/trusted-quality.yml',
      files: Object.fromEntries(
        [
          '.github/workflows/trusted-quality.yml',
          'scripts/release-quality.mjs',
          'scripts/release-catalog.mjs'
        ].map((path) => [path, sourceDigest(readFileSync(join(source, path)))])
      )
    },
    trustedBuild: {
      workflowId: numberSetting('build-workflow-id', previousPolicy.trustedBuild?.workflowId),
      path: '.github/workflows/release.yml',
      files: Object.fromEntries(
        [
          '.github/workflows/release.yml',
          'scripts/release-package.mjs',
          'scripts/release-version.mjs',
          'scripts/release-quality.mjs',
          'scripts/release-catalog.mjs'
        ].map((path) => [path, sourceDigest(readFileSync(join(source, path)))])
      )
    },
    keys: { [keyId]: publicKey }
  }
  writeFileSync(join(root, 'public-policy.json'), JSON.stringify(policy, null, 2))
  console.log(
    JSON.stringify({
      installed: root,
      publicPolicy: join(root, 'public-policy.json'),
      workerDigest,
      publisher,
      note: 'Worker was not started; review and commit the public policy, then configure trusted workflows and required checks.'
    })
  )
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main()
