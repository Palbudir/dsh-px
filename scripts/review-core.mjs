import { createHash, createPrivateKey, createPublicKey, sign, verify } from 'node:crypto'
import { inflateRawSync } from 'node:zlib'
import { posix } from 'node:path'
import { isBuiltin } from 'node:module'

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
    typeof payload.reviewer?.cliVersion !== 'string' ||
    !/^[a-f0-9]{64}$/.test(payload.reviewer?.configurationDigest)
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

/** A small lexer for literal JS/TS module references; comments and quoted fixture source are not imports. */
function sourceTokens(source, jsx = false) {
  const tokens = []
  let i = 0
  const quoted = () => {
    const quote = source[i++]
    while (i < source.length && source[i] !== quote) {
      if (source[i] === '\\') i++
      i++
    }
    if (i >= source.length) throw new Error('Unclosed JSX attribute')
    i++
  }
  const jsxElement = () => {
    const at = i++
    while (i < source.length) {
      if (source[i] === "'" || source[i] === '"') {
        quoted()
        continue
      }
      if (source[i] === '{') {
        i++
        tokens.push({ kind: 'symbol', value: '(', at: i })
        scan(true)
        continue
      }
      // TSX component type arguments, e.g. <Select<Item> value={...} />.
      if (source[i] === '<') {
        const begin = ++i
        let depth = 1
        while (i < source.length && depth) {
          if (source[i] === "'" || source[i] === '"') {
            quoted()
            continue
          }
          if (source[i] === '<') depth++
          if (source[i] === '>') depth--
          if (depth) i++
        }
        if (depth) throw new Error('Unclosed TSX type arguments')
        tokens.push(
          ...sourceTokens(source.slice(begin, i)).map((token) => ({ ...token, at: token.at + begin }))
        )
        i++
        continue
      }
      if (source.startsWith('/>', i)) {
        i += 2
        tokens.push({ kind: 'jsx', value: 'JSX', at })
        return
      }
      if (source[i++] === '>') break
    }
    while (i < source.length) {
      if (source.startsWith('</', i)) {
        const end = source.indexOf('>', i + 2)
        if (end < 0) throw new Error('Unclosed JSX closing tag')
        i = end + 1
        tokens.push({ kind: 'jsx', value: 'JSX', at })
        return
      }
      if (source[i] === '<') {
        jsxElement()
        continue
      }
      if (source[i] === '{') {
        i++
        tokens.push({ kind: 'symbol', value: '(', at: i })
        scan(true)
        continue
      }
      i++ // JSX prose (apostrophes, quotes and import-like words) is not JavaScript source.
    }
    throw new Error('Unclosed JSX element')
  }
  const scan = (interpolation = false) => {
    let depth = 0
    while (i < source.length) {
      const at = i,
        c = source[i]
      if (/\s/.test(c)) {
        i++
        continue
      }
      if (source.startsWith('//', i)) {
        i = source.indexOf('\n', i)
        if (i < 0) i = source.length
        continue
      }
      if (source.startsWith('/*', i)) {
        const end = source.indexOf('*/', i + 2)
        if (end < 0) throw new Error('Unclosed source comment')
        i = end + 2
        continue
      }
      if (
        jsx &&
        c === '<' &&
        /^<(?:[A-Za-z_$]|>)/.test(source.slice(i)) &&
        !/^<[A-Za-z_$][\w$]*(?:\s+extends\b|\s*[,=])/.test(source.slice(i)) &&
        (!tokens.length || /^(?:=|\(|\[|\{|:|,|;|!|\?|return|yield|=>|\|\||&&)$/.test(tokens.at(-1).value))
      ) {
        jsxElement()
        continue
      }
      if (c === "'" || c === '"') {
        i++
        while (i < source.length && source[i] !== c) {
          if (source[i] === '\\') i++
          i++
        }
        if (i >= source.length) throw new Error('Unclosed source literal')
        tokens.push({ kind: 'string', value: source.slice(at + 1, i), at })
        i++
        continue
      }
      if (c === '`') {
        const token = { kind: 'string', value: '', at }
        tokens.push(token)
        i++
        const body = i
        while (i < source.length && source[i] !== '`') {
          if (source[i] === '\\') {
            i += 2
            continue
          }
          if (source.startsWith('${', i)) {
            token.kind = 'dynamic'
            i += 2
            tokens.push({ kind: 'symbol', value: '(', at: i })
            scan(true)
            continue
          }
          i++
        }
        if (i >= source.length) throw new Error('Unclosed template literal')
        token.value = source.slice(body, i)
        i++
        continue
      }
      // Regex bodies are data, including text that resembles an import.
      if (
        c === '/' &&
        (!tokens.length || /^(?:=|\(|\[|\{|:|,|;|!|\?|return|throw|=>|\|\||&&)$/.test(tokens.at(-1).value))
      ) {
        i++
        let inClass = false
        while (i < source.length) {
          if (source[i] === '\\') {
            i += 2
            continue
          }
          if (source[i] === '[') inClass = true
          if (source[i] === ']') inClass = false
          if (source[i] === '/' && !inClass) {
            i++
            break
          }
          if (source[i] === '\n') break
          i++
        }
        while (/[a-z]/i.test(source[i] ?? '')) i++
        tokens.push({ kind: 'regex', value: '/', at })
        continue
      }
      if (c === '}' && interpolation && depth === 0) {
        i++
        return
      }
      if (c === '{') depth++
      if (c === '}') depth--
      const identifier = /^[A-Za-z_$][\w$]*/.exec(source.slice(i))
      if (identifier) {
        tokens.push({ kind: 'word', value: identifier[0], at })
        i += identifier[0].length
      } else {
        const value = /^(?:=>|&&|\|\|)/.exec(source.slice(i))?.[0] ?? c
        tokens.push({ kind: 'symbol', value, at })
        i += value.length
      }
    }
    if (interpolation) throw new Error('Unclosed template interpolation')
  }
  scan()
  return tokens
}

export function reviewModuleReferences(source, options = {}) {
  const tokens = sourceTokens(source, options.jsx === true),
    literals = [],
    dynamic = []
  const add = (token, owner, complete = true) => {
    if (token?.kind === 'string' && complete) literals.push({ specifier: token.value, at: token.at })
    else
      dynamic.push({
        at: owner.at,
        kind: owner.value,
        ...(token?.kind === 'string' ? { incompleteLiteralPrefix: token.value } : {})
      })
  }
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i],
      next = tokens[i + 1]
    if (token.kind !== 'word') continue
    if (['import', 'require'].includes(token.value) && next?.value === '(') {
      const end = tokens[i + 3]?.value
      add(tokens[i + 2], token, end === ')' || (token.value === 'import' && end === ','))
      continue
    }
    if (token.value === 'import' && next?.kind === 'string') {
      add(next, token)
      continue
    }
    if (
      (token.value === 'import' && next?.value !== '.') ||
      (token.value === 'export' && ['{', '*', 'type'].includes(next?.value))
    ) {
      for (let j = i + 1; j < tokens.length; j++) {
        if (tokens[j].value === 'from' && tokens[j + 1]?.kind === 'string') {
          add(tokens[j + 1], token)
          break
        }
        if (
          tokens[j].value === ';' ||
          (j > i + 1 && ['import', 'export', 'const', 'function', 'class', '='].includes(tokens[j].value))
        )
          break
      }
    }
  }
  // The repository's test loader imports literal script names through this specific helper.
  if (/pathToFileURL\s*\(\s*resolve\s*\(\s*['"]scripts['"]/.test(source))
    for (let i = 0; i < tokens.length - 2; i++)
      if (
        tokens[i].value === 'load' &&
        tokens[i + 1].value === '(' &&
        tokens[i + 2].kind === 'string' &&
        /^[a-z][a-z0-9-]*\.mjs$/.test(tokens[i + 2].value)
      ) {
        if (tokens[i + 3]?.value === ')')
          literals.push({
            specifier: 'scripts/' + tokens[i + 2].value,
            repositoryRelative: true,
            at: tokens[i + 2].at
          })
        else
          dynamic.push({
            at: tokens[i].at,
            kind: 'load',
            incompleteLiteralPrefix: 'scripts/' + tokens[i + 2].value
          })
      }
  return { literals, dynamic }
}

/** Collect only immutable Git blobs, including before/base contracts when they differ from head. */
export async function collectReviewContext(request, reader, limits = {}) {
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
    dynamic = []
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
      cached.set(entry.oid, text)
      bytesRead += bytes.length
    }
    return { ...entry, text: cached.get(entry.oid) }
  }
  const queue = [],
    queued = new Set()
  const add = (ref, path, reason, required = true, context = true) => {
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
  const consumers = release
    ? [
        'src/main/update-controller.ts',
        'src/main/update-bridge.ts',
        'packages/dsh-px-updater/src/index.ts',
        'packages/dsh-px-updater/src/metadata.ts',
        'packages/dsh-px-updater/src/client-data.ts',
        'packages/dsh-px-updater/src/version.ts'
      ]
    : []
  for (const [, ref] of roles) {
    for (const path of request.names) add(ref, path, 'changed source dependency root', false, false)
    for (const path of common) add(ref, path, 'project contract', false)
    for (const path of support) add(ref, path, 'review policy and installation contract', false)
    for (const path of consumers) add(ref, path, 'release updater consumer contract', false)
  }
  const resolveDependency = (ref, from, dependency) => {
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
      candidates.push(
        ...extensions.map((ext) => path + ext),
        ...extensions.map((ext) => path + '/index' + ext)
      )
    const found = candidates.find((candidate) => trees.get(ref).has(candidate))
    if (!found)
      throw new Error(`Unresolved local dependency ${JSON.stringify(specifier)} from ${from} at ${ref}`)
    return found
  }
  for (let index = 0; index < queue.length; index++) {
    const { ref, path } = queue[index],
      entry = await read(ref, path)
    if (/\.[cm]?[jt]sx?$/.test(path)) {
      const references = reviewModuleReferences(entry.text, { jsx: /\.[jt]sx$/.test(path) })
      for (const dependency of references.literals) {
        const specifier = dependency.specifier
        if (dependency.repositoryRelative || specifier.startsWith('.'))
          add(ref, resolveDependency(ref, path, dependency), `local dependency of ${path}`)
        else if (specifier.startsWith('/') || /^[a-z]:[\\/]/i.test(specifier))
          throw new Error(`Absolute dependency is outside the Git snapshot: ${path}`)
        else if (!isBuiltin(specifier)) external.set(specifier, true)
      }
      for (const item of references.dynamic)
        dynamic.push({
          ref,
          path,
          line: entry.text.slice(0, item.at).split('\n').length,
          kind: item.kind,
          ...(item.incompleteLiteralPrefix ? { incompleteLiteralPrefix: item.incompleteLiteralPrefix } : {})
        })
    }
    if (path === 'docs/github/review-policy.json') {
      let policy
      try {
        policy = JSON.parse(entry.text)
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
    identities = []
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
        sha256: sha256(entry.text),
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
    files.push({ path, before: before?.text ?? '', after: after?.text ?? '', binary: false })
  }
  const header = `Repository: ${request.repository}\nBase: ${request.base}\nMerge base: ${request.mergeBase}\nHead: ${request.head}\nChanged paths: ${JSON.stringify(request.names)}\nContext contract: all selected local sources below are complete immutable Git blobs. Source roles are explicit; identical blobs are printed once. External packages and computed references are not silently treated as reviewed implementations.\nExternal module references (use package.json versions; external code is not in this Git snapshot): ${JSON.stringify([...external.keys()].sort())}\nComputed module references (assess whether their targets need additional context): ${JSON.stringify(dynamic)}\n`
  const text = header + context.join('\n\n')
  return {
    files,
    context: text,
    identities,
    metrics: {
      paths: paths.size,
      blobs: cached.size,
      bytesRead,
      contextChars: text.length,
      externalReferences: external.size,
      computedReferences: dynamic.length
    }
  }
}
/** Every byte of a text change is included; large files are split, never silently dropped. */
export function splitBatches(files, context, maxChars = 90000) {
  if (
    !Number.isSafeInteger(maxChars) ||
    maxChars < 4000 ||
    typeof context !== 'string' ||
    context.length >= maxChars
  )
    throw new Error('Review context exceeds batch budget')
  const chunks = []
  for (const file of files) {
    if (file.binary) throw new Error(`Binary change requires a separate verified review: ${file.path}`)
    const before = file.before ?? '',
      after = file.after ?? ''
    if (before.includes('\0') || after.includes('\0'))
      throw new Error(`Binary change requires a separate verified review: ${file.path}`)
    for (let at = 0; at < Math.max(1, before.length, after.length);) {
      let size = Math.max(
        1,
        Math.floor((maxChars - context.length - JSON.stringify(file.path).length - 128) / 2)
      )
      const chunk = () =>
        `FILE ${JSON.stringify(file.path)}\nBEFORE chars ${Math.min(at, before.length)}-${Math.min(before.length, at + size)}/${before.length}\n${before.slice(at, at + size)}\nAFTER chars ${Math.min(at, after.length)}-${Math.min(after.length, at + size)}/${after.length}\n${after.slice(at, at + size)}`
      while (context.length + 2 + chunk().length > maxChars && size > 1) size = Math.floor(size / 2)
      const text = chunk()
      if (context.length + 2 + text.length > maxChars)
        throw new Error('Review context leaves no complete change chunk within batch budget')
      chunks.push(text)
      at += size
    }
  }
  if (!chunks.length) throw new Error('No reviewable changes')
  const batches = []
  let text = context
  for (const chunk of chunks) {
    if (text.length + chunk.length > maxChars && text !== context) {
      batches.push(text)
      text = context
    }
    text += '\n\n' + chunk
  }
  if (text !== context) batches.push(text)
  if (batches.some((batch) => batch.length > maxChars))
    throw new Error('Review batch exceeds its complete output budget')
  return batches.map((text, i) => ({ id: `batch-${i + 1}-${sha256(text).slice(0, 12)}`, text }))
}
