import { canonical, decodeSource, reviewSourcePath, sha, sha256 } from './review-core.mjs'

/**
 * Read-only reviewer tools over immutable Git snapshots and the trusted upstream catalog. They never
 * execute, write or reach the network: they read Git blobs that the worker already fetched and the
 * SRI-verified upstream files held in memory. Every result is secret-scanned before it reaches the
 * model: candidate (head) content with a finding stops the whole review; already-merged
 * (base/mergeBase) and upstream content is masked.
 */
export const TOOL_LIMITS = Object.freeze({
  /**
   * Tool calls per batch attempt. A real run spent 41 calls exploring before answering; 100 leaves
   * room for targeted reads while maxTotalBytes stays the effective bound on context growth.
   */
  maxCalls: 100,
  /** Bytes returned by one call (~15k tokens): a large file is read in explicit line ranges. */
  maxCallBytes: 60000,
  /** Bytes returned per batch attempt (~150k tokens); with a 240k-char batch it stays well inside 1M context. */
  maxTotalBytes: 600000,
  /** Lines returned by one read. */
  maxLines: 800,
  maxSearchResults: 100,
  maxSearchLineChars: 300,
  /** Larger blobs are skipped by search (reported) and must be read by range. */
  maxSearchFileBytes: 2000000,
  maxBlobBytes: 8000000,
  maxListEntries: 500,
  minPatternChars: 2,
  maxPatternChars: 200
})
export const TOOL_REFS = Object.freeze(['head', 'base', 'mergeBase'])

export class ToolBudgetExceeded extends Error {}
/** A candidate secret reached a tool result; only locations are carried. */
export class ReviewSecretFound extends Error {
  constructor(findings) {
    super(`Secret scan blocked a reviewer tool result at ${findings.length} location(s)`)
    this.findings = findings
  }
}

const refProperty = {
  type: 'string',
  enum: [...TOOL_REFS],
  description:
    'Snapshot: head = candidate, base = requested base, mergeBase = merge base (the diff "before" side).'
}
const lineProperties = {
  startLine: { type: 'integer', minimum: 1, description: '1-based first line (default 1).' },
  endLine: { type: 'integer', minimum: 1, description: '1-based last line, inclusive.' }
}
export function toolDefinitions(limits = TOOL_LIMITS) {
  return [
    {
      type: 'function',
      function: {
        name: 'read_file',
        description: `Read a file from an immutable Git snapshot, with line numbers. At most ${limits.maxLines} lines or ${limits.maxCallBytes} bytes per call; read long files in ranges.`,
        parameters: {
          type: 'object',
          additionalProperties: false,
          required: ['ref', 'path'],
          properties: { ref: refProperty, path: { type: 'string' }, ...lineProperties }
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'search',
        description: `Case-sensitive literal substring search (not a regular expression, ${limits.minPatternChars}-${limits.maxPatternChars} characters, one line) over text files of a snapshot. Returns path:line:text, at most ${limits.maxSearchResults} matches.`,
        parameters: {
          type: 'object',
          additionalProperties: false,
          required: ['ref', 'pattern'],
          properties: {
            ref: refProperty,
            pattern: { type: 'string' },
            pathPrefix: {
              type: 'string',
              description: 'Optional directory or file path to restrict the search.'
            }
          }
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'list',
        description: `List the immediate files (with byte sizes) and subdirectories of a snapshot directory; "" is the repository root. At most ${limits.maxListEntries} entries.`,
        parameters: {
          type: 'object',
          additionalProperties: false,
          required: ['ref', 'dir'],
          properties: { ref: refProperty, dir: { type: 'string' } }
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'read_upstream',
        description:
          'Read an official DSH host package contract file from the trusted worker lock (tarball SRI verified). Only locked packages, host versions and allowlisted paths are available; an unknown path returns the allowlist.',
        parameters: {
          type: 'object',
          additionalProperties: false,
          required: ['host', 'package', 'path'],
          properties: {
            host: { type: 'string', description: 'Pinned host version, e.g. 0.2.0-rc.1.' },
            package: {
              type: 'string',
              description: 'Package name, e.g. @deepseek-ai/dsh-client-connection.'
            },
            path: { type: 'string', description: 'File path inside the package, e.g. lib/types/index.d.ts.' },
            ...lineProperties
          }
        }
      }
    }
  ]
}

class Rejected extends Error {}
const reject = (message) => {
  throw new Rejected(message)
}
const safe = (path) => {
  try {
    reviewSourcePath(path)
    return true
  } catch {
    return false
  }
}

/**
 * One tool session per batch attempt. `reader` is { list(ref), read(ref, path) } over Git; blobs are
 * cached by oid. `execute` returns the exact content given to the model and its evidence record.
 */
export function createReviewTools({ request, reader, scan, mask, upstream, limits = TOOL_LIMITS }) {
  const refs = { head: sha(request.head), base: sha(request.base), mergeBase: sha(request.mergeBase) }
  if (typeof scan !== 'function' || typeof mask !== 'function')
    throw new Error('Reviewer tools require the secret scanner and masker')
  const trees = new Map(),
    texts = reader.textCache ?? new Map(),
    records = []
  let calls = 0,
    bytes = 0
  const tree = async (role) => {
    const ref = refs[role]
    if (!trees.has(ref)) {
      const entries = await reader.list(ref)
      trees.set(ref, new Map(entries.map((entry) => [entry.path, entry])))
    }
    return trees.get(ref)
  }
  const text = async (role, entry) => {
    if (!['100644', '100755'].includes(entry.mode) || entry.type !== 'blob')
      return { error: 'not a regular file' }
    if (!Number.isSafeInteger(entry.size) || entry.size > limits.maxBlobBytes)
      return { error: 'file too large' }
    if (!texts.has(entry.oid)) {
      const raw = await reader.read(refs[role], entry.path)
      if (raw.length !== entry.size) throw new Error(`Git source size changed: ${entry.path}`)
      let value = null
      try {
        value = decodeSource(raw, entry.path)
      } catch {
        value = null
      }
      texts.set(entry.oid, value)
    }
    const value = texts.get(entry.oid)
    return value === null ? { error: 'binary or non-UTF-8 file' } : { text: value }
  }
  /**
   * Text that may be shown from one blob. The complete blob is scanned once per oid (a line range
   * can never hide a key body whose BEGIN line lies outside it): a candidate finding stops the
   * review; merged and upstream text is masked as a whole before any slice is taken.
   */
  const scans = new Map()
  const shown = (at, path, oid, value) => {
    if (!scans.has(oid)) {
      const findings = scan(path, value)
      scans.set(oid, { findings, masked: findings.length ? mask(value) : value })
    }
    const result = scans.get(oid)
    if (result.findings.length && at === 'head')
      throw new ReviewSecretFound(result.findings.map((f) => ({ path, line: f.line, rule: f.rule })))
    return { text: result.masked, masked: result.findings.length > 0 }
  }
  const role = (value) =>
    TOOL_REFS.includes(value) ? value : reject('ref must be one of head, base, mergeBase')
  const path = (value, allowRoot = false) => {
    if (allowRoot && value === '') return ''
    try {
      return reviewSourcePath(value)
    } catch (error) {
      return reject(String(error.message))
    }
  }
  const lines = (args, total) => {
    for (const key of ['startLine', 'endLine'])
      if (args[key] !== undefined && (!Number.isSafeInteger(args[key]) || args[key] < 1))
        reject(`${key} must be a positive integer`)
    const start = args.startLine ?? 1
    if (start > Math.max(total, 1)) reject(`startLine ${start} is beyond the last line ${total}`)
    if (args.endLine !== undefined && args.endLine < start) reject('endLine must not precede startLine')
    const end = Math.min(args.endLine ?? total, total, start + limits.maxLines - 1)
    return { start, end }
  }
  const keys = (args, allowed) => {
    if (!args || typeof args !== 'object' || Array.isArray(args)) reject('arguments must be a JSON object')
    for (const key of Object.keys(args))
      if (!allowed.includes(key)) reject(`unknown argument ${JSON.stringify(key)}`)
  }
  /** Bounded numbered rows; stops at the per-call byte limit with an explicit continuation. */
  const numbered = (all, start, end, header) => {
    const out = [header]
    let size = Buffer.byteLength(header) + 1,
      last = start - 1
    for (let n = start; n <= end; n++) {
      let row = `${n} ${all[n - 1]}`
      if (Buffer.byteLength(row) > limits.maxCallBytes / 2)
        row = row.slice(0, limits.maxCallBytes / 8) + ' [line truncated]'
      if (size + Buffer.byteLength(row) + 1 > limits.maxCallBytes - 200) break
      out.push(row)
      size += Buffer.byteLength(row) + 1
      last = n
    }
    if (last < end) out.push(`[truncated at line ${last}; continue with startLine=${last + 1}]`)
    return { text: out.join('\n'), last }
  }

  const tools = {
    async read_file(args) {
      keys(args, ['ref', 'path', 'startLine', 'endLine'])
      const at = role(args.ref),
        file = path(args.path)
      const entry = (await tree(at)).get(file)
      if (!entry) reject(`${JSON.stringify(file)} is not present at ${at}`)
      const loaded = await text(at, entry)
      if (loaded.error) reject(`${JSON.stringify(file)} at ${at}: ${loaded.error}`)
      const visible = shown(at, file, entry.oid, loaded.text)
      const all = visible.text === '' ? [] : visible.text.replace(/\n$/, '').split('\n')
      const { start, end } = lines(args, all.length)
      const header = `FILE ${JSON.stringify(file)} ref=${at} (${refs[at]}) oid=${entry.oid} lines ${all.length ? start : 0}-${end}/${all.length}${visible.masked ? ' (masked already-merged content)' : ''}`
      const result = numbered(all, start, end, header)
      return {
        role: at,
        text: result.text,
        masked: visible.masked,
        sources: [{ path: file, oid: entry.oid }]
      }
    },
    async search(args) {
      keys(args, ['ref', 'pattern', 'pathPrefix'])
      const at = role(args.ref)
      if (
        typeof args.pattern !== 'string' ||
        args.pattern.length < limits.minPatternChars ||
        args.pattern.length > limits.maxPatternChars ||
        /[\r\n\0]/.test(args.pattern)
      )
        reject(
          `pattern must be a single-line literal string of ${limits.minPatternChars}-${limits.maxPatternChars} characters`
        )
      const prefix = args.pathPrefix === undefined ? '' : path(args.pathPrefix, true)
      const matches = []
      let files = 0,
        skipped = 0,
        size = 0,
        truncated = false
      const entries = [...(await tree(at)).values()]
        .filter((entry) => !prefix || entry.path === prefix || entry.path.startsWith(prefix + '/'))
        .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
      for (const entry of entries) {
        if (!safe(entry.path)) continue
        if (entry.size > limits.maxSearchFileBytes) {
          skipped++
          continue
        }
        const loaded = await text(at, entry)
        if (loaded.error) {
          skipped++
          continue
        }
        files++
        // Only the whole-blob-scanned, masked text is searched, so a match can never confirm a
        // substring hidden by masking (e.g. a merged key body). Blobs without findings are unchanged.
        if (!loaded.text.includes(args.pattern)) continue
        const rows = shown(at, entry.path, entry.oid, loaded.text).text.split('\n')
        for (let i = 0; i < rows.length && !truncated; i++) {
          if (!rows[i].includes(args.pattern)) continue
          const line = rows[i].replace(/\r$/, '').slice(0, limits.maxSearchLineChars)
          const row = `${entry.path}:${i + 1}:${line}`
          if (
            matches.length >= limits.maxSearchResults ||
            size + Buffer.byteLength(row) > limits.maxCallBytes - 500
          ) {
            truncated = true
            break
          }
          matches.push(row)
          size += Buffer.byteLength(row) + 1
        }
        if (truncated) break
      }
      const header = `SEARCH ref=${at} (${refs[at]}) pattern=${JSON.stringify(args.pattern)} pathPrefix=${JSON.stringify(prefix)} matches=${matches.length}${truncated ? ' (truncated; narrow pathPrefix or pattern)' : ''} filesSearched=${files} filesSkipped=${skipped}`
      return { role: at, text: [header, ...matches].join('\n'), sources: [] }
    },
    async list(args) {
      keys(args, ['ref', 'dir'])
      const at = role(args.ref),
        dir = path(args.dir, true)
      const children = new Map()
      for (const entry of (await tree(at)).values()) {
        if (dir && !entry.path.startsWith(dir + '/')) continue
        const rest = entry.path.slice(dir ? dir.length + 1 : 0),
          slash = rest.indexOf('/'),
          name = slash < 0 ? rest : rest.slice(0, slash)
        // Private and forbidden names (keys, .npmrc, generated trees) are not even listed.
        if (!safe(dir ? dir + '/' + name : name) || (slash < 0 && !safe(entry.path))) continue
        if (slash >= 0) children.set(name + '/', 'dir')
        else children.set(name, `${entry.size ?? '?'} bytes${entry.mode === '100755' ? ' executable' : ''}`)
      }
      if (!children.size) reject(`${JSON.stringify(dir)} is not a directory at ${at}`)
      const names = [...children.keys()].sort()
      const shown = names
        .slice(0, limits.maxListEntries)
        .map((name) => `${name}${children.get(name) === 'dir' ? '' : '\t' + children.get(name)}`)
      const header = `LIST ${JSON.stringify(dir)} ref=${at} (${refs[at]}) entries=${names.length}${names.length > shown.length ? ` (first ${shown.length})` : ''}`
      return { role: at, text: [header, ...shown].join('\n'), sources: [] }
    },
    async read_upstream(args) {
      keys(args, ['host', 'package', 'path', 'startLine', 'endLine'])
      if (!upstream) reject('no trusted upstream catalog is loaded for this review')
      const packages = typeof args.host === 'string' ? upstream.hosts.get(args.host) : undefined
      if (!packages) reject(`host must be one of ${JSON.stringify([...upstream.hosts.keys()])}`)
      const pkg = typeof args.package === 'string' ? packages.get(args.package) : undefined
      if (!pkg) reject(`package must be one of ${JSON.stringify([...packages.keys()].sort())}`)
      const file =
        pkg.files.find((item) => item.path === args.path && !item.slice) ??
        pkg.files.find((item) => item.path === args.path)
      if (!file)
        reject(
          `path is not in the locked allowlist; available: ${JSON.stringify([...new Set(pkg.files.map((item) => item.path))])}`
        )
      const from = file.slice?.fromLine ?? 1
      const visible = shown(
        'upstream',
        `${args.package}/${file.path}`,
        'upstream:' + file.sha256 + ':' + from,
        file.text
      )
      const all = visible.text === '' ? [] : visible.text.replace(/\n$/, '').split('\n')
      // Line numbers are those of the complete upstream file, also for a slice.
      const shifted = {
        ...args,
        startLine: args.startLine === undefined ? undefined : args.startLine - from + 1,
        endLine: args.endLine === undefined ? undefined : args.endLine - from + 1
      }
      if (
        (shifted.startLine !== undefined && shifted.startLine < 1) ||
        (shifted.endLine !== undefined && shifted.endLine < 1)
      )
        reject(`this locked file is a slice covering lines ${from}-${from + all.length - 1}`)
      const { start, end } = lines(shifted, all.length)
      const identity = {
        package: pkg.name ?? args.package,
        host: args.host,
        version: pkg.version,
        integrity: pkg.integrity,
        path: file.path,
        sha256: file.sha256,
        ...(file.slice ? { slice: file.slice } : {})
      }
      const rows = numbered(
        all,
        start,
        end,
        `UPSTREAM ${JSON.stringify(identity)} lines ${start + from - 1}-${end + from - 1}`
      )
      const text = rows.text
        .split('\n')
        .map((row, index) =>
          index === 0 || row.startsWith('[truncated')
            ? row
            : row.replace(/^(\d+)/, (n) => String(Number(n) + from - 1))
        )
        .join('\n')
      return { role: 'upstream', text, masked: visible.masked, sources: [{ upstream: identity }] }
    }
  }

  async function execute(call) {
    const name = call?.function?.name,
      raw = call?.function?.arguments
    calls++
    const record = {
      id: typeof call?.id === 'string' ? call.id.slice(0, 200) : null,
      name: typeof name === 'string' ? name.slice(0, 64) : null
    }
    let args
    try {
      args = typeof raw === 'string' ? JSON.parse(raw) : raw
      record.arguments = canonical(args ?? null).slice(0, 2000)
    } catch {
      record.arguments = null
      record.argumentsSha256 = sha256(String(raw ?? ''))
    }
    records.push(record)
    if (calls > limits.maxCalls) {
      record.outcome = 'budget-exceeded'
      throw new ToolBudgetExceeded(`Reviewer tool call budget exhausted (${limits.maxCalls} calls per batch)`)
    }
    let result
    try {
      if (!Object.hasOwn(tools, name)) reject(`unknown tool ${JSON.stringify(record.name)}`)
      if (args === undefined && record.arguments === null) reject('arguments are not valid JSON')
      result = await tools[name](args)
      record.outcome = result.masked ? 'masked' : 'ok'
    } catch (error) {
      if (error instanceof ReviewSecretFound) {
        record.outcome = 'secret-blocked'
        record.bytes = 0
        throw error
      }
      if (!(error instanceof Rejected)) throw error
      result = { role: 'error', text: `ERROR: ${error.message}`, sources: [] }
      record.outcome = 'rejected'
    }
    let content = result.text
    // Any remaining match (for example a model-supplied pattern echoed in a header) is masked.
    if (scan('<tool result>', content).length) {
      content = mask(content)
      if (record.outcome === 'ok') record.outcome = 'masked'
    }
    const room = limits.maxCallBytes - 120
    if (Buffer.byteLength(content) > room)
      content =
        Buffer.from(content)
          .subarray(0, room)
          .toString('utf8')
          .replace(/\uFFFD$/, '') + '\n[result truncated at per-call limit]'
    // The remaining budget is part of the exact content the model sees, so it is covered by the
    // recorded byte count and sha256; "bytes left" already subtracts this whole result.
    const body = Buffer.byteLength(content) + 1
    let line = ''
    for (let pass = 0; pass < 3; pass++) {
      const left = limits.maxTotalBytes - bytes - body - Buffer.byteLength(line)
      line = `[budget: ${limits.maxCalls - calls}/${limits.maxCalls} calls, ${Math.max(0, left)}/${limits.maxTotalBytes} bytes left]`
    }
    content += '\n' + line
    record.role = result.role
    record.sources = result.sources
    const size = Buffer.byteLength(content)
    if (bytes + size > limits.maxTotalBytes) {
      // Not delivered to the model: no bytes are counted and no returned-content digest is recorded.
      record.outcome = 'budget-exceeded'
      record.bytes = 0
      record.undeliveredBytes = size
      throw new ToolBudgetExceeded(
        `Reviewer tool result budget exhausted (${limits.maxTotalBytes} bytes per batch)`
      )
    }
    record.bytes = size
    record.sha256 = sha256(content)
    bytes += size
    return { content, record }
  }
  /** A call the model requested after the budget ran out: recorded, never executed. */
  function skip(call) {
    const record = {
      id: typeof call?.id === 'string' ? call.id.slice(0, 200) : null,
      name: typeof call?.function?.name === 'string' ? call.function.name.slice(0, 64) : null,
      argumentsSha256: sha256(String(call?.function?.arguments ?? '')),
      outcome: 'not-executed-budget-exhausted'
    }
    records.push(record)
    return record
  }
  return {
    definitions: toolDefinitions(limits),
    limits,
    execute,
    skip,
    records,
    usage: () => ({ calls, bytes })
  }
}
