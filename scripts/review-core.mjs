import { createHash, createPrivateKey, createPublicKey, sign, verify } from 'node:crypto'
import { inflateRawSync } from 'node:zlib'
import { posix } from 'node:path'
import { isBuiltin } from 'node:module'
import { parseReviewSource } from './review-parser.mjs'

export const CHECK_NAME = 'dsh-px/independent-review'
export const QUALITY_CHECK_NAME = 'dsh-px/quality'
export const QUALITY_MARKER = 'DSH_PX_QUALITY_V1:'
export const REPORT_MARKER = 'DSH_PX_REVIEW_V1:'
export const sha256 = (value) => createHash('sha256').update(value).digest('hex')
export const sourceDigest = (value) =>
  sha256(
    (typeof value === 'string' ? value : decodeSource(value, 'controller source')).replaceAll('\r\n', '\n')
  )
export function decodeSource(bytes, label) {
  const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes)
  if (text.includes('\0')) throw new Error(`Binary source requires separate verified review: ${label}`)
  return text
}
export function sha(value) {
  if (typeof value !== 'string' || !/^[a-f0-9]{40}$/.test(value)) throw new Error('Invalid commit SHA')
  return value
}
export function canonical(value) {
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
export const reviewSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['head', 'base', 'batchId', 'verdict', 'summary', 'findings', 'blockers'],
  properties: {
    head: { type: 'string' },
    base: { type: 'string' },
    batchId: { type: 'string' },
    verdict: { type: 'string', enum: ['pass', 'fail', 'blocked'] },
    summary: { type: 'string' },
    blockers: { type: 'array', items: { type: 'string' } },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['priority', 'path', 'line', 'title', 'detail'],
        properties: {
          priority: { type: 'integer', minimum: 0, maximum: 3 },
          path: { type: 'string' },
          line: { type: 'integer', minimum: 1 },
          title: { type: 'string' },
          detail: { type: 'string' }
        }
      }
    }
  }
}
export function validateResult(value, request, batchId) {
  if (
    !value ||
    value.head !== request.head ||
    value.base !== request.base ||
    value.batchId !== batchId ||
    !['pass', 'fail', 'blocked'].includes(value.verdict) ||
    typeof value.summary !== 'string' ||
    value.summary.length > 4000 ||
    !Array.isArray(value.findings) ||
    value.findings.length > 100 ||
    !Array.isArray(value.blockers) ||
    !value.blockers.every((v) => typeof v === 'string' && v.length <= 2000)
  )
    throw new Error('Invalid reviewer result or mismatched commit identity')
  for (const finding of value.findings) {
    if (
      !Number.isInteger(finding.priority) ||
      finding.priority < 0 ||
      finding.priority > 3 ||
      !Number.isSafeInteger(finding.line) ||
      finding.line < 1 ||
      !['path', 'title', 'detail'].every(
        (k) => typeof finding[k] === 'string' && finding[k].length > 0 && finding[k].length <= 4000
      )
    )
      throw new Error('Invalid finding')
  }
  return value
}
export function aggregate(request, batches, results) {
  if (!batches.length || results.length !== batches.length) throw new Error('Incomplete review coverage')
  const verified = results.map((r, i) => validateResult(r, request, batches[i].id))
  const findings = verified.flatMap((r) => r.findings)
  const blockers = verified.flatMap((r) => r.blockers)
  return {
    verdict:
      verified.every((r) => r.verdict === 'pass') &&
      !blockers.length &&
      !findings.some((f) => f.priority <= 2)
        ? 'pass'
        : 'fail',
    findings,
    blockers,
    batches: batches.map((b) => ({ id: b.id, digest: sha256(b.text) }))
  }
}
export function attest(payload, keyId, privateKey) {
  return {
    payload,
    keyId,
    signature: sign(null, Buffer.from(canonical(payload)), createPrivateKey(privateKey)).toString('base64')
  }
}
export function verifyAttestation(report, policy, expected = {}, now = Date.now()) {
  const payload = report?.payload
  const publicKey = policy?.keys?.[report?.keyId]
  if (
    !publicKey ||
    !payload ||
    typeof report.signature !== 'string' ||
    !verify(
      null,
      Buffer.from(canonical(payload)),
      createPublicKey(publicKey),
      Buffer.from(report.signature, 'base64')
    )
  )
    throw new Error('Review signature is missing or invalid')
  sha(payload.head)
  sha(payload.base)
  sha(payload.tree)
  sha(payload.mergeBase)
  if (
    !/^[a-f0-9]{64}$/.test(payload.filesDigest) ||
    !Number.isSafeInteger(payload.requestRunId) ||
    payload.requestRunId < 1 ||
    !Number.isSafeInteger(payload.requestAttempt) ||
    payload.requestAttempt < 1 ||
    !['provider', 'model', 'baseUrl'].every(
      (key) => typeof payload.reviewer?.[key] === 'string' && payload.reviewer[key]
    ) ||
    !/^https:\/\//.test(payload.reviewer.baseUrl) ||
    payload.reviewer.configurationDigest !==
      sha256(
        canonical({
          provider: payload.reviewer.provider,
          model: payload.reviewer.model,
          baseUrl: payload.reviewer.baseUrl
        })
      )
  )
    throw new Error('Signed review lacks source or reviewer identity')
  if (
    payload.version !== 1 ||
    payload.repository !== policy.repository ||
    payload.publisher !== policy.publisher ||
    payload.workerDigest !== policy.workerDigest ||
    (expected.head && payload.head !== expected.head) ||
    (expected.base && payload.base !== expected.base)
  )
    throw new Error('Review scope or trusted publisher mismatch')
  if (
    !Number.isSafeInteger(payload.completedAt) ||
    payload.completedAt > now + 60000 ||
    now - payload.completedAt > (policy.maxAgeHours ?? 168) * 3600000
  )
    throw new Error('Review evidence is stale')
  if (
    !Array.isArray(payload.batches) ||
    !payload.batches.length ||
    !payload.batches.every((b) => typeof b.id === 'string' && /^[a-f0-9]{64}$/.test(b.digest)) ||
    !Array.isArray(payload.findings) ||
    !Array.isArray(payload.blockers)
  )
    throw new Error('Incomplete signed evidence')
  if (
    payload.verdict !== 'pass' ||
    payload.blockers.length ||
    payload.findings.some(
      (f) => !Number.isInteger(f.priority) || f.priority < 0 || f.priority > 3 || f.priority <= 2
    )
  )
    throw new Error('Independent review has unresolved findings')
  return payload
}
export function encodeReport(report) {
  const encoded = Buffer.from(JSON.stringify(report)).toString('base64')
  if (encoded.length > 58000)
    throw new Error('Review proof exceeds workflow input limit; findings must be resolved before publication')
  return encoded
}
export function decodeReport(encoded) {
  if (typeof encoded !== 'string' || encoded.length > 58000 || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded))
    throw new Error('Invalid encoded proof')
  return JSON.parse(Buffer.from(encoded, 'base64').toString('utf8'))
}
/** Read just one bounded JSON member; never extract repository-controlled archives to disk. */
export function requestFromZip(buffer) {
  if (buffer.length > 128000) throw new Error('Review request archive too large')
  let end = -1
  for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 65558); i--)
    if (buffer.readUInt32LE(i) === 0x06054b50) {
      end = i
      break
    }
  if (end < 0 || buffer.readUInt16LE(end + 10) !== 1) throw new Error('Expected exactly one review request')
  const c = buffer.readUInt32LE(end + 16)
  if (buffer.readUInt32LE(c) !== 0x02014b50) throw new Error('Invalid ZIP directory')
  const nameLength = buffer.readUInt16LE(c + 28),
    size = buffer.readUInt32LE(c + 24),
    packed = buffer.readUInt32LE(c + 20)
  if (
    buffer.subarray(c + 46, c + 46 + nameLength).toString() !== 'request.json' ||
    size > 16000 ||
    packed > 64000 ||
    buffer.readUInt16LE(c + 8) & 1
  )
    throw new Error('Invalid review request member')
  const local = buffer.readUInt32LE(c + 42)
  if (buffer.readUInt32LE(local) !== 0x04034b50) throw new Error('Invalid ZIP member')
  const offset = local + 30 + buffer.readUInt16LE(local + 26) + buffer.readUInt16LE(local + 28)
  const compressed = buffer.subarray(offset, offset + packed),
    method = buffer.readUInt16LE(c + 10)
  const data =
    method === 0
      ? compressed
      : method === 8
        ? inflateRawSync(compressed, { maxOutputLength: 16000 })
        : undefined
  if (!data || data.length !== size) throw new Error('Invalid review request payload')
  return JSON.parse(data.toString('utf8'))
}
export function validateRequest(value, repository) {
  if (
    value?.version !== 1 ||
    value.repository !== repository ||
    value.headRepository !== repository ||
    !['push', 'pull_request'].includes(value.kind) ||
    !Number.isSafeInteger(value.runId) ||
    !Number.isSafeInteger(value.runAttempt) ||
    value.runAttempt < 1
  )
    throw new Error('Fork or invalid review request is not admitted')
  sha(value.head)
  sha(value.base)
  return value
}

/** Git paths, never host paths: no traversal, filesystem dependency trees or local secrets. */
export function reviewSourcePath(path) {
  if (
    typeof path !== 'string' ||
    !path ||
    path.includes('\\') ||
    path.includes('\0') ||
    posix.isAbsolute(path) ||
    /^[a-z]:/i.test(path) ||
    path.split('/').some((part) => part === '..' || part === '.' || !part)
  )
    throw new Error(`Unsafe review source path: ${JSON.stringify(path)}`)
  if (
    path
      .split('/')
      .some((part) =>
        ['.git', '.ssh', '.aws', 'node_modules', 'runtime', 'dist', 'build-test'].includes(part)
      ) ||
    /(?:^|\/)(?:\.?credentials(?:\.|$)|\.env(?:\.|$))|\.(?:pem|key|p12|pfx)$/i.test(path)
  )
    throw new Error(`Private or generated path is not review context: ${JSON.stringify(path)}`)
  return path
}

export function parseReviewTree(bytes) {
  return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true })
    .decode(bytes)
    .split('\0')
    .filter(Boolean)
    .map((record) => {
      const tab = record.indexOf('\t'),
        header = record.slice(0, tab).trim().split(/\s+/)
      if (
        tab < 0 ||
        header.length !== 4 ||
        !/^[0-9]{6}$/.test(header[0]) ||
        !/^[a-f0-9]{40}$/.test(header[2])
      )
        throw new Error('Malformed Git source inventory')
      return {
        path: record.slice(tab + 1),
        mode: header[0],
        type: header[1],
        oid: header[2],
        size: header[3] === '-' ? null : Number(header[3])
      }
    })
}

/** Read module contracts from a mature AST. Candidate text is parsed as data, never executed. */
export function reviewModuleReferences(source, options = {}) {
  const ast = parseReviewSource(source, options),
    nodes = [],
    stack = [ast]
  while (stack.length) {
    const node = stack.pop()
    if (!node || typeof node !== 'object' || typeof node.type !== 'string') continue
    nodes.push(node)
    if (nodes.length > 500000) throw new Error('Review source AST exceeds node budget')
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) {
        for (let i = value.length - 1; i >= 0; i--)
          if (value[i] && typeof value[i].type === 'string') stack.push(value[i])
      } else if (value && typeof value === 'object' && typeof value.type === 'string') stack.push(value)
    }
  }
  const literal = (node) =>
    node?.type === 'StringLiteral'
      ? node.value
      : node?.type === 'TemplateLiteral' && node.expressions.length === 0
        ? node.quasis[0].value.cooked
        : undefined
  const member = (node, object, property) =>
    node?.type === 'MemberExpression' &&
    !node.computed &&
    node.object?.type === 'Identifier' &&
    node.object.name === object &&
    node.property?.name === property
  const call = (node, name) =>
    node?.type === 'CallExpression' && node.callee?.type === 'Identifier' && node.callee.name === name
  const helpers = new Set()
  for (const node of nodes) {
    if (
      node.type !== 'VariableDeclarator' ||
      node.id?.type !== 'Identifier' ||
      node.init?.type !== 'ArrowFunctionExpression' ||
      node.init.params.length !== 1 ||
      node.init.params[0].type !== 'Identifier'
    )
      continue
    const body = node.init.body,
      target = body?.type === 'ImportExpression' ? body.source : undefined
    if (
      target?.type !== 'MemberExpression' ||
      target.computed ||
      target.property?.name !== 'href' ||
      !call(target.object, 'pathToFileURL') ||
      target.object.arguments.length !== 1
    )
      continue
    const resolved = target.object.arguments[0]
    if (
      call(resolved, 'resolve') &&
      resolved.arguments.length === 2 &&
      literal(resolved.arguments[0]) === 'scripts' &&
      resolved.arguments[1]?.type === 'Identifier' &&
      resolved.arguments[1].name === node.init.params[0].name
    )
      helpers.add(node.id.name)
  }
  const literals = [],
    dynamic = []
  const add = (target, node, kind, complete = true, repositoryRelative = false) => {
    const value = literal(target)
    if (typeof value === 'string' && complete) {
      literals.push({
        specifier: repositoryRelative ? 'scripts/' + value : value,
        at: target.start,
        ...(repositoryRelative ? { repositoryRelative: true } : {})
      })
      return
    }
    const prefix =
      value ??
      (target?.type === 'BinaryExpression' && target.operator === '+' ? literal(target.left) : undefined)
    dynamic.push({
      at: node.start,
      kind,
      ...(typeof prefix === 'string'
        ? { incompleteLiteralPrefix: (repositoryRelative ? 'scripts/' : '') + prefix }
        : {})
    })
  }
  for (const node of nodes) {
    if (
      ['ImportDeclaration', 'ExportNamedDeclaration', 'ExportAllDeclaration'].includes(node.type) &&
      node.source
    )
      add(node.source, node, node.type)
    else if (
      node.type === 'TSModuleDeclaration' &&
      node.id?.type === 'StringLiteral' &&
      !node.id.value.startsWith('.') &&
      !node.id.value.includes('*')
    )
      // Ambient `declare module 'pkg'` is a host contract assumption: disclose it as external.
      literals.push({ specifier: node.id.value, at: node.id.start, ambient: true })
    else if (node.type === 'ImportExpression') add(node.source, node, 'import')
    else if (node.type === 'TSImportType') add(node.argument, node, 'import-type')
    else if (
      node.type === 'TSImportEqualsDeclaration' &&
      node.moduleReference?.type === 'TSExternalModuleReference'
    )
      add(node.moduleReference.expression, node, 'import-equals')
    else if (node.type === 'CallExpression') {
      if (call(node, 'require') || member(node.callee, 'require', 'resolve'))
        add(node.arguments[0], node, 'require', node.arguments.length === 1)
      else if (node.callee?.type === 'Identifier' && helpers.has(node.callee.name))
        add(node.arguments[0], node, 'load', node.arguments.length === 1, true)
    }
  }
  return { literals: literals.sort((a, b) => a.at - b.at), dynamic: dynamic.sort((a, b) => a.at - b.at) }
}
/** Resolve one repository-local module reference exactly as bundlers do; undefined when absent. */
export function resolveLocalDependency(has, from, dependency) {
  const specifier = dependency.specifier
  if (specifier.includes('\\'))
    throw new Error(`Escaped module references require explicit review context: ${from}`)
  const joined = dependency.repositoryRelative ? specifier : posix.join(posix.dirname(from), specifier)
  const path = reviewSourcePath(joined)
  const extensions = ['.ts', '.tsx', '.mts', '.cts', '.mjs', '.js', '.cjs', '.json']
  const candidates = [path]
  if (/\.[cm]?js$/.test(path))
    candidates.push(path.replace(/\.([cm]?)js$/, '.$1ts'), path.replace(/\.js$/, '.tsx'))
  if (!posix.extname(path))
    candidates.push(...extensions.map((ext) => path + ext), ...extensions.map((ext) => path + '/index' + ext))
  return candidates.find((candidate) => has(candidate))
}

export const GOVERNANCE_PATH =
  /^(?:scripts\/(?:review|release)-|test\/(?:review|release)-|docs\/github\/|\.github\/workflows\/)/
export const RELEASE_PATH =
  /^(?:scripts\/release-|test\/release-|docs\/RELEASING\.md$|docs\/github\/review-policy\.json$)/
/** Edge kinds that change behaviour; the others are context-only and never decide group ownership. */
const EXECUTABLE_EDGES = new Set(['import', 'route', 'npm-script', 'manifest'])
const SOURCE_FILE = /\.[cm]?[jt]sx?$/
const GENERATED_BUNDLE = /(?:^|\/)lib\//
/** Build and dependency outputs that are never tracked; secrets paths still fail in reviewSourcePath. */
const GENERATED_TREES = new Set(['node_modules', 'runtime', 'dist', 'build-test'])
const generatedTree = (path) => path.split('/').some((part) => GENERATED_TREES.has(part))
const safePath = (path) => {
  try {
    reviewSourcePath(path)
    return true
  } catch {
    return false
  }
}

/**
 * Repository dependency graph from immutable Git blobs of the given refs. Nodes are paths; edges
 * are literal imports plus declared non-import relationships: package-manifest entries, npm
 * scripts, plugin HTTP routes, literal repository paths, computed path patterns, shared artifact
 * names and documentation links. Unresolvable references are recorded, never guessed.
 */
export async function buildReviewGraph(reader, refs, limits = {}) {
  const maxBytes = limits.maxGraphBytes ?? 32000000,
    maxFiles = limits.maxGraphFiles ?? 20000,
    maxTreeEntries = limits.maxTreeEntries ?? 20000
  for (const [value, maximum] of [
    [maxBytes, 64000000],
    [maxFiles, 50000]
  ])
    if (!Number.isSafeInteger(value) || value < 1 || value > maximum)
      throw new Error('Invalid bounded review graph limits')
  const forward = new Map(),
    reverse = new Map(),
    paths = new Set(),
    externals = new Map(),
    releaseReaders = new Set(),
    manifests = new Map(),
    unresolved = [],
    unparsed = [],
    cache = new Map()
  let bytes = 0,
    files = 0
  const scripts = new Map()
  const edge = (from, to, kind) => {
    if (from === to) return
    // Only reviewable text sources become context; binary assets named by path are not edges.
    if (!/\.(?:[cm]?[jt]sx?|json|md|ya?ml|txt|css|html?)$/i.test(to)) return
    if (!forward.has(from)) forward.set(from, new Map())
    if (!forward.get(from).has(to)) forward.get(from).set(to, new Set())
    forward.get(from).get(to).add(kind)
    if (!reverse.has(to)) reverse.set(to, new Map())
    if (!reverse.get(to).has(from)) reverse.get(to).set(from, new Set())
    reverse.get(to).get(from).add(kind)
  }
  const addEdge = edge
  const wanted = (path) =>
    safePath(path) &&
    ((SOURCE_FILE.test(path) && !GENERATED_BUNDLE.test(path)) ||
      path.endsWith('.md') ||
      /(?:^|\/)package\.json$/.test(path))
  for (const ref of [...new Set(refs)]) {
    const entries = await reader.list(ref)
    if (entries.length > maxTreeEntries) throw new Error('Review source inventory exceeds entry limit')
    const tree = new Map(entries.map((entry) => [entry.path, entry]))
    const has = (path) => tree.has(path)
    const texts = new Map()
    for (const entry of entries) {
      if (safePath(entry.path)) paths.add(entry.path)
      if (!wanted(entry.path) || !['100644', '100755'].includes(entry.mode) || entry.type !== 'blob') continue
      if (!cache.has(entry.oid)) {
        files++
        bytes += entry.size ?? 0
        if (files > maxFiles || bytes > maxBytes) throw new Error('Review dependency graph exceeds budget')
        let text = null
        try {
          const raw = await reader.read(ref, entry.path)
          if (raw.length === entry.size) text = decodeSource(raw, entry.path)
        } catch {
          text = null
        }
        cache.set(entry.oid, text)
      }
      if (cache.get(entry.oid) !== null) texts.set(entry.path, cache.get(entry.oid))
      else if (SOURCE_FILE.test(entry.path)) unparsed.push({ ref, path: entry.path })
    }
    // Package manifests: entry points and their maintained TypeScript sources.
    for (const [path, text] of texts) {
      const match = /^(packages\/[^/]+)\/package\.json$/.exec(path)
      if (!match && path !== 'package.json') continue
      let manifest
      try {
        manifest = JSON.parse(text)
      } catch {
        unresolved.push({ ref, path, reason: 'invalid package manifest' })
        continue
      }
      const directory = match ? match[1] + '/' : ''
      if (match && typeof manifest.name === 'string') manifests.set(match[1], manifest.name)
      const targets = []
      const collect = (value) => {
        if (typeof value === 'string') targets.push(value)
        else if (value && typeof value === 'object') for (const item of Object.values(value)) collect(item)
      }
      if (match) collect([manifest.main, manifest.module, manifest.types, manifest.exports, manifest.bin])
      if (match) collect(manifest.dsh?.bundle)
      for (const target of targets) {
        if (/^(?:https?:|node:)/.test(target) || target.includes('*')) continue
        const resolved = posix.normalize(directory + target.replace(/^\.\//, ''))
        if (!safePath(resolved)) continue
        if (has(resolved)) edge(path, resolved, 'manifest')
        const source = resolved.replace(/(^|\/)lib\//, '$1src/').replace(/\.[cm]?js$/, '')
        for (const extension of ['.ts', '.tsx', '.mts'])
          if (source !== resolved && has(source + extension)) edge(path, source + extension, 'manifest')
      }
      if (path !== 'package.json') continue
      // npm scripts: direct file arguments and maintained runner indirection (`runner.mjs <name>`).
      if (!scripts.has(ref)) scripts.set(ref, new Map())
      for (const [scriptName, command] of Object.entries(manifest.scripts ?? {})) {
        if (typeof command !== 'string') continue
        const targets = new Set()
        scripts.get(ref).set(scriptName, { command, targets })
        const edge = (from, to, kind) => {
          targets.add(to)
          addEdge(from, to, kind)
        }
        const words = command.split(/\s+/)
        for (let i = 0; i < words.length; i++) {
          const word = words[i].replace(/^['"]|['"]$/g, '')
          if (safePath(word) && has(word)) edge(path, word, 'npm-script')
          const previous = words[i - 1]?.replace(/^['"]|['"]$/g, '')
          if (previous && safePath(previous) && has(previous) && /^[\w-]+$/.test(word)) {
            const directory = posix.dirname(previous)
            for (const extension of ['.ts', '.mts', '.mjs', '.js']) {
              const target = posix.join(directory, word + extension)
              if (has(target)) edge(path, target, 'npm-script')
            }
          }
        }
      }
    }
    const routeProducers = new Map(),
      routeUsers = [],
      artifacts = new Map()
    const packageOf = (path) => /^(packages\/[^/]+)\//.exec(path)?.[1]
    for (const [path, text] of texts) {
      if (path.endsWith('.md')) {
        for (const match of text.matchAll(/\]\(([^)\s#?]+)(?:[#?][^)\s]*)?\)/g)) {
          if (/^[a-z]+:/i.test(match[1])) continue
          const target = posix.normalize(posix.join(posix.dirname(path), decodeURI(match[1])))
          if (safePath(target) && has(target)) edge(path, target, 'doc')
        }
        continue
      }
      if (!SOURCE_FILE.test(path)) continue
      let references
      try {
        references = reviewModuleReferences(text, { jsx: /\.[jt]sx$/.test(path), filename: path })
      } catch (error) {
        unresolved.push({ ref, path, reason: String(error.message ?? error).slice(0, 200) })
        // Its consumers cannot be computed, so the review must not silently drop them.
        unparsed.push({ ref, path })
        continue
      }
      for (const dependency of references.literals) {
        const specifier = dependency.specifier
        if (dependency.repositoryRelative || specifier.startsWith('.')) {
          let target
          try {
            target = resolveLocalDependency(has, path, dependency)
          } catch {
            target = undefined
          }
          if (target) edge(path, target, 'import')
          else unresolved.push({ ref, path, specifier })
        } else if (!specifier.startsWith('/') && !isBuiltin(specifier)) {
          const name = /^(@[^/]+\/[^/]+|[^/]+)/.exec(specifier)?.[1]
          if (!externals.has(path)) externals.set(path, new Set())
          externals.get(path).add(name)
        }
      }
      if (/\/releases\//.test(text)) releaseReaders.add(path)
      const test = path.startsWith('test/')
      for (const match of text.matchAll(/(['"`])([^'"`\s$\\]{3,200})\1/g)) {
        const value = match[2]
        // Literal repository paths (read, spawned or checked by path) are explicit context.
        // Data/config/doc targets are read as contracts; named code files are mentions only.
        if (value.includes('/') && safePath(value) && has(value))
          edge(path, value, SOURCE_FILE.test(value) ? 'mention' : 'path')
        const route = /^\/?([a-z0-9][\w.-]*)\/([\w./-]+)$/i.exec(value)
        if (route) routeUsers.push({ path, name: route[1], route: route[1] + '/' + route[2] })
        if (
          !test &&
          /^[\w.-]+\.(?:json|ya?ml)$/.test(value) &&
          !/^(?:package|package-lock|tsconfig)\.json$/.test(value)
        ) {
          if (!artifacts.has(value)) artifacts.set(value, new Set())
          artifacts.get(value).add(path)
        }
      }
      // Computed path patterns such as `packages/${name}/package.json` link every matching file.
      for (const match of text.matchAll(/`([\w@.-]+(?:\/[\w@.-]+)*\/)\$\{[^}`]{1,80}\}([\w@./-]*)`/g)) {
        const [, prefix, suffix] = match
        const hits = [...tree.keys()].filter(
          (candidate) =>
            candidate.startsWith(prefix) &&
            candidate.endsWith(suffix) &&
            candidate.length > prefix.length + suffix.length &&
            !candidate.slice(prefix.length, candidate.length - suffix.length).includes('/') &&
            safePath(candidate)
        )
        if (hits.length <= 64) for (const hit of hits) edge(path, hit, 'path-pattern')
      }
    }
    // Plugin HTTP routes: `/<package name>/<route>` is produced by that package's own sources.
    const packageNames = new Map([...manifests].map(([directory, name]) => [name, directory]))
    for (const { path, name, route } of routeUsers) {
      const directory = packageNames.get(name)
      if (!directory) continue
      if (packageOf(path) === directory && !path.startsWith('test/')) {
        if (!routeProducers.has(route)) routeProducers.set(route, new Set())
        routeProducers.get(route).add(path)
      }
    }
    for (const { path, route } of routeUsers)
      for (const producer of routeProducers.get(route) ?? [])
        if (producer !== path && packageOf(path) !== packageOf(producer)) edge(path, producer, 'route')
    // A small set of files naming the same artifact file are its producers and consumers.
    for (const users of artifacts.values())
      if (users.size >= 2 && users.size <= 8)
        for (const a of users) for (const b of users) if (a !== b) edge(a, b, 'artifact')
  }
  return { forward, reverse, paths, externals, releaseReaders, manifests, unresolved, unparsed, scripts }
}

/** Files named by npm scripts whose command differs between two refs (added, removed or changed). */
export function changedScriptTargets(graph, before, after) {
  const a = graph.scripts.get(before) ?? new Map(),
    b = graph.scripts.get(after) ?? new Map(),
    targets = new Set()
  for (const name of new Set([...a.keys(), ...b.keys()]))
    if (a.get(name)?.command !== b.get(name)?.command)
      for (const side of [a.get(name), b.get(name)])
        for (const target of side?.targets ?? []) targets.add(target)
  return targets
}

const EMPTY = new Map()
/** Package-owned paths belong to that package's review group, named without the product prefix. */
export function reviewPackageGroup(graph, path) {
  const directory = /^(packages\/[^/]+)\//.exec(path)?.[1]
  if (!directory || !graph.manifests.has(directory)) return undefined
  return directory.slice('packages/'.length).replace(/^dsh-px-/, '')
}
function componentOf(graph, path) {
  if (GOVERNANCE_PATH.test(path)) return 'governance'
  if (path.startsWith('test/')) return undefined
  const own = reviewPackageGroup(graph, path)
  if (own) return own
  if (path.startsWith('packages/')) return undefined // shared sources belong to their consumers
  return 'runtime'
}
const executable = (kinds) => [...kinds].some((kind) => EXECUTABLE_EDGES.has(kind))

/** Review groups for one changed path, from its executable consumer closure (never path lists). */
export function reviewOwners(graph, path) {
  if (GOVERNANCE_PATH.test(path)) return ['governance']
  if (path === 'package-lock.json') return ['dependency-lock']
  const own = reviewPackageGroup(graph, path)
  if (own) {
    // A plugin route handler is also reviewed by every other component that calls the route.
    const owners = new Set([own])
    for (const [source, kinds] of graph.reverse.get(path) ?? EMPTY)
      if (kinds.has('route') && !source.startsWith('test/')) {
        const owner = componentOf(graph, source)
        if (owner) owners.add(owner)
      }
    return [...owners].sort()
  }
  const owners = new Set()
  if (path.startsWith('test/')) {
    for (const [target, kinds] of graph.forward.get(path) ?? EMPTY) {
      if (!executable(kinds)) continue
      const direct = componentOf(graph, target)
      if (direct) owners.add(direct)
      else if (target.startsWith('packages/') && !target.startsWith('test/'))
        for (const owner of reviewOwners(graph, target)) owners.add(owner)
    }
    return owners.size ? [...owners].sort() : ['verification']
  }
  const self = componentOf(graph, path)
  if (self) owners.add(self)
  const seen = new Set([path]),
    queue = [path]
  while (queue.length) {
    const current = queue.shift()
    for (const [source, kinds] of graph.reverse.get(current) ?? EMPTY) {
      if (seen.has(source) || !executable(kinds) || source.startsWith('test/')) continue
      seen.add(source)
      const owner = componentOf(graph, source)
      if (owner) owners.add(owner)
      // Only unowned shared sources forward their consumers; owned components are the boundary.
      else queue.push(source)
    }
  }
  if (!owners.size) owners.add('runtime')
  return [...owners].sort()
}

/** Unchanged direct producers/consumers that a group needs to assess its changed files. */
export function reviewContracts(graph, group, names) {
  const changed = new Set(names),
    contracts = new Set()
  const admit = (path) =>
    !changed.has(path) &&
    !path.startsWith('test/') &&
    !GENERATED_BUNDLE.test(path) &&
    path !== 'package-lock.json' &&
    safePath(path)
  for (const path of names) {
    // Manifests and documents fan out to many declared files; their changed declarations are
    // reviewed from the change record, and each declared target already has its own group.
    const hub = /(?:^|\/)package\.json$/.test(path) || path.endsWith('.md')
    const supplied = (kinds) => [...kinds].some((kind) => kind !== 'mention')
    for (const [target, kinds] of graph.forward.get(path) ?? EMPTY)
      if (
        admit(target) &&
        supplied(kinds) &&
        (!hub || (graph.changedScripts?.has(target) ?? false) || kinds.has('manifest'))
      )
        contracts.add(target)
    // A file merely naming this path (tooling inventories, messages) is not its consumer.
    for (const [source, kinds] of graph.reverse.get(path) ?? EMPTY)
      if (
        admit(source) &&
        supplied(kinds) &&
        (!hub || !kinds.has('doc')) &&
        !(hub && [...kinds].every((kind) => kind === 'artifact' || kind === 'mention'))
      )
        contracts.add(source)
  }
  // Package groups always see their own manifest entry points.
  for (const [directory] of graph.manifests)
    if (reviewPackageGroup(graph, directory + '/package.json') === group)
      for (const [target, kinds] of graph.forward.get(directory + '/package.json') ?? EMPTY)
        if (kinds.has('manifest') && admit(target)) contracts.add(target)
  return [...contracts].sort()
}

/** Local consumers of published releases: updater clients and release-feed readers. */
export function releaseConsumers(graph) {
  const consumers = new Set()
  for (const [path, names] of graph.externals)
    if (names.has('electron-updater') && !path.startsWith('test/')) consumers.add(path)
  for (const path of graph.releaseReaders)
    if (!GOVERNANCE_PATH.test(path) && !path.startsWith('test/')) consumers.add(path)
  return [...consumers].sort()
}

/**
 * Select verified upstream contract projections for the modules and host services a group uses.
 * Files identical across hosts are printed once with every host label.
 */
export function selectUpstreamContracts(catalog, { modules = [], services = [], manifest = false } = {}) {
  const known = new Set([...catalog.hosts.values()].flatMap((packages) => [...packages.keys()]))
  const selected = new Set(),
    unprojectedModules = new Set(),
    unprojectedServices = new Set()
  for (const specifier of modules) {
    const name = /^(@[^/]+\/[^/]+)/.exec(specifier)?.[1]
    if (!name?.startsWith('@deepseek-ai/')) continue
    if (known.has(name)) selected.add(name)
    else unprojectedModules.add(name)
  }
  for (const service of services) {
    const names = Object.hasOwn(catalog.services, service) ? catalog.services[service] : undefined
    if (names) for (const name of names) selected.add(name)
    else unprojectedServices.add(service)
  }
  if (manifest) for (const name of catalog.manifest) selected.add(name)
  const files = new Map()
  for (const [host, packages] of catalog.hosts)
    for (const name of [...selected].sort()) {
      const pkg = packages.get(name)
      if (!pkg) continue
      for (const file of pkg.files) {
        const key = name + '\0' + file.path + '\0' + file.sha256 + '\0' + JSON.stringify(file.slice ?? null)
        if (!files.has(key))
          files.set(key, {
            name,
            path: file.path,
            sha256: file.sha256,
            bytes: file.bytes,
            ...(file.slice ? { slice: file.slice } : {}),
            license: pkg.license,
            hosts: [],
            text: file.text
          })
        files.get(key).hosts.push({ version: pkg.version, tarball: pkg.tarball, integrity: pkg.integrity })
      }
    }
  return {
    packages: [...selected].sort(),
    files: [...files.values()],
    unprojectedModules: [...unprojectedModules].sort(),
    unprojectedServices: [...unprojectedServices].sort()
  }
}

/** Host services a plugin source requests (`ctx.inject([...])`) or dereferences (`ctx.<name>`). */
export function reviewHostServices(text, known) {
  const services = new Set()
  for (const match of text.matchAll(/\binject\(\s*\[([^\]]{0,500})\]/g))
    for (const item of match[1].matchAll(/['"`]([A-Za-z][\w]*)['"`]/g)) services.add(item[1])
  for (const match of text.matchAll(/\b(?:ctx|host|hostCtx|\w+Ctx)\??\.([A-Za-z]\w*)\b/g))
    if (known.has(match[1])) services.add(match[1])
  return [...services].sort()
}

/** Collect only immutable Git blobs, including before/base contracts when they differ from head. */
export async function collectReviewContext(request, reader, limits = {}, contracts = [], options = {}) {
  const maxPaths = limits.maxPaths ?? 256,
    maxBytes = limits.maxBytes ?? 3000000,
    maxTreeEntries = limits.maxTreeEntries ?? 20000
  for (const [value, maximum] of [
    [maxPaths, 1024],
    [maxBytes, 16000000],
    [maxTreeEntries, 50000]
  ])
    if (!Number.isSafeInteger(value) || value < 1 || value > maximum)
      throw new Error('Invalid bounded review context limits')
  const roles = [
    ['head', sha(request.head)],
    ['base', sha(request.base)],
    ['mergeBase', sha(request.mergeBase)]
  ]
  const trees = new Map(),
    cached = new Map(),
    paths = new Set(),
    contextPaths = new Set(),
    reasons = new Map(),
    external = new Map(),
    dynamic = [],
    secretFindings = [],
    maskedFindings = new Set()
  let bytesRead = 0
  for (const [, ref] of roles)
    if (!trees.has(ref)) {
      const entries = await reader.list(ref)
      if (entries.length > maxTreeEntries) throw new Error('Review source inventory exceeds entry limit')
      const tree = new Map(entries.map((entry) => [entry.path, entry]))
      if (tree.size !== entries.length) throw new Error('Duplicate Git source paths')
      trees.set(ref, tree)
    }
  const read = async (ref, path) => {
    reviewSourcePath(path)
    const entry = trees.get(ref).get(path)
    if (!entry) return null
    if (!['100644', '100755'].includes(entry.mode) || entry.type !== 'blob')
      throw new Error(`Review source is not a regular Git blob: ${path}`)
    if (!Number.isSafeInteger(entry.size) || entry.size < 0) throw new Error(`Invalid Git blob size: ${path}`)
    paths.add(path)
    if (paths.size > maxPaths) throw new Error('Review dependency closure exceeds file limit')
    if (!cached.has(entry.oid)) {
      if (bytesRead + entry.size > maxBytes) throw new Error(`Review source exceeds byte budget at ${path}`)
      const bytes = await reader.read(ref, path)
      if (bytes.length !== entry.size) throw new Error(`Git source size changed: ${path}`)
      const text = decodeSource(bytes, path)
      // Every repository blob that could reach the model is scanned first; only locations are kept.
      const findings = options.scan ? options.scan(path, text) : []
      cached.set(entry.oid, { text, findings })
      bytesRead += bytes.length
    }
    const blob = cached.get(entry.oid)
    // `source` is the exact blob and is only parsed locally (imports, policy JSON); `text` is what
    // may reach the model. They differ only for masked already-merged content.
    if (!blob.findings.length) return { ...entry, source: blob.text, text: blob.text }
    // Candidate (head) content with a finding blocks the review. Content that exists only on
    // the already-merged side is masked character-for-character, so it never reaches the model.
    if (ref === request.head || !options.mask) {
      if (!blob.reported) {
        blob.reported = true
        for (const finding of blob.findings)
          secretFindings.push({ path, line: finding.line, rule: finding.rule })
      }
      return { ...entry, source: blob.text, text: blob.text }
    }
    blob.masked ??= options.mask(blob.text)
    maskedFindings.add(path)
    return { ...entry, source: blob.text, text: blob.masked, masked: true }
  }
  const queue = [],
    queued = new Set()
  // Leaf contracts (graph consumers) are printed but their own imports are not followed: they
  // show how the change is used. Traversed sources supply their complete producer closure.
  const leaves = new Set()
  const add = (ref, path, reason, required = true, context = true, traverse = true) => {
    reviewSourcePath(path)
    if (!trees.get(ref).has(path)) {
      if (required) throw new Error(`Required review source is absent at ${ref}: ${path}`)
      return
    }
    if (context) contextPaths.add(path)
    if (!reasons.has(path)) reasons.set(path, new Set())
    reasons.get(path).add(reason)
    for (const snapshot of context ? trees.keys() : [ref]) {
      if (!trees.get(snapshot).has(path)) continue
      const key = snapshot + ':' + path
      if (!queued.has(key)) {
        queued.add(key)
        if (!traverse) leaves.add(key)
        queue.push({ ref: snapshot, path })
      } else if (traverse && leaves.delete(key)) {
        // A leaf later required as a producer is scanned for its dependencies after all.
        queue.push({ ref: snapshot, path })
      }
    }
  }
  const common = [
    'README.md',
    'CONTRIBUTING.md',
    'docs/ROADMAP.md',
    'docs/PLUGINS.md',
    'docs/STATUS.md',
    'package.json',
    'config/products.json',
    'config/plugins.json'
  ]
  const governance = request.names.some((path) =>
    /^(?:scripts\/(?:review|release)-|docs\/github\/|\.github\/workflows\/)/.test(path)
  )
  const release = request.names.some((path) =>
    /^(?:scripts\/release-|test\/release-|docs\/RELEASING\.md$|docs\/github\/review-policy\.json$)/.test(path)
  )
  const support = governance
    ? ['scripts/review-install.mjs', 'docs/github/review-policy.json', '.github/workflows/review-request.yml']
    : []
  // Release consumers come from the dependency graph (updater clients and release-feed readers),
  // never from a fixed list of shell files that may be renamed or removed.
  const consumers = release
    ? releaseConsumers(options.graph ?? (await buildReviewGraph(reader, [request.head], limits)))
    : []
  for (const [, ref] of roles) {
    for (const path of request.names) add(ref, path, 'changed source dependency root', false, false)
    for (const path of common) add(ref, path, 'project contract', false)
    for (const path of support) add(ref, path, 'review policy and installation contract', false)
    for (const path of consumers) add(ref, path, 'release updater consumer contract', false)
    for (const contract of contracts)
      typeof contract === 'string'
        ? add(ref, contract, 'producer and consumer contract', false)
        : add(
            ref,
            contract.path,
            contract.reason ?? 'producer and consumer contract',
            false,
            true,
            contract.traverse !== false
          )
  }
  // Changed roots already provide merge-base/head text in their change records. A divergent
  // requested base is a separate integration contract and must not remain a read-only hidden blob.
  if (request.base !== request.mergeBase)
    for (const path of request.names) add(request.base, path, 'requested-base changed-root contract', false)
  const resolveDependency = (ref, from, dependency) => {
    const found = resolveLocalDependency((path) => trees.get(ref).has(path), from, dependency)
    if (!found)
      throw new Error(
        `Unresolved local dependency ${JSON.stringify(dependency.specifier)} from ${from} at ${ref}`
      )
    return found
  }
  for (let index = 0; index < queue.length; index++) {
    const { ref, path } = queue[index],
      entry = await read(ref, path)
    if (/\.[cm]?[jt]sx?$/.test(path) && !leaves.has(ref + ':' + path)) {
      const references = reviewModuleReferences(entry.source, { jsx: /\.[jt]sx$/.test(path), filename: path })
      // Strings parsed from the exact blob that are printed for the model (external specifiers,
      // computed-reference prefixes) are masked when the blob itself is masked.
      const shown = (value) => (entry.masked && options.mask ? options.mask(value) : value)
      for (const dependency of references.literals) {
        const specifier = dependency.specifier
        if (dependency.repositoryRelative || specifier.startsWith('.')) {
          // Candidate code may not depend on a generated or private tree (runtime/, node_modules/,
          // dist/ ...): that still fails. Already-merged code on the base side can (e.g. a deleted
          // legacy script); such a target is never in Git, so it is listed as an unverified external.
          const target = dependency.repositoryRelative
            ? specifier
            : posix.normalize(posix.join(posix.dirname(path), specifier))
          if (ref !== request.head && !target.startsWith('../') && generatedTree(target))
            external.set(shown(target), true)
          else add(ref, resolveDependency(ref, path, dependency), `local dependency of ${path}`)
        } else if (specifier.startsWith('/') || /^[a-z]:[\\/]/i.test(specifier))
          throw new Error(`Absolute dependency is outside the Git snapshot: ${path}`)
        else if (!isBuiltin(specifier)) external.set(shown(specifier), true)
      }
      for (const item of references.dynamic)
        dynamic.push({
          ref,
          path,
          line: entry.source.slice(0, item.at).split('\n').length,
          kind: item.kind,
          ...(item.incompleteLiteralPrefix
            ? { incompleteLiteralPrefix: shown(item.incompleteLiteralPrefix) }
            : {})
        })
    }
    if (path === 'docs/github/review-policy.json') {
      let policy
      try {
        policy = JSON.parse(entry.source)
      } catch {
        throw new Error(`Review policy is not valid JSON at ${ref}`)
      }
      for (const kind of ['trustedQuality', 'trustedBuild']) {
        const controller = policy[kind]
        if (controller?.path) add(ref, controller.path, `${path} ${kind}.path`)
        if (controller?.files && (typeof controller.files !== 'object' || Array.isArray(controller.files)))
          throw new Error('Invalid policy source inventory')
        for (const file of Object.keys(controller?.files ?? {})) add(ref, file, `${path} ${kind}.files`)
      }
    }
  }
  const context = [],
    identities = [],
    projections = []
  if (governance) {
    for (const [role, ref] of roles) {
      const lock = await read(ref, 'package-lock.json')
      if (!lock) continue
      let value
      try {
        value = JSON.parse(lock.source)
      } catch {
        throw new Error(`Invalid parser lockfile source at ${ref}`)
      }
      const projection = {
        path: 'package-lock.json',
        oid: lock.oid,
        role,
        ref,
        sha256: sha256(lock.source),
        purpose:
          'Exact parser provenance JSON pointers, not a truncated source file. Full lockfile changes remain in the changed-file records.',
        pointers: {
          '/packages//devDependencies/@babel~1parser':
            value.packages?.['']?.devDependencies?.['@babel/parser'] ?? null,
          '/packages/node_modules~1@babel~1parser': value.packages?.['node_modules/@babel/parser'] ?? null
        }
      }
      projections.push(projection)
      context.push(`CONTEXT JSON PROJECTION ${JSON.stringify(projection)}`)
    }
  }
  for (const path of [...contextPaths].sort()) {
    const variants = new Map()
    for (const [role, ref] of roles) {
      const entry = await read(ref, path)
      if (!entry) continue
      if (!variants.has(entry.oid)) variants.set(entry.oid, { entry, roles: [] })
      variants.get(entry.oid).roles.push({ role, ref })
    }
    for (const { entry, roles: at } of variants.values()) {
      const identity = {
        path,
        oid: entry.oid,
        roles: at,
        // sha256 always describes the exact Git blob; masked text is labelled, not re-hashed.
        sha256: sha256(entry.source),
        ...(entry.masked ? { masked: true } : {}),
        reasons: [...reasons.get(path)]
      }
      identities.push(identity)
      context.push(
        `CONTEXT SOURCE ${JSON.stringify(identity)}\n${entry.text}\nEND CONTEXT SOURCE ${JSON.stringify(path)}`
      )
    }
  }
  const files = []
  for (const path of request.names) {
    const before = await read(request.mergeBase, path),
      after = await read(request.head, path)
    const file = { path, before: before?.text ?? '', after: after?.text ?? '', binary: false }
    // A mode-only change (e.g. gaining the executable bit) has identical text; show it explicitly.
    if (before && after && before.mode !== after.mode) file.mode = [before.mode, after.mode]
    files.push(file)
  }
  // Upstream host contracts: selected from the external modules, host services and plugin
  // manifests that this group actually references; bytes come only from the trusted worker catalog.
  const upstream = [],
    projectedPackages = new Set()
  let unprojectedServices = [],
    upstreamHosts = []
  if (options.upstream) {
    const catalog = options.upstream,
      known = new Set(Object.keys(catalog.services)),
      services = new Set()
    for (const file of files)
      if (SOURCE_FILE.test(file.path))
        for (const text of [file.before, file.after])
          for (const service of reviewHostServices(text, known)) services.add(service)
    const selection = selectUpstreamContracts(catalog, {
      modules: [...external.keys()],
      services: [...services],
      manifest: request.names.some((path) =>
        /^packages\/[^/]+\/(?:package\.json|cordis\.patch\.ya?ml)$/.test(path)
      )
    })
    for (const name of selection.packages) projectedPackages.add(name)
    unprojectedServices = selection.unprojectedServices
    upstreamHosts = [...catalog.hosts.keys()]
    for (const file of selection.files) {
      const identity = {
        package: file.name,
        path: file.path,
        sha256: file.sha256,
        bytes: file.bytes,
        license: file.license,
        hosts: file.hosts,
        ...(file.slice ? { slice: file.slice } : {})
      }
      upstream.push(identity)
      context.push(
        `CONTEXT UPSTREAM ${JSON.stringify(identity)}\n${file.text}\nEND CONTEXT UPSTREAM ${JSON.stringify(file.name + '/' + file.path)}`
      )
    }
  }
  const unprojected = [...external.keys()]
    .filter((specifier) => !projectedPackages.has(/^(@[^/]+\/[^/]+)/.exec(specifier)?.[1]))
    .sort()
  const upstreamHeader = options.upstream
    ? `Upstream DSH contracts (CONTEXT UPSTREAM; trusted worker lock ${options.upstream.lockDigest}; tarball SRI and full-file sha256 verified by the worker for hosts ${JSON.stringify(upstreamHosts)}): ${JSON.stringify([...projectedPackages].sort())}\nHost services referenced without an upstream projection: ${JSON.stringify(unprojectedServices)}\n`
    : 'Upstream DSH contracts: none supplied to this snapshot.\n'
  const baseRoots =
    request.base === request.mergeBase
      ? []
      : request.names.map((path) => ({
          path,
          role: 'base',
          ref: request.base,
          oid: trees.get(request.base).get(path)?.oid ?? null
        }))
  const maskedNote = maskedFindings.size
    ? `Masked already-merged sources: ${JSON.stringify([...maskedFindings].sort())}. In these files only, runs of * replace secret-shaped values or personal path segments that already exist on the merged side; length and syntax are unchanged. Treat each run as an opaque placeholder, not as a code defect. Candidate (head) content is never masked: a finding there blocks the review before any model call.\n`
    : ''
  const header = `Repository: ${request.repository}\nBase: ${request.base}\nMerge base: ${request.mergeBase}\nHead: ${request.head}\nGroup change inventory (not per-batch scope): ${JSON.stringify(request.names)}\nRequested-base changed roots (null oid means absent): ${JSON.stringify(baseRoots)}\n${maskedNote}Context contract: selected source sections are complete immutable Git blobs except the masked sources listed above. Any JSON-pointer projection is explicitly labelled; all batches together supply the complete changed files; this batch supplies only its explicit ranges. Source roles are explicit; identical blobs are printed once. External packages and computed references are not silently treated as reviewed implementations.\n${upstreamHeader}External module references without upstream projection (use package.json versions; external code is not supplied): ${JSON.stringify(unprojected)}\nComputed module references (assess whether their targets need additional context): ${JSON.stringify(dynamic)}\n`
  const text = header + context.join('\n\n')
  return {
    files,
    context: text,
    identities,
    projections,
    upstream,
    secretFindings,
    // Paths whose already-merged content was masked before model input (locations only).
    maskedPaths: [...maskedFindings].sort(),
    metrics: {
      paths: paths.size,
      blobs: cached.size,
      bytesRead,
      contextChars: text.length,
      externalReferences: external.size,
      upstreamFiles: upstream.length,
      computedReferences: dynamic.length
    }
  }
}
/**
 * Group changed files by the dependency graph: each group is a component (plugin package, runtime,
 * governance) that executes or consumes the change, with its unchanged direct producers and
 * consumers as context. A group whose complete context exceeds the budget is split along its
 * dependency closure; context is never truncated.
 */
/**
 * Default characters per model batch. DeepSeek Flash accepts 1M tokens; 900k characters of mostly
 * ASCII source stays well inside it and keeps producer/consumer closures in one batch.
 */
export const REVIEW_BATCH_CHARS = 900000
export async function collectGroupedReview(
  request,
  reader,
  limits = {},
  maxChars = REVIEW_BATCH_CHARS,
  options = {}
) {
  if (new Set(request.names).size !== request.names.length) throw new Error('Duplicate changed paths')
  for (const path of request.names) reviewSourcePath(path)
  if (!request.names.length) throw new Error('No reviewable changes')
  const graph = options.graph ?? (await buildReviewGraph(reader, [request.head, request.mergeBase], limits))
  graph.changedScripts ??= changedScriptTargets(graph, request.mergeBase, request.head)
  const groups = new Map()
  for (const path of request.names)
    for (const group of reviewOwners(graph, path)) {
      if (!groups.has(group)) groups.set(group, [])
      groups.get(group).push(path)
    }
  const snapshots = [],
    files = new Map(),
    batches = []
  const collect = async (group, names) => {
    // Producers (what the change calls) keep their full import closure; consumers (what calls the
    // change) are supplied as complete files without pulling in their unrelated dependencies.
    const changed = new Set(names)
    // Only code the change executes is a producer; shared artifact names and mentions are peers.
    const producer = (path) =>
      names.some((name) =>
        [...(graph.forward.get(name)?.get(path) ?? [])].some((kind) => EXECUTABLE_EDGES.has(kind))
      )
    const contracts = reviewContracts(graph, group, names).map((path) => ({
      path,
      reason: producer(path)
        ? 'direct producer in the dependency graph'
        : 'direct consumer in the dependency graph',
      traverse: producer(path) || changed.has(path)
    }))
    const snapshot = await collectReviewContext({ ...request, names }, reader, limits, contracts, {
      ...options,
      graph
    })
    const context =
      `Review contract group: ${group}\nAll changed paths in this request: ${JSON.stringify(request.names)}\nThis group inventory is for navigation, not per-batch approval scope. Do not assume another batch approved a missing dependency.\n` +
      snapshot.context
    return { snapshot, context }
  }
  // Connected components of the changed files inside one group, over direct graph edges.
  const components = (names) => {
    const set = new Set(names),
      seen = new Set(),
      parts = []
    for (const start of names) {
      if (seen.has(start)) continue
      const part = [],
        queue = [start]
      seen.add(start)
      while (queue.length) {
        const current = queue.shift()
        part.push(current)
        for (const map of [graph.forward.get(current), graph.reverse.get(current)])
          for (const [next] of map ?? EMPTY)
            if (set.has(next) && !seen.has(next)) {
              seen.add(next)
              queue.push(next)
            }
      }
      parts.push(names.filter((path) => part.includes(path)))
    }
    return parts
  }
  const plan = async (group, names, depth = 0) => {
    const attempt = await collect(group, names)
    try {
      // Admission is decided by the real batch splitter, so the threshold is exact.
      splitBatches(attempt.snapshot.files, attempt.context, maxChars)
      return [{ group, names, ...attempt }]
    } catch (error) {
      if (!/budget/.test(String(error?.message))) throw error
    }
    const parts = components(names)
    const split =
      parts.length > 1
        ? parts
        : names.length > 1
          ? [names.slice(0, Math.ceil(names.length / 2)), names.slice(Math.ceil(names.length / 2))]
          : null
    if (!split || depth > 12)
      throw new Error(
        `Review context exceeds batch budget for group ${group}: ${JSON.stringify(names.slice(0, 5))} needs ${attempt.context.length} context characters`
      )
    const result = []
    for (const part of split) result.push(...(await plan(group, part, depth + 1)))
    return result
  }
  for (const [group, names] of groups) {
    const planned = await plan(group, names)
    planned.forEach((item, index) => {
      const id = planned.length > 1 ? `${group}.${index + 1}` : group
      for (const file of item.snapshot.files) {
        const previous = files.get(file.path)
        if (previous && canonical(previous) !== canonical(file))
          throw new Error('Changed source differs between groups')
        files.set(file.path, file)
      }
      batches.push(
        ...splitBatches(item.snapshot.files, item.context, maxChars).map((batch) => ({
          ...batch,
          id: `${id}-${batch.id}`,
          group
        }))
      )
      snapshots.push({ ...item.snapshot, group: id, context: item.context })
    })
  }
  if (files.size !== request.names.length || request.names.some((path) => !files.has(path)))
    throw new Error('Review groups do not cover every changed file')
  const collected = snapshots.flatMap((snapshot) => snapshot.secretFindings)
  // Final gate over the exact model input: any secret-shaped text that reached a batch through
  // any path (source text, header fields, projections) blocks the review before a model call.
  // It only adds findings when no source finding already blocks, so reported locations stay exact.
  if (options.scan && !collected.length)
    for (const batch of batches)
      for (const finding of options.scan(`<batch ${batch.id}>`, batch.text))
        collected.push({ path: `<batch ${batch.id}>`, line: finding.line, rule: finding.rule })
  const secretFindings = [...new Map(collected.map((finding) => [canonical(finding), finding])).values()]
  return {
    files: request.names.map((path) => files.get(path)),
    batches,
    context: snapshots.map((snapshot) => snapshot.context).join('\n\n'),
    identities: snapshots.flatMap((snapshot) =>
      snapshot.identities.map((identity) => ({ ...identity, group: snapshot.group }))
    ),
    projections: snapshots.flatMap((snapshot) =>
      snapshot.projections.map((projection) => ({ ...projection, group: snapshot.group }))
    ),
    upstream: snapshots.flatMap((snapshot) =>
      snapshot.upstream.map((identity) => ({ ...identity, group: snapshot.group }))
    ),
    secretFindings,
    maskedPaths: [...new Set(snapshots.flatMap((snapshot) => snapshot.maskedPaths ?? []))].sort(),
    // Source files whose dependency edges could not be read: their consumers are unknown.
    graphBlockers: [...new Map(graph.unparsed.map((u) => [u.path, u])).values()]
      .sort((a, b) => a.path.localeCompare(b.path))
      .map(
        (u) =>
          `Dependency graph could not parse ${JSON.stringify(u.path)}; its consumers cannot be placed in review context`
      ),
    metrics: {
      groups: snapshots.length,
      contextChars: snapshots.reduce((sum, s) => sum + s.context.length, 0),
      graphUnresolved: graph.unresolved.length,
      groupMetrics: snapshots.map((snapshot) => ({
        group: snapshot.group,
        changed: snapshot.files.length,
        ...snapshot.metrics
      }))
    }
  }
}
/** Complete source ranges are retained; Unicode pairs are never broken between model inputs. */
export function splitBatches(files, context, maxChars = 90000) {
  if (
    !Number.isSafeInteger(maxChars) ||
    maxChars < 4000 ||
    typeof context !== 'string' ||
    context.length >= maxChars
  )
    throw new Error('Review context exceeds batch budget')
  const endAt = (text, start, size) => {
    let end = Math.min(text.length, start + size)
    if (
      end < text.length &&
      end > start &&
      /[\uD800-\uDBFF]/.test(text[end - 1]) &&
      /[\uDC00-\uDFFF]/.test(text[end])
    )
      end++
    return end
  }
  const render = (chunks) =>
    context +
    '\n\n' +
    chunks.map((chunk) => chunk.text).join('\n\n') +
    '\n\nBATCH REVIEW SCOPE (UTF-16 offsets, end exclusive): ' +
    JSON.stringify(chunks.map((chunk) => chunk.scope))
  const chunks = []
  for (const file of files) {
    if (file.binary) throw new Error(`Binary change requires a separate verified review: ${file.path}`)
    const before = file.before ?? '',
      after = file.after ?? ''
    if (before.includes('\0') || after.includes('\0'))
      throw new Error(`Binary change requires a separate verified review: ${file.path}`)
    let b = 0,
      a = 0,
      first = true
    while (first || b < before.length || a < after.length) {
      first = false
      let size = Math.max(
        1,
        Math.floor((maxChars - context.length - JSON.stringify(file.path).length * 2 - 512) / 2)
      )
      const make = () => {
        const be = endAt(before, b, size),
          ae = endAt(after, a, size)
        return {
          scope: { path: file.path, before: [b, be, before.length], after: [a, ae, after.length] },
          text: `FILE ${JSON.stringify(file.path)}\n${file.mode ? `MODE CHANGE ${file.mode[0]} -> ${file.mode[1]}\n` : ''}BEFORE chars ${b}-${be}/${before.length}\n${before.slice(b, be)}\nAFTER chars ${a}-${ae}/${after.length}\n${after.slice(a, ae)}`
        }
      }
      let chunk = make()
      while (render([chunk]).length > maxChars && size > 1) {
        size = Math.floor(size / 2)
        chunk = make()
      }
      if (render([chunk]).length > maxChars)
        throw new Error('Review context leaves no complete change chunk within batch budget')
      chunks.push(chunk)
      b = chunk.scope.before[1]
      a = chunk.scope.after[1]
    }
  }
  if (!chunks.length) throw new Error('No reviewable changes')
  const batches = []
  let pending = []
  const emit = () => {
    const text = render(pending)
    if (text.length > maxChars) throw new Error('Review batch exceeds its complete output budget')
    batches.push({
      id: `batch-${batches.length + 1}-${sha256(text).slice(0, 12)}`,
      text,
      scope: pending.map((chunk) => chunk.scope)
    })
    pending = []
  }
  for (const chunk of chunks) {
    if (pending.length && render([...pending, chunk]).length > maxChars) emit()
    pending.push(chunk)
  }
  if (pending.length) emit()
  return batches
}
