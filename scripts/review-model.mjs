import { writeFileSync } from 'node:fs'
import { reviewSchema } from './review-core.mjs'

/** Direct DeepSeek Chat Completions reviewer: plain text in, JSON out, never any tools. */
export const MODEL_PROVIDER = 'deepseek'
export const DEFAULT_MODEL = 'deepseek-flash'
export const DEFAULT_BASE_URL = 'https://api.deepseek.com'
export const DEFAULT_API_KEY_ENV = 'DEEPSEEK_API_KEY'
export const MODEL_MAX_ATTEMPTS = 4
// Thinking mode is on by default; its default output budget (64K) would cut long review JSON.
export const MODEL_MAX_TOKENS = 131072
const RETRY_BASE_MS = 2000,
  RETRY_CAP_MS = 60000,
  ERROR_TEXT_LIMIT = 300
/** Upper bound for one model response body; larger bodies fail closed. */
export const MAX_RESPONSE_BYTES = 8 * 1024 * 1024
class ResponseTooLarge extends Error {}

/** Read a response body without buffering more than `limit` bytes. */
async function boundedText(response, limit) {
  const declared = Number(response.headers?.get?.('content-length') ?? 0)
  if (declared > limit) throw new ResponseTooLarge('Review model response exceeds size limit')
  if (!response.body?.getReader) {
    const text = await response.text()
    if (Buffer.byteLength(text) > limit)
      throw new ResponseTooLarge('Review model response exceeds size limit')
    return text
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
      throw new ResponseTooLarge('Review model response exceeds size limit')
    }
    chunks.push(Buffer.from(value))
  }
  return Buffer.concat(chunks).toString('utf8')
}

/** Validates the installed model identity; the API key value is never part of it. */
export function modelSettings(input = {}) {
  const model = input.model ?? DEFAULT_MODEL
  const apiKeyEnv = input.apiKeyEnv ?? DEFAULT_API_KEY_ENV
  if (input.provider !== undefined && input.provider !== MODEL_PROVIDER)
    throw new Error('Unsupported review model provider')
  if (typeof model !== 'string' || !/^[A-Za-z0-9][\w.:-]{0,127}$/.test(model))
    throw new Error('Invalid review model name')
  if (typeof apiKeyEnv !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(apiKeyEnv))
    throw new Error('Invalid API key environment variable name')
  if (/^(?:GH|GITHUB)_/i.test(apiKeyEnv))
    throw new Error('GitHub credentials cannot be used as the review model key')
  let url
  try {
    url = new URL(input.baseUrl ?? DEFAULT_BASE_URL)
  } catch {
    throw new Error('Invalid review model base URL')
  }
  if (url.protocol !== 'https:') throw new Error('Review model base URL must use https')
  if (url.username || url.password || url.search || url.hash)
    throw new Error('Review model base URL must not contain credentials, query or fragment')
  const baseUrl = url.origin + url.pathname.replace(/\/+$/, '')
  return { provider: MODEL_PROVIDER, model, baseUrl, apiKeyEnv }
}

/** The installed worker must carry an explicit, already-normalized model record (no defaults). */
export function installedModel(config) {
  const stored = config?.model
  if (!stored || typeof stored !== 'object' || stored.provider !== MODEL_PROVIDER)
    throw new Error('Trusted worker lacks a DeepSeek model configuration; reinstall the review worker')
  const settings = modelSettings(stored)
  if (
    Object.keys(stored).sort().join() !== 'apiKeyEnv,baseUrl,model,provider' ||
    settings.baseUrl !== stored.baseUrl
  )
    throw new Error('Trusted worker model configuration is not normalized; reinstall the review worker')
  return settings
}

/** Public reviewer identity recorded in attestations and cache keys (no key value). */
export function modelIdentity(config) {
  const { provider, model, baseUrl } = installedModel(config)
  return { provider, model, baseUrl }
}

export function readApiKey(settings, env = process.env) {
  const value = env[settings.apiKeyEnv]
  if (typeof value !== 'string' || !value.trim())
    throw new Error(`Review model API key is missing: set the ${settings.apiKeyEnv} environment variable`)
  return value.trim()
}

export function reviewMessages(prompt, identity, source) {
  return [
    {
      role: 'system',
      content: `${prompt}\n\nOUTPUT FORMAT: respond with exactly one json object and nothing else. It must strictly conform to this JSON Schema (no extra properties, all required fields present):\n${JSON.stringify(reviewSchema)}\nExample json: {"head":"<IDENTITY.head>","base":"<IDENTITY.base>","batchId":"<IDENTITY.batchId>","verdict":"fail","summary":"...","findings":[{"priority":1,"path":"src/file.ts","line":12,"title":"...","detail":"..."}],"blockers":[]}`
    },
    {
      role: 'user',
      content: `IDENTITY ${JSON.stringify(identity)}\n\n<untrusted-source>\n${source}\n</untrusted-source>`
    }
  ]
}

/** Strict structural check against reviewSchema; identity binding is validated by validateResult. */
export function assertSchema(value, schema = reviewSchema, path = 'result') {
  const fail = () => {
    throw new Error(`Reviewer output does not match the review schema at ${path}`)
  }
  if (schema.enum && !schema.enum.includes(value)) fail()
  switch (schema.type) {
    case 'object': {
      if (!value || typeof value !== 'object' || Array.isArray(value)) fail()
      for (const key of schema.required ?? []) if (!Object.hasOwn(value, key)) fail()
      for (const [key, child] of Object.entries(value)) {
        const nested = schema.properties?.[key]
        if (!nested) {
          if (schema.additionalProperties === false) fail()
          continue
        }
        assertSchema(child, nested, `${path}.${key}`)
      }
      break
    }
    case 'array':
      if (!Array.isArray(value)) fail()
      value.forEach((item, i) => assertSchema(item, schema.items, `${path}[${i}]`))
      break
    case 'string':
      if (typeof value !== 'string') fail()
      break
    case 'integer':
      if (!Number.isSafeInteger(value)) fail()
      if (schema.minimum !== undefined && value < schema.minimum) fail()
      if (schema.maximum !== undefined && value > schema.maximum) fail()
      break
  }
  return value
}

let proxyConfigured = false
/** Node 24 built-in env proxy support; applies to global fetch without dependencies. */
export async function ensureEnvironmentProxy(env = process.env) {
  if (proxyConfigured || !(env.HTTPS_PROXY || env.https_proxy)) return
  const http = await import('node:http')
  if (typeof http.setGlobalProxyFromEnv !== 'function')
    throw new Error('HTTPS_PROXY is set but this Node.js cannot apply it; use Node.js 24 or later')
  http.setGlobalProxyFromEnv()
  proxyConfigured = true
}

class RetryableError extends Error {
  constructor(message, retryAfterMs) {
    super(message)
    this.retryAfterMs = retryAfterMs
  }
}
const redact = (text, key) =>
  String(text ?? '')
    .split(key)
    .join('[redacted]')
    .replace(/\bsk-[A-Za-z0-9_-]{6,}/g, '[redacted]')
    .replace(/[\r\n]+/g, ' ')
    .slice(0, ERROR_TEXT_LIMIT)
const retryAfter = (response) => {
  const header = response.headers?.get?.('retry-after')
  if (typeof header !== 'string' || !/^\d+$/.test(header.trim())) return undefined
  return Math.min(Number(header.trim()) * 1000, RETRY_CAP_MS)
}

/**
 * One reviewer invocation. Returns the parsed schema-valid object and appends every attempt
 * (response or error, never the key or request headers) to `traceFile` with mode 0600.
 */
export async function callReviewModel(config, messages, options = {}) {
  const settings = installedModel(config)
  const env = options.env ?? process.env
  const apiKey = readApiKey(settings, env)
  const fetcher = options.fetch ?? globalThis.fetch
  if (!options.fetch) await ensureEnvironmentProxy(env)
  const sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)))
  const now = options.now ?? Date.now
  const deadline = now() + (config.timeoutMs ?? 900000)
  const maxAttempts = options.maxAttempts ?? MODEL_MAX_ATTEMPTS
  const body = JSON.stringify({
    model: settings.model,
    messages,
    thinking: { type: 'enabled' },
    response_format: { type: 'json_object' },
    max_tokens: MODEL_MAX_TOKENS,
    stream: false
  })
  const trace = []
  const record = (entry) => {
    // Defence in depth: a provider echoing the key back must not persist it.
    trace.push(
      JSON.stringify({ at: new Date(now()).toISOString(), ...entry })
        .split(apiKey)
        .join('[redacted]')
    )
    if (options.traceFile) writeFileSync(options.traceFile, trace.join('\n') + '\n', { mode: 0o600 })
  }
  let lastError
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const remaining = deadline - now()
    if (remaining <= 0) break
    try {
      let response
      try {
        response = await fetcher(settings.baseUrl + '/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            Authorization: `Bearer ${apiKey}`
          },
          body,
          // A redirect would re-send the prompt to another location.
          redirect: 'error',
          signal: AbortSignal.timeout(remaining)
        })
      } catch (error) {
        if (error?.name === 'TimeoutError') throw new Error('Review model request timed out')
        throw new RetryableError(`Review model network error: ${redact(error?.message, apiKey)}`)
      }
      let text
      try {
        text = await boundedText(response, MAX_RESPONSE_BYTES)
      } catch (error) {
        if (error instanceof ResponseTooLarge) throw new Error(error.message)
        if (error?.name === 'TimeoutError') throw new Error('Review model request timed out')
        throw new RetryableError(`Review model response read failed: ${redact(error?.message, apiKey)}`)
      }
      record({ attempt, status: response.status, body: text })
      if (response.status === 429 || response.status >= 500)
        throw new RetryableError(`Review model HTTP ${response.status}`, retryAfter(response))
      if (!response.ok)
        throw new Error(`Review model request failed (HTTP ${response.status}): ${redact(text, apiKey)}`)
      let completion
      try {
        completion = JSON.parse(text)
      } catch {
        throw new Error('Review model returned a non-JSON API response')
      }
      const choice = completion?.choices?.[0]
      if (!choice?.message || completion.choices.length !== 1)
        throw new Error('Review model response has no single choice')
      if (choice.message.tool_calls?.length)
        throw new Error('Reviewer attempted a forbidden capability: tool_calls')
      if (choice.finish_reason !== 'stop')
        throw new Error(`Review model did not complete (finish_reason=${String(choice.finish_reason)})`)
      if (typeof choice.message.content !== 'string' || !choice.message.content.trim())
        throw new Error('Review model returned empty content')
      let value
      try {
        value = JSON.parse(choice.message.content)
      } catch {
        throw new Error('Reviewer output is not valid JSON')
      }
      return assertSchema(value)
    } catch (error) {
      record({ attempt, error: redact(error.message, apiKey) })
      if (!(error instanceof RetryableError)) throw error
      lastError = error
      if (attempt === maxAttempts) break
      const delay = error.retryAfterMs ?? Math.min(RETRY_BASE_MS * 2 ** (attempt - 1), RETRY_CAP_MS)
      if (now() + delay >= deadline) break
      await sleep(delay)
    }
  }
  throw new Error(
    lastError ? `Review model failed after retries: ${lastError.message}` : 'Review model request timed out'
  )
}
