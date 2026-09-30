/**
 * Pre-push secret scan over every tracked or to-be-pushed file, including tests, fixtures and examples.
 * Fails on credential-shaped content, private key material, local machine paths and forbidden file names.
 * No file is exempt by path: rule sources below are assembled at runtime so this file never matches itself.
 * Usage: node scripts/check-secrets.mjs [--range <base>..<head>]   (default: all tracked + staged + untracked-not-ignored)
 */
import { execFileSync } from 'node:child_process'
import { readFileSync, existsSync, lstatSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const git = (...args) =>
  execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 })
const re = (parts, flags = '') => new RegExp(parts.join(''), flags)

/** Names of variables and fields that hold credentials. */
const KEY_NAME =
  '[A-Za-z0-9_.-]*(?:api[_-]?key|secret|token|passw(?:or)?d|access[_-]?key|private[_-]?key)[A-Za-z0-9_]*'
/**
 * A credential-shaped value: long, no whitespace, and not an identifier used as code
 * (followed by `(`, `[`, `?.`) or an UPPER_SNAKE environment variable *name*.
 */
const VALUE = '[A-Za-z0-9._~+/=-]{24,}(?![A-Za-z0-9._~+/=-]|\\(|\\[|\\?\\.)'
/** Case-sensitive: an UPPER_SNAKE value is a variable name, not a credential. */
const ENV_NAME = /^[A-Z][A-Z0-9_]*$/

/**
 * Content rules: [id, pattern, value group]. The value group (if any) is the part checked
 * against the placeholder convention; each hit reports path:line and the rule id only.
 */
export const RULES = [
  ['private-key', re(['-----BEGIN (?:[A-Z0-9]+ )*PRIV', 'ATE KEY-----'])],
  ['github-token', re(['\\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github', '_pat_[A-Za-z0-9_]{60,})'])],
  ['openai-style-key', re(['(?<![A-Za-z0-9])(s', 'k-(?:proj-|ant-)?[A-Za-z0-9_-]{32,})']), 1],
  ['aws-access-key', re(['\\b(?:AK', 'IA|AS', 'IA)[0-9A-Z]{16}\\b'])],
  ['slack-token', re(['\\bxo', 'x[abprs]-[A-Za-z0-9-]{10,}'])],
  ['google-api-key', re(['\\bAI', 'za[0-9A-Za-z_-]{35}'])],
  ['npm-token', re(['\\bnp', 'm_[A-Za-z0-9]{36}'])],
  ['jwt', re(['\\bey', 'J[A-Za-z0-9_-]{10,}\\.ey', 'J[A-Za-z0-9_-]{10,}\\.[A-Za-z0-9_-]{10,}'])],
  ['authorization-header', re(['\\b(?:[Bb]earer|[Tt]oken|[Bb]asic)\\s+(', VALUE, ')']), 1],
  // Quoted or unquoted assignments, including shell `export`, PowerShell `$env:` and `setx`.
  [
    'assigned-secret',
    re(['(?:^|[^A-Za-z0-9])', KEY_NAME, '["\']?\\s*(?::|=|\\s)\\s*["\']?(', VALUE, ')'], 'i'),
    1
  ],
  // Any user name, including non-ASCII (e.g. Chinese) names, on Windows and WSL paths.
  [
    'windows-user-path',
    // Drive letter (C:\Users), WSL (/mnt/c/Users) and Git Bash / MSYS (/c/Users) forms.
    re(
      [
        '(?:\\b[A-Za-z]:|/mnt/[a-z]|(?:^|[\\s"\'(=])/[a-z])[\\\\/]+Users[\\\\/]+([^\\\\/\\s"\'`<>|:*?]+)[\\\\/]'
      ],
      'i'
    ),
    1
  ],
  ['posix-home-path', re(['(?:^|[\\s"\'(=])/(?:home|Users)/([^/\\s"\'`<>]+)/'], 'i'), 1]
]
/**
 * Declared placeholders are recognised by the captured value itself, never by nearby words:
 * explicit fixture/example prefixes, masks like xxxx or ****, templates like <name> ${VAR} %VAR%.
 */
const PLACEHOLDER_VALUE =
  /^(?:s[k]-)?(?:(?:fixture|example|placeholder|dummy|fake|redacted|synthetic|test-fixture)[-_]|[x*.0]{4,}$|<[^>]*>$|\$\{?[A-Za-z_]|%[A-Za-z_]+%|\{\{)/i
/** Generic or explicitly synthetic account names that are not personal machine paths. */
const PLACEHOLDER_USER =
  /^(?:Public|Default|All Users|runner|user|username|<[^>]*>|%[^%]+%|\$\{?[A-Za-z_][^/\\]*|\{[^}]*\}|[A-Z0-9_]*FIXTURE[A-Z0-9_]*|用户名|你的用户名)$/i
/** High-signal rules still applied to the printable bytes of binary files. */
const BINARY_RULES = new Set([
  'private-key',
  'github-token',
  'openai-style-key',
  'aws-access-key',
  'npm-token',
  'slack-token',
  'google-api-key'
])
/** Paths that must never be pushed regardless of content. */
const FORBIDDEN_PATH =
  /(?:^|\/)(?:\.env(?:\.[^/]*)?|\.?credentials(?:\.[^/]*)?|id_(?:rsa|ed25519|ecdsa)(?:\.pub)?|\.npmrc|\.netrc)$|\.(?:pem|key|p12|pfx|keystore|jks)$|(?:^|\/)build-test\//i
const MAX_TEXT_BYTES = 16 * 1024 * 1024

function placeholder(id, value) {
  if (value === undefined) return false
  if (id.endsWith('-path')) return PLACEHOLDER_USER.test(value)
  if (id === 'assigned-secret' && ENV_NAME.test(value)) return true
  return PLACEHOLDER_VALUE.test(value)
}

/** Scan one text blob; findings never include the matched value. */
export function scanText(path, text, rules = RULES) {
  const findings = []
  const lines = text.split(/\r?\n/)
  for (let i = 0; i < lines.length; i++)
    for (const [id, rule, group] of rules) {
      const flags = rule.flags.includes('g') ? rule.flags : rule.flags + 'g'
      for (const match of lines[i].matchAll(new RegExp(rule.source, flags))) {
        if (placeholder(id, group ? match[group] : undefined)) continue
        findings.push({ path, line: i + 1, rule: id })
        break
      }
    }
  return findings
}

/**
 * Same rules as scanText, but replace matched characters with `*`. Every rule is evaluated on the
 * original line and the union of their ranges is written once, so a narrow rule can never hide
 * the rest of a value from a wider one. Rules with a value group mask only that value (the user
 * name of a path, the credential of an assignment), so surrounding syntax stays intact. Length and
 * line breaks are kept, so offsets computed on the masked text still describe the original file.
 */
export function maskSecrets(text, rules = RULES) {
  const lines = text.split(/(\r?\n)/)
  for (let i = 0; i < lines.length; i += 2) {
    const line = lines[i]
    const hidden = new Uint8Array(line.length)
    let any = false
    for (const [id, rule, group] of rules) {
      const flags = [...new Set((rule.flags + 'gd').split(''))].join('')
      for (const match of line.matchAll(new RegExp(rule.source, flags))) {
        const value = group ? match[group] : undefined
        if (placeholder(id, value)) continue
        const [start, end] = group && match.indices[group] ? match.indices[group] : match.indices[0]
        hidden.fill(1, start, end)
        any = true
      }
    }
    if (!any) continue
    let out = ''
    for (let c = 0; c < line.length; c++) out += hidden[c] ? '*' : line[c]
    lines[i] = out
  }
  return lines.join('')
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
    if (!existsSync(full)) continue
    const stat = lstatSync(full)
    if (!stat.isFile()) continue
    // Nothing is silently skipped: an oversized file must be split or reviewed by hand.
    if (stat.size > MAX_TEXT_BYTES) {
      findings.push({ path, line: 0, rule: 'too-large-to-scan' })
      continue
    }
    const bytes = readFileSync(full)
    if (bytes.subarray(0, 8000).includes(0))
      findings.push(
        ...scanText(
          path,
          bytes.toString('latin1'),
          RULES.filter(([id]) => BINARY_RULES.has(id))
        ).map((f) => ({ ...f, line: 0 }))
      )
    else findings.push(...scanText(path, bytes.toString('utf8')))
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
