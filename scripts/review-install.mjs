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
import { modelSettings } from './review-model.mjs'
import {
  copyReviewParserPayload,
  preflightReviewParserDestination,
  readLockedParserSource
} from './review-parser.mjs'

/** Trusted worker scripts: review/release controllers plus the zero-dependency secret scanner. */
export const INSTALLED_SCRIPT = /^(?:(?:review|release)-[\w-]+|check-secrets)\.mjs$/
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
  // Explicit model arguments are validated before any filesystem mutation.
  modelSettings({ model: args.model, baseUrl: args['base-url'], apiKeyEnv: args['api-key-env'] })
  // A bad dependency must leave an existing installation and its keys untouched.
  const parserSource = readLockedParserSource(source)
  preflightReviewParserDestination(root)
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
  // Only the variable NAME is stored; the key value stays in the user's environment.
  const model = modelSettings({
    model: args.model ?? previous.model?.model,
    baseUrl: args['base-url'] ?? previous.model?.baseUrl,
    apiKeyEnv: args['api-key-env'] ?? previous.model?.apiKeyEnv
  })
  const git = args.git ?? (await resolveExe('git')),
    gh = args.gh ?? (await resolveExe('gh'))
  if (![git, gh].every((path) => path && isAbsolute(path) && existsSync(path)))
    throw new Error('Git and gh must resolve to installed absolute executable paths')
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
  // The upstream contract lock lives inside review-upstream.mjs and the secret rules inside
  // check-secrets.mjs, so both are bound by the installed file digests and workerDigest.
  for (const filename of readdirSync(join(source, 'scripts')).filter((name) => INSTALLED_SCRIPT.test(name))) {
    const from = join(source, 'scripts', filename)
    files[filename] = sha256(readFileSync(from))
    copyFileSync(from, join(root, filename))
  }
  Object.assign(files, copyReviewParserPayload(parserSource, root))
  const workerDigest = installationDigest(files)
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
        git,
        gh,
        sevenZip: args['seven-zip'] ?? previous.sevenZip ?? 'C:/Program Files/7-Zip/7z.exe',
        githubApp,
        keyId,
        workerDigest,
        model,
        // Per model request: a 384K-token thinking response can exceed an hour.
        timeoutMs: 7200000
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
          'scripts/release-catalog.mjs',
          // release.yml also runs these from the candidate checkout. The controller checks these
          // digests against the protected master at run.head_sha; what actually binds the
          // executed code is that the candidate must be that independently reviewed master head.
          'scripts/build-native-pack.ts',
          'scripts/prepare-native-desktop.mjs',
          'scripts/verify-native-pack-install.mjs',
          'scripts/brand-native-installer.mjs',
          'scripts/brand-installer-images.ps1',
          'scripts/build-icon.ts',
          'scripts/check-secrets.mjs',
          'scripts/run.mjs'
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
      model: { provider: model.provider, model: model.model, baseUrl: model.baseUrl },
      apiKeyEnv: model.apiKeyEnv,
      apiKeyPresent: Boolean(process.env[model.apiKeyEnv]?.trim()),
      note: 'Worker was not started; review and commit the public policy, then configure trusted workflows and required checks.'
    })
  )
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main()
