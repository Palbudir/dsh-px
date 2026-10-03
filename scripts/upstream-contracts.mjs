import { createHash, randomUUID } from 'node:crypto'
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync
} from 'node:fs'
import { join } from 'node:path'
import { gunzipSync } from 'node:zlib'

/**
 * Pinned upstream DSH contracts used by CI to verify official dependencies.
 * Package identities, hashes and file selections are maintained here.
 * Each tarball URL is derived from the registry, package name and version, and must match the
 * pinned sha512 SRI. Only listed regular files are projected, in memory, never executed.
 */
export const UPSTREAM_LOCK = deepFreeze({
  schemaVersion: 1,
  registry: 'https://registry.npmjs.org',
  hosts: ['0.2.0-rc.2'],
  packages: {
    '@deepseek-ai/dsh-client-connection': {
      integrity: {
        '0.2.0-rc.2':
          'sha512-eL66YSZ0+HlWRzAPGU8jtCLd322WXBoMGN1g1OsM5T7Skqbbo9hSwV1FO3Lm0IcMZR3Y07sGPQBwZwf/l66T3w=='
      },
      files: [
        'package.json',
        'LICENSE',
        'lib/types/index.d.ts',
        'lib/types/rpc.d.ts',
        'lib/types/rpc-host.d.ts',
        'lib/types/api-request-trust.d.ts',
        'lib/types/browser-auth.d.ts',
        'lib/types/client/connection.d.ts'
      ],
      slices: [
        {
          file: 'lib/index.js',
          anchor: 'requestRejection(request) {',
          before: 30,
          after: 30
        }
      ]
    },
    '@deepseek-ai/dsh-host-webserver': {
      integrity: {
        '0.2.0-rc.2':
          'sha512-0zvI44emJMRr928Tfl//cPJlx/hiTGWfD1zaDlXu35eGIgOATFJlTPkJLApJvJOPVPPAlSOSdhI2L+j1TnzStw=='
      },
      files: ['package.json', 'LICENSE', 'lib/types/index.d.ts']
    },
    '@deepseek-ai/dsh-client-ui-slots': {
      integrity: {
        '0.2.0-rc.2':
          'sha512-zfILCyG3ijHT7S8+WDXFz4RMxBJtG9A3ngtDBnqcLbD5wzKz8H7E+HC657USa6RgG13C2RGSs73sfKcSs4WtWQ=='
      },
      files: [
        'package.json',
        'LICENSE',
        'lib/types/index.d.ts',
        'lib/types/renderer.d.ts',
        'lib/types/store.d.ts'
      ]
    },
    '@deepseek-ai/dsh-client-ui-layout': {
      integrity: {
        '0.2.0-rc.2':
          'sha512-OZzGxqoAV5zHPgFveJnw599J0j0pWbJiD5c5hdPeLyNMdRdTa2CC2gR7fbn63XGu08O+OruTDXHkCrOVuvkdQw=='
      },
      files: [
        'package.json',
        'LICENSE',
        'lib/types/client/index.d.ts',
        'lib/types/client/columns.d.ts',
        'lib/types/client/service.d.ts',
        'lib/types/client/stores.d.ts'
      ]
    },
    '@deepseek-ai/dsh-client-ui-sidebar': {
      integrity: {
        '0.2.0-rc.2':
          'sha512-qAvv42Jt36dVVHNuuZFUbR5kMofhPmGeFafBcOU1mlmUJitZFf31MFFF34UER3JSnByxwAeHsMx9JMq4k7nA4w=='
      },
      files: [
        'package.json',
        'LICENSE',
        'lib/types/client/index.d.ts',
        'lib/types/client/contract/slots.d.ts'
      ]
    },
    '@deepseek-ai/dsh-client-ui-sidebar-right': {
      integrity: {
        '0.2.0-rc.2':
          'sha512-ocVUP6v3X7vShYeJ5I1Z3t1lDC02hJdZ49/kIRj29Xbe+BIfMY9HSDyUVUUDdijdd3jP8dpmhmbHbDJudwFUtQ=='
      },
      files: [
        'package.json',
        'LICENSE',
        'lib/types/client/index.d.ts',
        'lib/types/client/service.d.ts',
        'lib/types/client/tab-registry.d.ts',
        'lib/types/client/tab-info.d.ts',
        'lib/types/client/tab-domain.d.ts',
        'lib/types/client/contract/slots.d.ts',
        'lib/types/client/contract/params.d.ts'
      ]
    },
    '@deepseek-ai/dsh-client-modules': {
      integrity: {
        '0.2.0-rc.2':
          'sha512-eDF7dycEl8QJ8CAZTSTz+dZh2PFHsf/ESAsjWjhcHxueLji7LF8/MY54PgU051Ho0V7zQKCAAeFWK2/GyIpgIg=='
      },
      files: [
        'package.json',
        'LICENSE',
        'lib/types/index.d.ts',
        'lib/types/client/index.d.ts',
        'lib/types/client/manifest.d.ts',
        'lib/types/client/system.d.ts'
      ]
    },
    '@deepseek-ai/dsh-app-boot': {
      integrity: {
        '0.2.0-rc.2':
          'sha512-WvgNhBHSj85Z7u9vC1oQr9C7yZQ/L/JS+eVK4bueWEkaoqdEna504V5bi7qtWXxAz5JkeVZTy1sX86p8XG7LJg=='
      },
      files: ['package.json', 'LICENSE', 'lib/types/index.d.ts'],
      slices: [
        {
          file: 'lib/index.js',
          anchor: 'function anchorInsertedPluginNames(',
          before: 2,
          after: 60
        }
      ]
    },
    '@deepseek-ai/dsh-client-locale': {
      integrity: {
        '0.2.0-rc.2':
          'sha512-JdZPMv/8hLOQNxHk1dM6YbNbChB5S6lGaGAPtraP0670i9Tb4dX+yKOAUgkS7nSoO5TYZztXgI1kgcEregRPJA=='
      },
      files: ['package.json', 'LICENSE', 'lib/types/client/index.d.ts']
    },
    '@deepseek-ai/dsh-client-ui-settings': {
      integrity: {
        '0.2.0-rc.2':
          'sha512-Kyho8FvRGYb7Ok1t7T429d4Dj/XF8+tE/+MX6T1s41RkXCe7v0sP89i4DUMo6OeUxyE+/uGoAVa5QZXY4O/y+g=='
      },
      files: ['package.json', 'LICENSE', 'lib/types/client/index.d.ts']
    },
    '@deepseek-ai/dsh-api-session-controller': {
      integrity: {
        '0.2.0-rc.2':
          'sha512-WDmk1aWOHbzIKRRt7rtHDxSupw/XLB+BgMyKHlzB7QGinXrK/Dnht6JIdgE1iSShnf1RNANGAGh2G94VzDpl5Q=='
      },
      files: [
        'package.json',
        'LICENSE',
        'lib/types/client/index.d.ts',
        'lib/types/client/contract/sessions.d.ts',
        'lib/types/client/sessions/service.d.ts'
      ]
    },
    '@deepseek-ai/dsh-client-ui-workspace': {
      integrity: {
        '0.2.0-rc.2':
          'sha512-dGKLOFJXBiGDKl+qWMQ0cYF0AT485JMzSk+AUM6/81tZPapJuirxP7Yf5ZFMfsmgQFv6m4jjYlnOc6KcIfUUZQ=='
      },
      files: ['package.json', 'LICENSE', 'lib/types/client/navigation.d.ts']
    },
    '@deepseek-ai/dsh-client-ui-session': {
      integrity: {
        '0.2.0-rc.2':
          'sha512-QbavrwYkWqdmR4Be7Bv2tNqf+Gh1LV6+rlDkdukMWvdJFSeAmX9Fsctwn8yqgnPRGEHZUfZIjef8zKXIWexuYQ=='
      },
      files: ['package.json', 'LICENSE', 'lib/types/client/index.d.ts']
    },
    '@deepseek-ai/dsh-client-ui-sidebar-files': {
      integrity: {
        '0.2.0-rc.2':
          'sha512-QapGZ5bpiGRFFOT4tw32nJxgkFdTkbEw7qO32vYLkcSdmbuWMETCutVBp77HLGsizB1RtYUtW/Y3IMT3uGb3Xw=='
      },
      files: ['package.json', 'LICENSE', 'lib/types/client/definition.d.ts', 'lib/types/client/index.d.ts']
    },
    '@deepseek-ai/dsh-util-workspace-path': {
      integrity: {
        '0.2.0-rc.2':
          'sha512-pjjpi+hN29dVf9HMitxo5gUAXKNdYcJ75vNVjKp2T6sdBy0wxcMKlfddu/bYx/xDL3teNBhh17EH7w1asYNNZQ=='
      },
      files: ['package.json', 'LICENSE', 'lib/types/file-address.d.ts', 'lib/index.js']
    },
    '@deepseek-ai/dsh-client-ui-renderer': {
      integrity: {
        '0.2.0-rc.2':
          'sha512-vQ/LH4A53K1J/UeF5fQs1Dj8km5cnVos7vO0rmj+pJROhE6Vs7pAAKGz5P2e02t2/2to6+iMDu2+SSITrcYWTQ=='
      },
      files: ['package.json', 'LICENSE', 'lib/types/client/index.d.ts']
    },
    '@deepseek-ai/dsh-client-ui-conversation': {
      integrity: {
        '0.2.0-rc.2':
          'sha512-Y1eWKVeh84cbB0fcV0MFOMUHBeptlzBCzsw6xslZS7p1a8l9PeFcjx5ZVTkKFuFMCfwEHWTeV9HcYqWLYH0bhw=='
      },
      files: ['package.json', 'LICENSE', 'lib/types/client/index.d.ts']
    },
    '@deepseek-ai/dsh-session': {
      integrity: {
        '0.2.0-rc.2':
          'sha512-wj+6MeqCYbDcbEvKH3puHyEGdjyu51JwBoN6Ua2tz6griLufDgLM5HpSU40L5xgpbOfrYVhXZs4vRgOrMlFY2g=='
      },
      files: ['package.json', 'LICENSE', 'lib/types/index.d.ts']
    },
    '@deepseek-ai/dsh-session-persistence': {
      integrity: {
        '0.2.0-rc.2':
          'sha512-2OoRHZYWi5Vy0+1bPU37Y/NTh6uQiZ3VdpvDmW1oCgsapQr2JS/Lbody1gXOMJ1KXglCSLmePgTMC00uKw/UIg=='
      },
      files: ['package.json', 'LICENSE', 'lib/types/index.d.ts']
    },
    '@deepseek-ai/dsh-api-workspace-controller': {
      integrity: {
        '0.2.0-rc.2':
          'sha512-3CoKQUgGxJ8yH++j/HurB4ZTrVLMZXS0cMm8Fb3ZaMB1dTseroaMoepvnBtzJF1hQx6YArNu8XvXO5qPRA6Fgg=='
      },
      files: ['package.json', 'LICENSE', 'lib/types/index.d.ts']
    },
    '@deepseek-ai/dsh-web': {
      integrity: {
        '0.2.0-rc.2':
          'sha512-d44eM9mMqGnQUGsjqUc6k1G9QrC0w+TWx6Cw6I1iXJkVw5LZ/hpVVzsuCqck8GGS8+GK20kqjGUJSyomfEgd1A=='
      },
      files: ['package.json', 'LICENSE', 'lib/types/index.d.ts']
    },
    '@deepseek-ai/dsh-jobs': {
      integrity: {
        '0.2.0-rc.2':
          'sha512-SuCCfXZDabBxsKbHoulXEeQrRSYuOYLSfhvnflQf+CYeb68wggKraejkLyO60LrCGnBJsgCqKIdIKLCUvIeN+g=='
      },
      files: ['package.json', 'LICENSE', 'lib/types/index.d.ts']
    },
    '@deepseek-ai/dsh-agent': {
      integrity: {
        '0.2.0-rc.2':
          'sha512-CUkbU+c1G0ETXkpoLkpAFo5midz66FQGtlgQOP9pzvU9H3zJQVl4H5LrhhGVbEXKLFgdbtQiOynEW8hpWn3y0Q=='
      },
      files: ['package.json', 'LICENSE', 'lib/types/index.d.ts']
    },
    '@deepseek-ai/dsh-system-prompt': {
      integrity: {
        '0.2.0-rc.2':
          'sha512-ZZNk2gkXFV8CIT0IOZXS+pFaxNVJaRknYyH2vc4ZgZAiHKT+RqUYNr8e1F5Kp0AaN0DNlcTkjOGP5MCxeXfDjg=='
      },
      files: ['package.json', 'LICENSE', 'lib/types/index.d.ts']
    },
    '@deepseek-ai/dsh-tools': {
      integrity: {
        '0.2.0-rc.2':
          'sha512-vquUz8PjHWE4zaS3wH70IpYjL441p2UlUcG8TN2yJZN1RhDkuiHum4bWCsjEPyWLS/aB1QJvzdXC2EK/PRkbsQ=='
      },
      files: ['package.json', 'LICENSE', 'lib/types/index.d.ts']
    }
  },
  services: {
    connection: ['@deepseek-ai/dsh-client-connection'],
    webServer: ['@deepseek-ai/dsh-host-webserver', '@deepseek-ai/dsh-client-connection'],
    slots: ['@deepseek-ai/dsh-client-ui-renderer', '@deepseek-ai/dsh-client-ui-slots'],
    layout: ['@deepseek-ai/dsh-client-ui-layout'],
    sidebar: ['@deepseek-ai/dsh-client-ui-sidebar'],
    sidebarRight: ['@deepseek-ai/dsh-client-ui-sidebar-right', '@deepseek-ai/dsh-util-workspace-path'],
    sidebarRightTabs: [
      '@deepseek-ai/dsh-client-ui-sidebar-right',
      '@deepseek-ai/dsh-client-ui-sidebar-files'
    ],
    sessions: [
      '@deepseek-ai/dsh-session',
      '@deepseek-ai/dsh-api-session-controller',
      '@deepseek-ai/dsh-client-ui-session'
    ],
    sessionController: ['@deepseek-ai/dsh-api-session-controller'],
    sessionPersistence: ['@deepseek-ai/dsh-session-persistence'],
    conversation: ['@deepseek-ai/dsh-client-ui-conversation'],
    workspaceController: ['@deepseek-ai/dsh-api-workspace-controller'],
    uiWorkspace: ['@deepseek-ai/dsh-client-ui-workspace'],
    web: ['@deepseek-ai/dsh-web'],
    jobs: ['@deepseek-ai/dsh-jobs'],
    agents: ['@deepseek-ai/dsh-agent'],
    systemPrompt: ['@deepseek-ai/dsh-system-prompt'],
    tools: ['@deepseek-ai/dsh-tools'],
    settings: ['@deepseek-ai/dsh-client-ui-settings'],
    locale: ['@deepseek-ai/dsh-client-locale']
  },
  manifest: ['@deepseek-ai/dsh-client-modules', '@deepseek-ai/dsh-app-boot']
})

const LIMITS = Object.freeze({ tarball: 8 * 1024 * 1024, unpacked: 64 * 1024 * 1024, file: 64 * 1024 })
function deepFreeze(value) {
  if (value && typeof value === 'object') {
    for (const item of Object.values(value)) deepFreeze(item)
    Object.freeze(value)
  }
  return value
}
const sha256 = (value) => createHash('sha256').update(value).digest('hex')
export const upstreamLockDigest = (lock = UPSTREAM_LOCK) => sha256(canonical(lock))
function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']'
  if (value && typeof value === 'object')
    return (
      '{' +
      Object.keys(value)
        .sort()
        .map((k) => JSON.stringify(k) + ':' + canonical(value[k]))
        .join(',') +
      '}'
    )
  return JSON.stringify(value)
}

/** Derived, never supplied: registry + exact scoped name + exact semver. */
export function tarballUrl(name, version, registry = UPSTREAM_LOCK.registry) {
  const match = /^@([a-z0-9][a-z0-9-]*)\/([a-z0-9][a-z0-9._-]*)$/.exec(name)
  if (
    !match ||
    registry !== 'https://registry.npmjs.org' ||
    typeof version !== 'string' ||
    !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z]+(?:\.[0-9A-Za-z]+)*)?$/.test(version)
  )
    throw new Error(`Invalid upstream package identity ${JSON.stringify(name + '@' + version)}`)
  return `${registry}/@${match[1]}/${match[2]}/-/${match[2]}-${version}.tgz`
}

export function verifySri(bytes, integrity) {
  const match = /^sha512-([A-Za-z0-9+/]{86}==)$/.exec(integrity ?? '')
  if (!match) throw new Error('Upstream integrity must be a single sha512 SRI')
  if (createHash('sha512').update(bytes).digest('base64') !== match[1])
    throw new Error('Upstream tarball SRI mismatch')
}

/** Minimal ustar/pax reader: regular files only; links, devices, traversal and duplicates fail. */
export function readTarball(buffer) {
  const files = new Map()
  let offset = 0,
    paxPath = null,
    total = 0
  const field = (block, start, length) =>
    block
      .subarray(start, start + length)
      .toString('utf8')
      .replace(/\0[\s\S]*$/, '')
  while (offset + 512 <= buffer.length) {
    const header = buffer.subarray(offset, offset + 512)
    if (header.every((byte) => byte === 0)) break
    let sum = 0
    for (let i = 0; i < 512; i++) sum += i >= 148 && i < 156 ? 32 : header[i]
    const declared = parseInt(field(header, 148, 8).trim(), 8)
    const sizeText = field(header, 124, 12).trim()
    if (declared !== sum || !/^[0-7]+$/.test(sizeText)) throw new Error('Malformed upstream tar header')
    const size = parseInt(sizeText, 8),
      type = header[156] === 0 ? '0' : String.fromCharCode(header[156])
    if (offset + 512 + size > buffer.length) throw new Error('Truncated upstream tar entry')
    const prefix = field(header, 345, 155),
      name = paxPath ?? (prefix ? prefix + '/' + field(header, 0, 100) : field(header, 0, 100))
    const body = buffer.subarray(offset + 512, offset + 512 + size)
    offset += 512 + Math.ceil(size / 512) * 512
    if (type === 'x') {
      paxPath = null
      for (const record of body.toString('utf8').split('\n')) {
        const match = /^\d+ path=(.*)$/.exec(record)
        if (match) paxPath = match[1]
      }
      continue
    }
    paxPath = null
    if (type === 'g' || type === '5') continue
    if (type !== '0')
      throw new Error(`Upstream tarball contains a non-regular entry: ${JSON.stringify(name)}`)
    const parts = name.split('/')
    if (
      parts[0] !== 'package' ||
      parts.length < 2 ||
      name.includes('\\') ||
      name.includes('\0') ||
      parts.slice(1).some((part) => !part || part === '.' || part === '..')
    )
      throw new Error(`Unsafe upstream tar path ${JSON.stringify(name)}`)
    const path = parts.slice(1).join('/')
    if (files.has(path)) throw new Error(`Duplicate upstream tar entry ${JSON.stringify(path)}`)
    total += size
    if (total > LIMITS.unpacked) throw new Error('Upstream tarball exceeds unpacked limit')
    files.set(path, Buffer.from(body))
  }
  return files
}

function decode(bytes, label) {
  const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes)
  if (text.includes('\0')) throw new Error(`Upstream contract is not text: ${label}`)
  return text
}

/** Project one verified tarball into labelled contract text. Pure: bytes in, projection out. */
export function projectTarball(name, version, integrity, bytes, pin) {
  if (bytes.length > LIMITS.tarball) throw new Error('Upstream tarball exceeds size limit')
  verifySri(bytes, integrity)
  const entries = readTarball(gunzipSync(bytes, { maxOutputLength: LIMITS.unpacked }))
  const manifest = JSON.parse(decode(entries.get('package.json') ?? Buffer.alloc(0), name + '/package.json'))
  if (manifest.name !== name || manifest.version !== version)
    throw new Error(`Upstream tarball identity mismatch for ${name}@${version}`)
  const files = []
  const add = (path, text, extra = {}) => {
    if (text.length > LIMITS.file) throw new Error(`Upstream contract ${name}/${path} exceeds per-file limit`)
    files.push({ path, sha256: sha256(entries.get(path)), bytes: entries.get(path).length, ...extra, text })
  }
  for (const path of pin.files) {
    if (!entries.has(path)) throw new Error(`Pinned upstream contract is missing: ${name}@${version}/${path}`)
    add(path, decode(entries.get(path), path))
  }
  for (const slice of pin.slices ?? []) {
    if (!entries.has(slice.file))
      throw new Error(`Pinned upstream contract is missing: ${name}@${version}/${slice.file}`)
    const lines = decode(entries.get(slice.file), slice.file).split('\n')
    const hits = lines.flatMap((line, index) => (line.includes(slice.anchor) ? [index] : []))
    if (hits.length !== 1)
      throw new Error(`Upstream slice anchor must match exactly once: ${name}@${version}/${slice.file}`)
    const from = Math.max(0, hits[0] - slice.before),
      to = Math.min(lines.length, hits[0] + slice.after + 1)
    add(slice.file, lines.slice(from, to).join('\n'), {
      slice: { fromLine: from + 1, toLine: to, anchor: slice.anchor }
    })
  }
  return {
    name,
    version,
    tarball: tarballUrl(name, version),
    integrity,
    license: typeof manifest.license === 'string' ? manifest.license : null,
    files
  }
}

function privateRegularFile(path) {
  const stat = lstatSync(path)
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1)
    throw new Error('Upstream cache entry is not a private regular file')
}

/**
 * Read a response body, aborting as soon as it exceeds `limit` bytes. The declared length is
 * checked first, but a chunked or understated response is still bounded while it is read.
 */
export async function boundedBody(response, limit) {
  const tooLarge = () => new Error('Upstream tarball exceeds size limit')
  if (Number(response.headers?.get?.('content-length') ?? 0) > limit) throw tooLarge()
  if (!response.body?.getReader) {
    const bytes = Buffer.from(await response.arrayBuffer())
    if (bytes.length > limit) throw tooLarge()
    return bytes
  }
  const reader = response.body.getReader(),
    chunks = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > limit) {
      await reader.cancel().catch(() => {})
      throw tooLarge()
    }
    chunks.push(Buffer.from(value))
  }
  return Buffer.concat(chunks, size)
}

/** Download or reuse a cached tarball. The cache is re-verified on every read and never trusted by name. */
export async function fetchTarball(name, version, integrity, options = {}) {
  const { cacheDirectory, fetch: fetcher = globalThis.fetch, timeoutMs = 60000 } = options
  if (!cacheDirectory) throw new Error('Upstream cache directory is required')
  mkdirSync(cacheDirectory, { recursive: true, mode: 0o700 })
  const file = join(cacheDirectory, sha256(integrity) + '.tgz')
  if (existsSync(file)) {
    privateRegularFile(file)
    const bytes = readFileSync(file)
    try {
      verifySri(bytes, integrity)
      return bytes
    } catch {
      // A damaged cache is quarantined and replaced, never used.
      renameSync(file, file + '.corrupt-' + randomUUID())
    }
  }
  if (options.offline) throw new Error(`Upstream contract is not cached: ${name}@${version}`)
  const response = await fetcher(tarballUrl(name, version), {
    redirect: 'error',
    signal: AbortSignal.timeout(timeoutMs),
    headers: { accept: 'application/octet-stream' }
  })
  if (!response.ok) throw new Error(`Registry returned ${response.status} for ${name}@${version}`)
  const bytes = await boundedBody(response, LIMITS.tarball)
  verifySri(bytes, integrity)
  const temporary = file + '.' + randomUUID() + '.tmp'
  try {
    writeFileSync(temporary, bytes, { flag: 'wx', mode: 0o600, flush: true })
    renameSync(temporary, file)
  } finally {
    try {
      unlinkSync(temporary)
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
    }
  }
  return bytes
}

/** Build the complete verified catalog for every pinned host. Any failure aborts the review. */
export async function loadUpstreamCatalog(options = {}, lock = UPSTREAM_LOCK) {
  if (lock.schemaVersion !== 1 || lock.registry !== 'https://registry.npmjs.org')
    throw new Error('Untrusted upstream contract lock')
  const hosts = new Map()
  for (const host of lock.hosts) {
    const packages = new Map()
    for (const [name, pin] of Object.entries(lock.packages)) {
      const integrity = pin.integrity?.[host]
      if (!integrity) throw new Error(`Upstream contract ${name} is not pinned for host ${host}`)
      const bytes = await fetchTarball(name, host, integrity, options)
      packages.set(name, projectTarball(name, host, integrity, bytes, pin))
    }
    hosts.set(host, packages)
  }
  return { lockDigest: upstreamLockDigest(lock), services: lock.services, manifest: lock.manifest, hosts }
}

/** Host versions declared anywhere in the candidate product contract must all be pinned. */
export function requirePinnedHosts(catalog, productText) {
  // Without a product contract no host can be proven pinned; that is not "all pinned".
  if (productText === undefined || productText === null)
    throw new Error('Candidate product contract config/products.json is missing')
  let value
  try {
    value = JSON.parse(productText)
  } catch {
    throw new Error('Candidate product contract is not valid JSON')
  }
  const versions = new Set(),
    stack = [value]
  while (stack.length) {
    const node = stack.pop()
    if (!node || typeof node !== 'object') continue
    for (const [key, item] of Object.entries(node)) {
      if (key === 'hostVersion' && typeof item === 'string') versions.add(item)
      else if (key === 'hostVersions' && Array.isArray(item))
        for (const version of item) if (typeof version === 'string') versions.add(version)
      if (item && typeof item === 'object') stack.push(item)
    }
  }
  if (!versions.size) throw new Error('Candidate product contract declares no host version')
  for (const version of versions)
    if (!catalog.hosts.has(version))
      throw new Error(`Upstream DSH contract is not pinned for declared host ${JSON.stringify(version)}`)
  return [...versions].sort()
}
