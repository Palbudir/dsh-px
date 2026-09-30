import { appendFileSync, writeFileSync } from 'node:fs'
import { reviewSchema } from './review-core.mjs'
import { ToolBudgetExceeded } from './review-tools.mjs'

/**
 * Direct DeepSeek Chat Completions reviewer: diff text in, JSON out. The only tools are the
 * worker's read-only reviewer tools; any other tool call fails closed.
 */
export const MODEL_PROVIDER = 'deepseek'
export const DEFAULT_MODEL = 'deepseek-flash'
export const DEFAULT_BASE_URL = 'https://api.deepseek.com'
export const DEFAULT_API_KEY_ENV = 'DEEPSEEK_API_KEY'
export const MODEL_MAX_ATTEMPTS = 4
/** Documented Chat Completions maximum (384K = 393216); thinking plus review JSON share it. */
export const MODEL_MAX_TOKENS = 393216
export const MODEL_REASONING_EFFORT = 'high'
/** Per-request timeout when the installed config has none: 384K output tokens can take over an hour. */
export const MODEL_REQUEST_TIMEOUT_MS = 2 * 3600000
const RETRY_BASE_MS = 2000,
  RETRY_CAP_MS = 60000,
  ERROR_TEXT_LIMIT = 300
/**
 * Upper bound for one model response body; larger bodies fail closed. 393216 tokens of reasoning
 * and content is roughly 1.5 MB of text, and JSON escaping of non-ASCII (\\uXXXX, 6 bytes per
 * character) can grow it to about 12 MB; 32 MiB keeps a wide margin while bounding memory.
 */
export const MAX_RESPONSE_BYTES = 32 * 1024 * 1024
class ResponseTooLarge extends Error {}
/** finish_reason=length: the batch is too large for one answer and may be split and retried. */
export class OutputTruncated extends Error {}
/** The batch wall-clock deadline (options.deadline) passed; the batch fails closed. */
export class ReviewDeadlineExceeded extends Error {}
/** After the tool budget is spent the model gets one final turn without tools. */
export const FINALIZE_PROMPT =
  'The read-only tool budget for this batch is exhausted. Do not call tools. Based only on what you have read, return the final review JSON now. Put any essential context you could not obtain into blockers, naming the exact source and why it is needed.'

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
 * One reviewer invocation, possibly several rounds when read-only tools are supplied. Returns the
 * parsed schema-valid object. Every response, tool call (name, arguments, returned bytes and
 * sha256) and error is appended to `traceFile` (mode 0600), never the key or request headers.
 *
 * options.tools = { definitions, execute(call) -> { content, record } }: the worker's read-only
 * tools. In thinking mode with tools, DeepSeek requires the reasoning_content of every earlier
 * assistant turn to be passed back, so each assistant message is returned verbatim with it.
 */
export async function callReviewModel(config, messages, options = {}) {
  const settings = installedModel(config)
  const env = options.env ?? process.env
  const apiKey = readApiKey(settings, env)
  const fetcher = options.fetch ?? globalThis.fetch
  if (!options.fetch) await ensureEnvironmentProxy(env)
  const sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)))
  const now = options.now ?? Date.now
  const timeoutMs = config.timeoutMs ?? MODEL_REQUEST_TIMEOUT_MS
  const maxAttempts = options.maxAttempts ?? MODEL_MAX_ATTEMPTS
  const tools = options.tools
  const conversation = [...messages]
  const maxRounds = (options.maxRounds ?? 64) + 1
  let traced = 0
  const record = (entry) => {
    // Defence in depth: a provider echoing the key back must not persist it.
    const line = JSON.stringify({ at: new Date(now()).toISOString(), ...entry })
      .split(apiKey)
      .join('[redacted]')
    if (options.traceFile) {
      if (!traced) writeFileSync(options.traceFile, '', { mode: 0o600 })
      appendFileSync(options.traceFile, line + '\n')
    }
    traced++
  }
  /** One HTTP request with bounded retries; each request has its own timeout window. */
  const request = async (round, toolChoice) => {
    if (options.deadline !== undefined && now() >= options.deadline)
      throw new ReviewDeadlineExceeded('Review batch wall-clock deadline exceeded')
    const body = JSON.stringify({
      model: settings.model,
      messages: conversation,
      thinking: { type: 'enabled' },
      reasoning_effort: MODEL_REASONING_EFFORT,
      response_format: { type: 'json_object' },
      max_tokens: MODEL_MAX_TOKENS,
      stream: false,
      // Tools stay defined on the final turn so the reasoning_content pass-back rule is unchanged.
      ...(tools ? { tools: tools.definitions } : {}),
      ...(toolChoice ? { tool_choice: toolChoice } : {})
    })
    const byBatch = options.deadline !== undefined && options.deadline < now() + timeoutMs
    const deadline = byBatch ? options.deadline : now() + timeoutMs
    const timedOut = () =>
      byBatch
        ? new ReviewDeadlineExceeded('Review batch wall-clock deadline exceeded')
        : new Error('Review model request timed out')
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
          if (error?.name === 'TimeoutError') throw timedOut()
          throw new RetryableError(`Review model network error: ${redact(error?.message, apiKey)}`)
        }
        let text
        try {
          text = await boundedText(response, MAX_RESPONSE_BYTES)
        } catch (error) {
          if (error instanceof ResponseTooLarge) throw new Error(error.message)
          if (error?.name === 'TimeoutError') throw timedOut()
          throw new RetryableError(`Review model response read failed: ${redact(error?.message, apiKey)}`)
        }
        record({ round, attempt, status: response.status, body: text })
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
        return { choice, usage: completion.usage ?? null }
      } catch (error) {
        record({ round, attempt, error: redact(error.message, apiKey) })
        if (!(error instanceof RetryableError)) throw error
        lastError = error
        if (attempt === maxAttempts) break
        const delay = error.retryAfterMs ?? Math.min(RETRY_BASE_MS * 2 ** (attempt - 1), RETRY_CAP_MS)
        if (now() + delay >= deadline) break
        await sleep(delay)
      }
    }
    if (!lastError) throw timedOut()
    throw new Error(`Review model failed after retries: ${lastError.message}`)
  }
  let finalizing = false
  /** Spent budget: answer every requested call without executing it, then ask for the verdict. */
  const finalize = (pending, reason) => {
    for (const call of pending) {
      const skipped = tools.skip(call)
      record({ tool: skipped })
      conversation.push({
        role: 'tool',
        tool_call_id: call.id,
        content: `NOT EXECUTED: ${reason}. No further tool calls are available.`
      })
    }
    conversation.push({ role: 'user', content: FINALIZE_PROMPT })
    finalizing = true
    options.onFinalize?.(reason)
    record({ finalize: reason })
  }
  for (let round = 1; ; round++) {
    const { choice, usage } = await request(round, finalizing ? 'none' : undefined)
    const message = choice.message
    options.onRound?.({ round, finishReason: choice.finish_reason ?? null, usage, final: finalizing })
    if (message.tool_calls?.length) {
      if (!tools) throw new Error('Reviewer attempted a forbidden capability: tool_calls')
      if (finalizing) throw new Error('Reviewer requested tools after its tool budget was exhausted')
      if (choice.finish_reason !== 'tool_calls')
        throw new Error(`Review model did not complete (finish_reason=${String(choice.finish_reason)})`)
      if (
        !Array.isArray(message.tool_calls) ||
        message.tool_calls.some(
          (call) =>
            call?.type !== 'function' ||
            typeof call.id !== 'string' ||
            typeof call.function?.name !== 'string'
        )
      )
        throw new Error('Review model returned malformed tool_calls')
      // Pass the complete assistant turn back, including reasoning_content (thinking + tools).
      conversation.push({
        role: 'assistant',
        content: typeof message.content === 'string' ? message.content : '',
        ...(typeof message.reasoning_content === 'string'
          ? { reasoning_content: message.reasoning_content }
          : {}),
        tool_calls: message.tool_calls
      })
      if (round >= maxRounds) {
        finalize(message.tool_calls, `tool round limit reached (${maxRounds - 1} rounds)`)
        continue
      }
      for (let index = 0; index < message.tool_calls.length; index++) {
        const call = message.tool_calls[index]
        let result
        try {
          result = await tools.execute(call, round)
        } catch (error) {
          const last = tools.records?.at(-1)
          if (last) record({ round, tool: { ...last, round } })
          if (!(error instanceof ToolBudgetExceeded)) throw error
          conversation.push({
            role: 'tool',
            tool_call_id: call.id,
            content: `NOT RETURNED: ${error.message}. No further tool calls are available.`
          })
          finalize(message.tool_calls.slice(index + 1), error.message)
          break
        }
        record({ round, tool: { ...tools.records.at(-1), round } })
        conversation.push({ role: 'tool', tool_call_id: call.id, content: result.content })
      }
      continue
    }
    if (choice.finish_reason === 'length')
      throw new OutputTruncated('Review model did not complete (finish_reason=length)')
    if (choice.finish_reason !== 'stop')
      throw new Error(`Review model did not complete (finish_reason=${String(choice.finish_reason)})`)
    if (typeof message.content !== 'string' || !message.content.trim())
      throw new Error('Review model returned empty content')
    let value
    try {
      value = JSON.parse(message.content)
    } catch {
      throw new Error('Reviewer output is not valid JSON')
    }
    return assertSchema(value)
  }
}
