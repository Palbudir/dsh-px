import { createHash, createPrivateKey, createPublicKey, sign, verify } from 'node:crypto'
import { inflateRawSync } from 'node:zlib'

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
/** Every byte of a text change is included; large files are split, never silently dropped. */
export function splitBatches(files, context, maxChars = 90000) {
  if (maxChars < 4000 || context.length >= maxChars / 2)
    throw new Error('Review context exceeds batch budget')
  const chunks = []
  for (const file of files) {
    if (file.binary) throw new Error(`Binary change requires a separate verified review: ${file.path}`)
    const size = Math.floor(maxChars / 4),
      before = file.before ?? '',
      after = file.after ?? ''
    for (let at = 0; at < Math.max(1, before.length, after.length); at += size) {
      chunks.push(
        `FILE ${JSON.stringify(file.path)}\nBEFORE chars ${at}-${Math.min(before.length, at + size)}/${before.length}\n${before.slice(at, at + size)}\nAFTER chars ${at}-${Math.min(after.length, at + size)}/${after.length}\n${after.slice(at, at + size)}`
      )
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
  return batches.map((text, i) => ({ id: `batch-${i + 1}-${sha256(text).slice(0, 12)}`, text }))
}
