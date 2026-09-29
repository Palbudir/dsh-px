/**
 * Pre-push secret scan over every tracked or to-be-pushed file, including tests, fixtures and examples.
 * Fails on credential-shaped content, private key material, local machine paths and forbidden file names.
 * Usage: node scripts/check-secrets.mjs [--range <base>..<head>]   (default: all tracked + staged + untracked-not-ignored)
 */
import { execFileSync } from 'node:child_process'
import { readFileSync, existsSync, statSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const git = (...args) =>
  execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 })

/** Content rules. Each hit reports file:line and the rule id only, never the matched value. */
export const RULES = [
  ['private-key', /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY-----/],
  ['github-token', /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{60,})\b/],
  ['openai-style-key', /\bsk-(?:proj-|ant-)?[A-Za-z0-9_-]{32,}\b/],
  ['aws-access-key', /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/],
  ['slack-token', /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/],
  ['google-api-key', /\bAIza[0-9A-Za-z_-]{35}\b/],
  ['npm-token', /\bnpm_[A-Za-z0-9]{36}\b/],
  ['jwt', /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/],
  ['bearer-literal', /\b[Bb]earer\s+[A-Za-z0-9._~+/-]{32,}=*/],
  [
    'assigned-secret',
    /\b(?:api[_-]?key|secret|token|password|passwd|access[_-]?key)\b["']?\s*[:=]\s*["'][A-Za-z0-9._~+/-]{24,}["']/i
  ],
  ['windows-user-path', /\b[A-Za-z]:[\\/]+Users[\\/]+(?!Public\b|<|\$|%|\{)[A-Za-z0-9._ -]+[\\/]/i],
  ['posix-home-path', /(?:^|[\s"'(=])\/(?:home|Users)\/(?!runner\b|user\b|<|\$)[a-z0-9._-]+\//i]
]
/** A match is a declared placeholder only when the matched text itself says so. */
const PLACEHOLDER = /fixture|example|placeholder|dummy|redacted|synthetic|not-a-real|fake/i
/** Paths that must never be pushed regardless of content. */
const FORBIDDEN_PATH =
  /(?:^|\/)(?:\.env(?:\.[^/]*)?|\.?credentials(?:\.[^/]*)?|id_(?:rsa|ed25519|ecdsa)(?:\.pub)?|\.npmrc|\.netrc)$|\.(?:pem|key|p12|pfx|keystore|jks)$|(?:^|\/)build-test\//i
/** Explicitly reviewed public values that match a rule (path -> rule ids). Keep this list minimal. */
const ALLOW = new Map([
  // Pinned Ed25519 *public* keys only; the rule set does not match public keys, listed for clarity.
  ['config/update-keys.json', new Set()],
  // This scanner's own rule definitions.
  ['scripts/check-secrets.mjs', new Set(RULES.map(([id]) => id))],
  ['test/check-secrets.test.ts', new Set(RULES.map(([id]) => id))]
])

export function scanText(path, text) {
  const findings = []
  const allowed = ALLOW.get(path) ?? new Set()
  const lines = text.split(/\r?\n/)
  for (let i = 0; i < lines.length; i++)
    for (const [id, rule] of RULES) {
      if (allowed.has(id)) continue
      const match = rule.exec(lines[i])
      if (match && !PLACEHOLDER.test(match[0])) findings.push({ path, line: i + 1, rule: id })
    }
  return findings
}

function candidateFiles(range) {
  if (range) return git('diff', '--name-only', '--diff-filter=ACMR', range).split('\n').filter(Boolean)
  const tracked = git('ls-files', '-z').split('\0'),
    untracked = git('ls-files', '-z', '--others', '--exclude-standard').split('\0')
  return [...new Set([...tracked, ...untracked].filter(Boolean))]
}

export function scanRepository(range) {
  const findings = []
  for (const path of candidateFiles(range)) {
    if (FORBIDDEN_PATH.test(path)) {
      findings.push({ path, line: 0, rule: 'forbidden-path' })
      continue
    }
    const full = join(root, path)
    if (!existsSync(full) || !statSync(full).isFile() || statSync(full).size > 16 * 1024 * 1024) continue
    const bytes = readFileSync(full)
    if (bytes.subarray(0, 8000).includes(0)) continue // binary: covered by the path rule and artifact review
    findings.push(...scanText(path, bytes.toString('utf8')))
  }
  // Commit metadata in the pushed range can leak paths or tokens too.
  if (range) findings.push(...scanText('<commit messages>', git('log', '--format=%an <%ae>%n%B', range)))
  return findings
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const at = process.argv.indexOf('--range')
  const findings = scanRepository(at > 0 ? process.argv[at + 1] : undefined)
  for (const f of findings) process.stderr.write(`${f.path}:${f.line} ${f.rule}\n`)
  if (findings.length) {
    process.stderr.write(`Secret scan failed: ${findings.length} finding(s). Values are not printed.\n`)
    process.exit(1)
  }
  process.stdout.write('Secret scan passed\n')
}
