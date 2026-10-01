import { createHash, createPrivateKey, createPublicKey, sign, verify } from 'node:crypto'
import { inflateRawSync } from 'node:zlib'
import { posix } from 'node:path'
import { isBuiltin } from 'node:module'
import { parseReviewSource } from './review-parser.mjs'
import { FORBIDDEN_PATH } from './check-secrets.mjs'
import { changeUnits, DIFF_CONTEXT_LINES, rebuildAfter } from './review-diff.mjs'

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
    summary: { type: 'string', maxLength: 4000, description: 'At most 4000 characters.' },
    blockers: { type: 'array', items: { type: 'string', maxLength: 2000 } },
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
          title: { type: 'string', maxLength: 4000 },
          detail: { type: 'string', maxLength: 4000 }
        }
      }
    }
  }
}
/** Longest summary and finding title/detail kept in a signed review result; blockers keep 2000. */
export const REVIEW_TEXT_LIMIT = 4000
export const REVIEW_BLOCKER_LIMIT = 2000
const clip = (value, limit = REVIEW_TEXT_LIMIT) => {
  if (typeof value !== 'string' || value.length <= limit) return value
  let end = limit - 24
  // Never keep half of a surrogate pair.
  if (end > 0 && value.charCodeAt(end - 1) >= 0xd800 && value.charCodeAt(end - 1) <= 0xdbff) end--
  return value.slice(0, end) + ' […truncated by worker]'
}
/**
 * Bound the free-text fields of a model answer before validation. The verdict is derived from
 * findings and blockers, never from their text, so shortening prose cannot turn a failing answer
 * into a pass; identity fields, counts and types are left for validateResult to check exactly.
 */
export function normalizeResult(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value
  return {
    ...value,
    summary: clip(value.summary),
    blockers: Array.isArray(value.blockers)
      ? value.blockers.map((blocker) => clip(blocker, REVIEW_BLOCKER_LIMIT))
      : value.blockers,
    findings: Array.isArray(value.findings)
      ? value.findings.map((finding) =>
          finding && typeof finding === 'object'
            ? { ...finding, title: clip(finding.title), detail: clip(finding.detail) }
            : finding
        )
      : value.findings
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
    value.summary.length > REVIEW_TEXT_LIMIT ||
    !Array.isArray(value.findings) ||
    value.findings.length > 100 ||
    !Array.isArray(value.blockers) ||
    !value.blockers.every((v) => typeof v === 'string' && v.length <= REVIEW_BLOCKER_LIMIT)
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
        (k) =>
          typeof finding[k] === 'string' && finding[k].length > 0 && finding[k].length <= REVIEW_TEXT_LIMIT
      )
    )
      throw new Error('Invalid finding')
  }
  return value
}
export const PROOF_TITLE_LIMIT = 160,
  PROOF_P3_LIMIT = 40
/** Keep at most `limit` UTF-8 bytes, never splitting a character. */
function clipBytes(value, limit) {
  if (typeof value !== 'string') return value
  // Characters JSON escapes to six bytes are replaced, so the encoded size stays near `limit`.
  value = value.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029"\\]/g, ' ')
  if (Buffer.byteLength(value) <= limit) return value
  let out = ''
  for (const char of value) {
    if (Buffer.byteLength(out + char) > limit - 3) break
    out += char
  }
  return out + '…'
}
/** A finding as carried in the signed proof: bounded bytes, plus a digest of its (clipped) text. */
export function compactFinding(finding) {
  return {
    priority: finding.priority,
    path: clipBytes(finding.path, PROOF_TITLE_LIMIT),
    line: finding.line,
    title: clipBytes(finding.title, PROOF_TITLE_LIMIT),
    digest: sha256(canonical({ title: finding.title, detail: finding.detail }))
  }
}
export function aggregate(request, batches, results) {
  if (!batches.length || results.length !== batches.length) throw new Error('Incomplete review coverage')
  const verified = results.map((r, i) => validateResult(r, request, batches[i].id))
  // The signed proof travels in a bounded workflow input, so each finding is a bounded summary
  // (priority, location, short title, digest of the clipped title and detail). Every P0-P2 finding is
  // kept; P3 findings beyond PROOF_P3_LIMIT are counted, not listed. The full text is only in the
  // local trace; verification reads the priorities, which compaction never drops.
  const all = verified.flatMap((r) => r.findings).map(compactFinding)
  const serious = all.filter((f) => f.priority <= 2),
    minor = all.filter((f) => f.priority > 2)
  const findings = [...serious, ...minor.slice(0, PROOF_P3_LIMIT)]
  const omittedFindings = minor.length - Math.min(minor.length, PROOF_P3_LIMIT)
  const blockers = verified.flatMap((r) => r.blockers)
  return {
    verdict:
      verified.every((r) => r.verdict === 'pass') &&
      !blockers.length &&
      !findings.some((f) => f.priority <= 2)
        ? 'pass'
        : 'fail',
    findings,
    ...(omittedFindings ? { omittedFindings } : {}),
    blockers,
    // digest binds the exact batch input; evidence binds its sub-batches, rounds and tool calls.
    batches: batches.map((b, i) => ({
      id: b.id,
      digest: sha256(b.text),
      ...(typeof results[i].evidence === 'string' ? { evidence: results[i].evidence } : {})
    }))
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
    !payload.batches.every(
      (b) =>
        typeof b.id === 'string' &&
        /^[a-f0-9]{64}$/.test(b.digest) &&
        // The signature binds the pinned worker digest, and that worker always writes evidence for
        // model-reviewed batches; a present value must be a digest.
        (b.evidence === undefined || /^[a-f0-9]{64}$/.test(b.evidence))
    ) ||
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
    // Control characters (including NUL, CR and LF) never belong in a reviewed path; a newline in a
    // name could otherwise forge lines inside the worker-trusted batch header.
    /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/.test(path) ||
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
    /(?:^|\/)(?:\.?credentials(?:\.|$)|\.env(?:\.|$))|\.(?:pem|key|p12|pfx)$/i.test(path) ||
    // The same forbidden-path rule as the pre-push secret scan (.npmrc, .netrc, SSH keys, keystores).
    FORBIDDEN_PATH.test(path)
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
    // Repository-looking paths a source names that do not exist in its snapshot (per ref).
    missing = [],
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
          const target = posix.normalize(
            posix.join(
              posix.dirname(path),
              (() => {
                try {
                  return decodeURI(match[1])
                } catch {
                  return match[1]
                }
              })()
            )
          )
          if (safePath(target) && has(target)) edge(path, target, 'doc')
          else if (safePath(target) && missing.length < 100000) missing.push({ ref, from: path, target })
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
          else {
            unresolved.push({ ref, path, specifier })
            const joined = dependency.repositoryRelative
              ? specifier
              : posix.normalize(posix.join(posix.dirname(path), specifier))
            if (safePath(joined)) missing.push({ ref, from: path, target: joined })
          }
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
        else if (
          value.includes('/') &&
          safePath(value) &&
          /\.[a-z0-9]{1,6}$/i.test(value) &&
          missing.length < 100000
        )
          missing.push({ ref, from: path, target: value })
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
  return {
    forward,
    reverse,
    paths,
    externals,
    releaseReaders,
    manifests,
    unresolved,
    unparsed,
    scripts,
    missing
  }
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

/** Default characters per model batch (~80k tokens of diff): the model reads further context with tools. */
export const REVIEW_BATCH_CHARS = 240000
/** Trusted header size caps: related-path hints and the changed-directory repository map. */
export const REVIEW_HINT_PATHS = 300
export const REVIEW_MAP_CHARS = 12000
export const TRUSTED_HEADER_END = 'END OF TRUSTED WORKER HEADER'
export const SCOPE_MARKER = '\n\nBATCH REVIEW SCOPE (unit body UTF-16 offsets, end exclusive): '
const unitCache = new WeakMap()
/** Review units of a change record, computed once per record. */
export function reviewUnits(file) {
  if (!unitCache.has(file)) unitCache.set(file, changeUnits(file))
  return unitCache.get(file)
}
const fileIdentity = (file) =>
  canonical({
    path: file.path,
    status: file.status ?? null,
    before: sha256(file.before ?? ''),
    after: sha256(file.after ?? ''),
    mode: file.mode ?? null
  })

/**
 * Change records for one group: exact merge-base/head blobs of each changed path (never
 * dependency or consumer bodies). Every read blob is scanned; candidate findings block and
 * already-merged findings are masked. Local dependencies of changed sources must resolve inside
 * the same snapshot, and policy-declared files must exist; both are listed as path hints only.
 */
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
    hints = new Map(),
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
    if (paths.size > maxPaths) throw new Error('Review change set exceeds file limit')
    if (!cached.has(entry.oid)) {
      if (bytesRead + entry.size > maxBytes) throw new Error(`Review source exceeds byte budget at ${path}`)
      const bytes = await reader.read(ref, path)
      if (bytes.length !== entry.size) throw new Error(`Git source size changed: ${path}`)
      const text = decodeSource(bytes, path)
      // Every repository blob that reaches the model is scanned first; only locations are kept.
      const findings = options.scan ? options.scan(path, text) : []
      cached.set(entry.oid, { text, findings })
      bytesRead += bytes.length
    }
    const blob = cached.get(entry.oid)
    // `source` is the exact blob, parsed locally only; `text` is what may reach the model.
    if (!blob.findings.length) return { ...entry, source: blob.text, text: blob.text }
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
  const hint = (path, reason) => {
    if (request.names.includes(path)) return
    if (!hints.has(path)) hints.set(path, new Set())
    hints.get(path).add(reason)
  }
  const files = []
  for (const path of request.names) {
    reviewSourcePath(path)
    const before = await read(request.mergeBase, path),
      after = await read(request.head, path)
    if (!before && !after) throw new Error(`Changed path is absent from both snapshots: ${path}`)
    const file = {
      path,
      status: before && after ? 'modified' : after ? 'added' : 'deleted',
      before: before?.text ?? '',
      after: after?.text ?? '',
      binary: false,
      beforeOid: before?.oid ?? null,
      afterOid: after?.oid ?? null,
      beforeBytes: before?.size ?? 0,
      afterBytes: after?.size ?? 0,
      oldMode: before?.mode ?? null,
      newMode: after?.mode ?? null
    }
    // A mode-only change (e.g. gaining the executable bit) has identical text; show it explicitly.
    if (before && after && before.mode !== after.mode) file.mode = [before.mode, after.mode]
    files.push(file)
    // Candidate and merged sources must name dependencies that exist in their own snapshot.
    if (!SOURCE_FILE.test(path)) continue
    for (const [ref, entry] of [
      [request.mergeBase, before],
      [request.head, after]
    ]) {
      if (!entry) continue
      const references = reviewModuleReferences(entry.source, { jsx: /\.[jt]sx$/.test(path), filename: path })
      const shown = (value) => (entry.masked && options.mask ? options.mask(value) : value)
      for (const dependency of references.literals) {
        const specifier = dependency.specifier
        if (dependency.repositoryRelative || specifier.startsWith('.')) {
          // Candidate code may not depend on a generated or private tree; already-merged code
          // (e.g. a deleted legacy script) can, and such a target is listed as external.
          const target = dependency.repositoryRelative
            ? specifier
            : posix.normalize(posix.join(posix.dirname(path), specifier))
          if (ref !== request.head && !target.startsWith('../') && generatedTree(target)) {
            external.set(shown(target), true)
            continue
          }
          const found = resolveLocalDependency((p) => trees.get(ref).has(p), path, dependency)
          if (!found)
            throw new Error(
              `Unresolved local dependency ${JSON.stringify(dependency.specifier)} from ${path} at ${ref}`
            )
          const resolved = trees.get(ref).get(found)
          if (!['100644', '100755'].includes(resolved.mode) || resolved.type !== 'blob')
            throw new Error(`Review source is not a regular Git blob: ${found}`)
          hint(found, `local dependency of ${path}`)
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
  }
  const governance = request.names.some((path) =>
    /^(?:scripts\/(?:review|release)-|docs\/github\/|\.github\/workflows\/)/.test(path)
  )
  const release = request.names.some((path) =>
    /^(?:scripts\/release-|test\/release-|docs\/RELEASING\.md$|docs\/github\/review-policy\.json$)/.test(path)
  )
  for (const path of [
    'README.md',
    'CONTRIBUTING.md',
    'docs/ROADMAP.md',
    'docs/PLUGINS.md',
    'package.json',
    'config/products.json'
  ])
    if (trees.get(request.head).has(path)) hint(path, 'project contract')
  if (governance)
    for (const path of [
      'scripts/review-install.mjs',
      'docs/github/review-policy.json',
      '.github/workflows/review-request.yml'
    ])
      if (trees.get(request.head).has(path)) hint(path, 'review policy and installation contract')
  if (release)
    for (const path of releaseConsumers(
      options.graph ?? (await buildReviewGraph(reader, [request.head], limits))
    ))
      hint(path, 'release updater consumer')
  for (const contract of contracts) {
    const path = typeof contract === 'string' ? contract : contract.path
    reviewSourcePath(path)
    hint(path, (typeof contract === 'string' ? undefined : contract.reason) ?? 'producer or consumer')
  }
  // A changed policy names controller sources: each must exist in the same snapshot.
  if (request.names.includes('docs/github/review-policy.json'))
    for (const [role, ref] of roles) {
      const entry = await read(ref, 'docs/github/review-policy.json')
      if (!entry) continue
      let policy
      try {
        policy = JSON.parse(entry.source)
      } catch {
        throw new Error(`Review policy is not valid JSON at ${ref}`)
      }
      for (const kind of ['trustedQuality', 'trustedBuild']) {
        const controller = policy[kind]
        if (controller?.files && (typeof controller.files !== 'object' || Array.isArray(controller.files)))
          throw new Error('Invalid policy source inventory')
        for (const file of [
          ...(controller?.path ? [controller.path] : []),
          ...Object.keys(controller?.files ?? {})
        ]) {
          reviewSourcePath(file)
          if (!trees.get(ref).has(file))
            throw new Error(`Required review source is absent at ${ref}: ${file}`)
          hint(file, `review-policy.json ${kind} (${role})`)
        }
      }
    }
  const projections = []
  if (governance)
    for (const [role, ref] of roles) {
      const lock = await read(ref, 'package-lock.json')
      if (!lock) continue
      let value
      try {
        value = JSON.parse(lock.source)
      } catch {
        throw new Error(`Invalid parser lockfile source at ${ref}`)
      }
      projections.push({
        path: 'package-lock.json',
        oid: lock.oid,
        role,
        ref,
        sha256: sha256(lock.source),
        purpose: 'Exact parser provenance JSON pointers; read_file returns the complete lockfile.',
        pointers: {
          '/packages//devDependencies/@babel~1parser':
            value.packages?.['']?.devDependencies?.['@babel/parser'] ?? null,
          '/packages/node_modules~1@babel~1parser': value.packages?.['node_modules/@babel/parser'] ?? null
        }
      })
    }
  // Upstream host contracts are not inlined: the header names the locked packages this change
  // references, and read_upstream returns their verified files on demand.
  let upstreamNote = 'Upstream DSH contracts: no trusted catalog is loaded; read_upstream is unavailable.\n'
  const suggested = []
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
    for (const name of selection.packages)
      suggested.push({
        package: name,
        paths: [...new Set(selection.files.filter((f) => f.name === name).map((f) => f.path))]
      })
    upstreamNote = `Upstream DSH contracts (read_upstream; trusted worker lock ${catalog.lockDigest}; tarball SRI and full-file sha256 verified for hosts ${JSON.stringify([...catalog.hosts.keys()])}). Locked packages referenced by this group: ${JSON.stringify(suggested)}\nHost services referenced without a locked contract: ${JSON.stringify(selection.unprojectedServices)}\nUnlocked @deepseek-ai modules: ${JSON.stringify(selection.unprojectedModules)}\n`
  }
  const inventory = files.map((file) => ({
    path: file.path,
    status: file.status,
    ...(file.mode ? { mode: file.mode } : {}),
    mergeBaseOid: file.beforeOid,
    headOid: file.afterOid,
    ...(request.base === request.mergeBase
      ? {}
      : { requestedBaseOid: trees.get(request.base).get(file.path)?.oid ?? null }),
    units: reviewUnits(file).length
  }))
  const repositoryMap = (() => {
    const directories = [...new Set(request.names.map((path) => posix.dirname(path)))].sort()
    const lines = []
    for (const directory of directories) {
      const children = new Map()
      for (const [ref, label] of [
        [request.head, ''],
        [request.mergeBase, ' (merge base only)']
      ])
        for (const path of trees.get(ref).keys()) {
          if (directory !== '.' && !path.startsWith(directory + '/')) continue
          const rest = directory === '.' ? path : path.slice(directory.length + 1),
            slash = rest.indexOf('/'),
            name = slash < 0 ? rest : rest.slice(0, slash) + '/'
          if (
            !safePath(directory === '.' ? name.replace(/\/$/, '') : directory + '/' + name.replace(/\/$/, ''))
          )
            continue
          if (!children.has(name)) children.set(name, label)
        }
      // Names are JSON-encoded: candidate text in the trusted header is always quoted data.
      lines.push(
        `${JSON.stringify(directory === '.' ? '(root)' : directory + '/')}: ${[...children]
          .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
          .map(([name, label]) => JSON.stringify(name) + label)
          .join(', ')}`
      )
    }
    let text = lines.join('\n')
    if (text.length > REVIEW_MAP_CHARS)
      text = text.slice(0, REVIEW_MAP_CHARS) + '\n[repository map truncated; use the list tool]'
    return text
  })()
  // Deleted paths that head sources still name (imports, literal paths, document links).
  const deleted = new Set(files.filter((file) => file.status === 'deleted').map((file) => file.path))
  const stillReferenced = {}
  for (const item of options.graph?.missing ?? [])
    if (item.ref === request.head && deleted.has(item.target)) {
      stillReferenced[item.target] ??= []
      if (!stillReferenced[item.target].includes(item.from) && stillReferenced[item.target].length < 20)
        stillReferenced[item.target].push(item.from)
    }
  for (const referrers of Object.values(stillReferenced)) referrers.sort()
  const hinted = [...hints.keys()].sort()
  const hintText = JSON.stringify(
    Object.fromEntries(hinted.slice(0, REVIEW_HINT_PATHS).map((path) => [path, [...hints.get(path)].sort()]))
  )
  const maskedNote = maskedFindings.size
    ? `Masked already-merged sources: ${JSON.stringify([...maskedFindings].sort())}. In these files only, runs of * replace secret-shaped values or personal path segments that already exist on the merged side; length and syntax are unchanged. Treat each run as an opaque placeholder, not as a code defect. Candidate (head) content is never masked: a finding there blocks the review before any model call.\n`
    : ''
  const header =
    `Repository: ${request.repository}\nBase: ${request.base}\nMerge base: ${request.mergeBase}\nHead: ${request.head}\n` +
    `Reviewer input contract: modified files are unified diff hunks against the merge base (DIFF_CONTEXT_LINES=${DIFF_CONTEXT_LINES} context lines, old/new line numbers, enclosing declaration label); added files are complete numbered text; deleted files are their complete numbered merge-base text marked removed. Nothing else is inlined. Use read_file/search/list on head, base or mergeBase and read_upstream for any other source.\n` +
    `Group change inventory (every unit of these files is reviewed by this group across its batches): ${JSON.stringify(inventory)}\n` +
    maskedNote +
    `Related unchanged paths (dependency graph and policy hints; not supplied, read them when needed)${hinted.length > REVIEW_HINT_PATHS ? ` (first ${REVIEW_HINT_PATHS} of ${hinted.length})` : ''}: ${hintText}\n` +
    (deleted.size
      ? `Deleted paths still named by head sources (verify each reference is intended; empty means none found): ${JSON.stringify(stillReferenced)}\n`
      : '') +
    upstreamNote +
    `External module references (use package.json versions; external code is not supplied): ${JSON.stringify([...external.keys()].sort())}\n` +
    `Computed module references (assess whether their targets need reading): ${JSON.stringify(dynamic)}\n` +
    (projections.length ? `JSON projections: ${JSON.stringify(projections)}\n` : '') +
    `Repository map of changed directories (head; entries only at the merge base are marked):\n${repositoryMap}\n` +
    TRUSTED_HEADER_END +
    '\n'
  return {
    files,
    context: header,
    identities: files.map((file) => ({
      path: file.path,
      status: file.status,
      mergeBaseOid: file.beforeOid,
      headOid: file.afterOid
    })),
    projections,
    upstream: suggested,
    hints: hinted,
    secretFindings,
    maskedPaths: [...maskedFindings].sort(),
    metrics: {
      paths: paths.size,
      blobs: cached.size,
      bytesRead,
      contextChars: header.length,
      hintPaths: hinted.length,
      externalReferences: external.size,
      upstreamPackages: suggested.length,
      computedReferences: dynamic.length
    }
  }
}

/**
 * Group changed files by the dependency graph: each group is a component (plugin package, runtime,
 * governance) that executes or consumes the change. The graph decides grouping and the related-path
 * hints; the model input is the change units of the group's files, split into batches.
 */
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
  // Every changed path with its status, so a batch can tell a deleted path from one still at head.
  const [headPaths, basePaths] = await Promise.all(
    [request.head, request.mergeBase].map(
      async (ref) => new Set((await reader.list(ref)).map((entry) => entry.path))
    )
  )
  const changedStatus = Object.fromEntries(
    request.names.map((path) => [
      path,
      headPaths.has(path)
        ? basePaths.has(path)
          ? 'modified'
          : 'added'
        : basePaths.has(path)
          ? 'deleted'
          : 'absent'
    ])
  )
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
    const producer = (path) =>
      names.some((name) =>
        [...(graph.forward.get(name)?.get(path) ?? [])].some((kind) => EXECUTABLE_EDGES.has(kind))
      )
    const contracts = reviewContracts(graph, group, names).map((path) => ({
      path,
      reason: producer(path)
        ? 'direct producer in the dependency graph'
        : 'direct consumer in the dependency graph'
    }))
    const snapshot = await collectReviewContext({ ...request, names }, reader, limits, contracts, {
      ...options,
      graph
    })
    const context =
      `Review contract group: ${JSON.stringify(group)}\nAll changed paths in this request, with status at head versus the merge base: ${JSON.stringify(changedStatus)}\nThis request inventory is navigation, not per-batch approval scope; other groups review paths outside this group's inventory.\n` +
      snapshot.context
    return { snapshot, context }
  }
  const components = (names) => {
    const set = new Set(names),
      seen = new Set(),
      parts = []
    for (const start of names) {
      if (seen.has(start)) continue
      const part = new Set(),
        queue = [start]
      seen.add(start)
      while (queue.length) {
        const current = queue.shift()
        part.add(current)
        for (const map of [graph.forward.get(current), graph.reverse.get(current)])
          for (const [next] of map ?? EMPTY)
            if (set.has(next) && !seen.has(next)) {
              seen.add(next)
              queue.push(next)
            }
      }
      parts.push(names.filter((path) => part.has(path)))
    }
    return parts
  }
  // Only a trusted header that leaves no room for change units splits a group.
  const plan = async (group, names, depth = 0) => {
    const attempt = await collect(group, names)
    try {
      return [
        { group, names, ...attempt, batches: splitBatches(attempt.snapshot.files, attempt.context, maxChars) }
      ]
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
        `Review context exceeds batch budget for group ${group}: ${JSON.stringify(names.slice(0, 5))} needs ${attempt.context.length} header characters`
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
        if (previous && fileIdentity(previous) !== fileIdentity(file))
          throw new Error('Changed source differs between groups')
        files.set(file.path, file)
      }
      // Every unit of every file of this part is covered by its own batches.
      verifyBatchCoverage(item.snapshot.files, item.batches)
      batches.push(...item.batches.map((batch) => ({ ...batch, id: `${id}-${batch.id}`, group })))
      snapshots.push({ ...item.snapshot, group: id, context: item.context, batchCount: item.batches.length })
    })
  }
  if (files.size !== request.names.length || request.names.some((path) => !files.has(path)))
    throw new Error('Review groups do not cover every changed file')
  const collected = snapshots.flatMap((snapshot) => snapshot.secretFindings)
  // Final gate over the exact model input: any secret-shaped text that reached a batch through
  // any path (units, header fields, repository map) blocks the review before a model call.
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
      snapshot.upstream.map((item) => ({ ...item, group: snapshot.group }))
    ),
    secretFindings,
    maskedPaths: [...new Set(snapshots.flatMap((snapshot) => snapshot.maskedPaths ?? []))].sort(),
    graphBlockers: [...new Map(graph.unparsed.map((u) => [u.path, u])).values()]
      .sort((a, b) => a.path.localeCompare(b.path))
      .map(
        (u) =>
          `Dependency graph could not parse ${JSON.stringify(u.path)}; its consumers cannot be placed in review context`
      ),
    metrics: {
      groups: snapshots.length,
      batches: batches.length,
      batchChars: batches.reduce((sum, batch) => sum + batch.text.length, 0),
      contextChars: snapshots.reduce((sum, s) => sum + s.context.length, 0),
      graphUnresolved: graph.unresolved.length,
      groupMetrics: snapshots.map((snapshot) => ({
        group: snapshot.group,
        changed: snapshot.files.length,
        batches: snapshot.batchCount,
        ...snapshot.metrics
      }))
    }
  }
}

const renderBatch = (context, pieces) =>
  context +
  '\n\n' +
  pieces.map((piece) => piece.text).join('\n\n') +
  SCOPE_MARKER +
  JSON.stringify(pieces.map((piece) => piece.scope))
const bindBatch = (id, context, pieces) => {
  const text = renderBatch(context, pieces)
  return {
    id: `${id}-${sha256(text).slice(0, 12)}`,
    text,
    scope: pieces.map((p) => p.scope),
    context,
    pieces
  }
}
/** Unit bodies are split at line boundaries when possible; UTF-16 pairs are never broken. */
function cut(body, start, size) {
  let end = Math.min(body.length, start + size)
  if (end < body.length) {
    const newline = body.lastIndexOf('\n', end - 1)
    if (newline >= start + Math.floor(size / 4)) end = newline + 1
    else if (end - start > 2 && body[end] !== '\n' && body[end + 1] === '\n') end--
    if (end > start && /[\uD800-\uDBFF]/.test(body[end - 1]) && /[\uDC00-\uDFFF]/.test(body[end])) end++
  }
  return end
}
function piece(unit, start, end) {
  const scope = {
    path: unit.path,
    kind: unit.kind,
    unit: unit.index,
    units: unit.count,
    before: unit.before,
    after: unit.after,
    part: [start, end, unit.body.length]
  }
  const label = {
    path: unit.path,
    unit: `${unit.index + 1}/${unit.count}`,
    kind: unit.kind,
    mergeBaseLines: unit.before,
    headLines: unit.after,
    ...(start > 0 || end < unit.body.length ? { part: scope.part } : {})
  }
  return {
    scope,
    text: `CHANGE ${JSON.stringify(label)}\n${unit.header}\n${unit.body.slice(start, end)}\nEND CHANGE ${JSON.stringify(unit.path)}`
  }
}

/**
 * Split change units into bound batches: each batch is the trusted header, complete or part unit
 * bodies and the scope list derived from the actual ranges (never from source markers).
 */
export function splitBatches(files, context, maxChars = 90000) {
  if (
    !Number.isSafeInteger(maxChars) ||
    maxChars < 4000 ||
    typeof context !== 'string' ||
    context.length >= maxChars
  )
    throw new Error('Review context exceeds batch budget')
  const pieces = []
  for (const file of files)
    for (const unit of reviewUnits(file)) {
      let start = 0,
        first = true
      while (first || start < unit.body.length) {
        first = false
        let size = Math.max(
          1,
          maxChars - context.length - JSON.stringify(unit.path).length * 3 - unit.header.length - 700
        )
        let end = cut(unit.body, start, size),
          next = piece(unit, start, end)
        while (renderBatch(context, [next]).length > maxChars && size > 1) {
          size = Math.floor(size / 2)
          end = cut(unit.body, start, size)
          next = piece(unit, start, end)
        }
        if (renderBatch(context, [next]).length > maxChars || (end === start && unit.body.length))
          throw new Error('Review context leaves no complete change chunk within batch budget')
        pieces.push(next)
        start = end
      }
    }
  if (!pieces.length) throw new Error('No reviewable changes')
  const batches = []
  let pending = []
  const emit = () => {
    const batch = bindBatch(`batch-${batches.length + 1}`, context, pending)
    if (batch.text.length > maxChars) throw new Error('Review batch exceeds its complete output budget')
    batches.push(batch)
    pending = []
  }
  for (const next of pieces) {
    if (pending.length && renderBatch(context, [...pending, next]).length > maxChars) emit()
    pending.push(next)
  }
  if (pending.length) emit()
  return batches
}

/**
 * Coverage over the exact model input: for every file, the pieces of all batches concatenate to
 * each unit body exactly once, in order, and those bodies rebuild the head text from the
 * merge-base text byte for byte (deleted files: the rows reproduce the complete merge-base text).
 */
export function verifyBatchCoverage(files, batches) {
  const parts = new Map()
  // The pieces checked below are exactly the model input: every batch text is re-rendered.
  for (const batch of batches)
    if (!batch.pieces?.length || renderBatch(batch.context, batch.pieces) !== batch.text)
      throw new Error(`Review batch ${JSON.stringify(batch.id)} text does not match its pieces`)
  for (const batch of batches)
    for (const item of batch.pieces ?? []) {
      const key = item.scope.path + '\0' + item.scope.unit
      if (!parts.has(key)) parts.set(key, [])
      parts.get(key).push(item)
    }
  for (const file of files) {
    const units = reviewUnits(file),
      shown = []
    for (const unit of units) {
      const items = (parts.get(file.path + '\0' + unit.index) ?? []).sort(
        (a, b) => a.scope.part[0] - b.scope.part[0]
      )
      let at = 0,
        body = ''
      for (const item of items) {
        if (
          item.scope.part[0] !== at ||
          item.scope.kind !== unit.kind ||
          item.scope.part[2] !== unit.body.length
        )
          throw new Error(`Review batches do not cover ${JSON.stringify(file.path)} exactly`)
        const first = item.text.indexOf('\n'),
          second = item.text.indexOf('\n', first + 1)
        if (item.text.slice(first + 1, second) !== unit.header)
          throw new Error(`Review batches do not cover ${JSON.stringify(file.path)} exactly`)
        const text = item.text.slice(second + 1, item.text.lastIndexOf('\nEND CHANGE '))
        body += text
        at = item.scope.part[1]
      }
      if (at !== unit.body.length || body !== unit.body)
        throw new Error(`Review batches do not cover ${JSON.stringify(file.path)} exactly`)
      shown.push({ ...unit, body })
    }
    // Deleted files: the rows must reproduce the merge-base text and the head side is empty.
    if (rebuildAfter(file.before ?? '', shown) !== (file.after ?? ''))
      throw new Error(`Review units do not rebuild ${JSON.stringify(file.path)}`)
  }
  return true
}

/** Halve an output-truncated batch: whole pieces first, then one piece at a line boundary. */
export function splitReviewBatch(batch) {
  if (!batch.pieces?.length || renderBatch(batch.context, batch.pieces) !== batch.text)
    throw new Error('Review batch cannot be split: pieces do not match its text')
  let halves
  if (batch.pieces.length > 1) {
    const middle = Math.ceil(batch.pieces.length / 2)
    halves = [batch.pieces.slice(0, middle), batch.pieces.slice(middle)]
  } else {
    const [only] = batch.pieces,
      [start, end, total] = only.scope.part
    const header = only.text.slice(0, only.text.indexOf('\n', only.text.indexOf('\n') + 1) + 1)
    const body = only.text.slice(header.length, only.text.lastIndexOf('\nEND CHANGE '))
    if (body.length < 2) return null
    const unit = {
      path: only.scope.path,
      kind: only.scope.kind,
      index: only.scope.unit,
      count: only.scope.units,
      before: only.scope.before,
      after: only.scope.after,
      header: header.slice(header.indexOf('\n') + 1, -1),
      // Offsets are relative to the complete unit body; only this piece's range is used.
      body: ' '.repeat(start) + body + ' '.repeat(total - end)
    }
    const middle = cut(unit.body, start, Math.ceil(body.length / 2))
    if (middle <= start || middle >= end) return null
    halves = [[piece(unit, start, middle)], [piece(unit, middle, end)]]
  }
  return halves.map((pieces, index) => bindBatch(`${batch.id}.${index + 1}`, batch.context, pieces))
}
