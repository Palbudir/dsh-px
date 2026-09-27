import { createHash, randomUUID } from 'node:crypto'
import {
  existsSync,
  lstatSync,
  readFileSync,
  realpathSync,
  renameSync,
  unlinkSync,
  writeFileSync
} from 'node:fs'
import { basename, dirname, join, parse, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { compileFunction } from 'node:vm'

/** Registry tarball and its three files were independently verified against package-lock.json. */
export const REVIEW_PARSER_SOURCE = Object.freeze({
  name: '@babel/parser',
  version: '7.29.9',
  resolved: 'https://registry.npmjs.org/@babel/parser/-/parser-7.29.9.tgz',
  integrity:
    'sha512-CjXrNHTnvqBVqHgdBysY3vk2T8tpJHb5/RMeHJBTyVa9xgugCB0CJTx/3oO8RV2QRQP391RWpB7D6hLjm8V9uA==',
  files: Object.freeze({
    'lib/index.js': '82d72e197e27bf909ae10ffc8d1a969aeb94fe96ec96c4e9cb685a0a8229e40c',
    LICENSE: '2e97627cb278aa7556fb9e8817368302301a595b6c7582512b8d74c57b773652',
    'package.json': 'fa70cca00587bdb335e8249fa40e9356ed7b7c9a4fc92b1e74245ab1b852cda1'
  })
})
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex')
const provenance = Buffer.from(JSON.stringify({ schemaVersion: 1, ...REVIEW_PARSER_SOURCE }, null, 2) + '\n')
export const REVIEW_PARSER_FILES = Object.freeze({
  'review-parser.cjs': REVIEW_PARSER_SOURCE.files['lib/index.js'],
  'review-parser-LICENSE.txt': REVIEW_PARSER_SOURCE.files.LICENSE,
  'review-parser-provenance.json': hash(provenance)
})
const here = dirname(fileURLToPath(import.meta.url))
let cachedParser

function noLinks(path) {
  const absolute = resolve(path),
    root = parse(absolute).root
  let current = root
  for (const part of absolute.slice(root.length).split(sep).filter(Boolean)) {
    current = join(current, part)
    if (lstatSync(current).isSymbolicLink()) throw new Error('Review parser paths must not contain links')
  }
}
function bytes(path, maximum = 1000000) {
  noLinks(path)
  const stat = lstatSync(path)
  if (!stat.isFile() || stat.nlink !== 1 || stat.size > maximum)
    throw new Error('Review parser input must be a private bounded regular file')
  const value = readFileSync(path)
  if (value.length !== stat.size || value.length > maximum)
    throw new Error('Review parser input changed while reading')
  return value
}
function outsideGit(directory) {
  for (let at = realpathSync(directory); ; at = dirname(at)) {
    if (existsSync(join(at, '.git'))) throw new Error('Installed review parser must be outside Git checkouts')
    if (dirname(at) === at) return
  }
}

/** Validate existing ancestors before mkdir/copy/key handling, including a not-yet-created target. */
export function preflightReviewParserDestination(directory) {
  const absolute = resolve(directory)
  let existing = absolute
  for (;;) {
    try {
      const stat = lstatSync(existing)
      if (stat.isSymbolicLink()) throw new Error('Review parser paths must not contain links')
      if (!stat.isDirectory()) throw new Error('Review parser destination must be a directory')
      break
    } catch (error) {
      if (error.code !== 'ENOENT' || dirname(existing) === existing) throw error
      existing = dirname(existing)
    }
  }
  noLinks(existing)
  outsideGit(existing)
  for (const name of Object.keys(REVIEW_PARSER_FILES)) {
    const target = join(absolute, name)
    try {
      lstatSync(target)
    } catch (error) {
      if (error.code === 'ENOENT') continue
      throw error
    }
    bytes(target)
  }
}

/** Read only this implementation checkout's exact locked dependency, never a candidate checkout. */
export function readLockedParserSource(repository) {
  const pkg = JSON.parse(bytes(join(repository, 'package.json')))
  const lock = JSON.parse(bytes(join(repository, 'package-lock.json')))
  const locked = lock.packages?.['node_modules/@babel/parser']
  if (
    pkg.name !== 'dsh-px' ||
    pkg.devDependencies?.['@babel/parser'] !== REVIEW_PARSER_SOURCE.version ||
    lock.packages?.['']?.devDependencies?.['@babel/parser'] !== REVIEW_PARSER_SOURCE.version ||
    ['version', 'resolved', 'integrity'].some((key) => locked?.[key] !== REVIEW_PARSER_SOURCE[key])
  )
    throw new Error('Review parser dependency does not match its pinned registry source')
  const directory = join(repository, 'node_modules/@babel/parser'),
    source = {}
  for (const [file, expected] of Object.entries(REVIEW_PARSER_SOURCE.files)) {
    const content = bytes(join(directory, file))
    if (hash(content) !== expected) throw new Error(`Review parser source digest mismatch: ${file}`)
    source[file] = content
  }
  return source
}

/** Validate every source first, then atomically copy the finite runtime payload without installing scripts. */
export function installReviewParser(repository, directory) {
  return copyReviewParserPayload(readLockedParserSource(repository), directory)
}

/** Installation preflight captures these bytes before any target write; copying never rereads node_modules. */
export function copyReviewParserPayload(source, directory) {
  for (const [name, expected] of Object.entries(REVIEW_PARSER_SOURCE.files))
    if (!Buffer.isBuffer(source?.[name]) || hash(source[name]) !== expected)
      throw new Error(`Review parser source digest mismatch: ${name}`)
  preflightReviewParserDestination(directory)
  const payload = {
    'review-parser.cjs': source['lib/index.js'],
    'review-parser-LICENSE.txt': source.LICENSE,
    'review-parser-provenance.json': provenance
  }
  for (const [name, content] of Object.entries(payload)) {
    const target = join(directory, name)
    if (existsSync(target)) bytes(target)
    const temporary = `${target}.${randomUUID()}.tmp`
    try {
      writeFileSync(temporary, content, { flag: 'wx', mode: 0o600, flush: true })
      renameSync(temporary, target)
    } finally {
      try {
        unlinkSync(temporary)
      } catch (error) {
        if (error.code !== 'ENOENT') throw error
      }
    }
  }
  return { ...REVIEW_PARSER_FILES }
}

/** No parser executes while core/worker/loop modules are imported. */
export function verifyReviewParserPayload(directory, manifestFiles) {
  noLinks(directory)
  outsideGit(directory)
  let code
  for (const [name, expected] of Object.entries(REVIEW_PARSER_FILES)) {
    if (manifestFiles?.[name] !== expected) throw new Error('Trusted parser manifest is missing or changed')
    const content = bytes(join(directory, name))
    if (hash(content) !== expected) throw new Error(`Trusted parser payload digest mismatch: ${name}`)
    if (name === 'review-parser.cjs') code = content
  }
  return code
}

/** Execute verified in-memory library bytes, not a second path read or candidate module resolution. */
export function loadReviewParser(directory = here) {
  let code
  if (existsSync(join(directory, 'installation.json'))) {
    const manifest = JSON.parse(bytes(join(directory, 'installation.json')))
    code = verifyReviewParserPayload(directory, manifest.files)
  } else {
    if (
      resolve(directory) !== resolve(here) ||
      basename(here) !== 'scripts' ||
      !existsSync(join(dirname(here), '.git')) ||
      existsSync(join(here, 'worker.json')) ||
      existsSync(join(here, 'public-policy.json'))
    )
      throw new Error('Trusted parser installation is missing; there is no node_modules fallback')
    code = readLockedParserSource(dirname(here))['lib/index.js']
  }
  if (!cachedParser) {
    const module = { exports: {} }
    const run = compileFunction(
      code.toString('utf8'),
      ['exports', 'module', 'require', '__filename', '__dirname'],
      { filename: join(directory, 'review-parser.cjs') }
    )
    run(
      module.exports,
      module,
      () => {
        throw new Error('Pinned parser has no permitted runtime dependencies')
      },
      join(directory, 'review-parser.cjs'),
      directory
    )
    if (typeof module.exports.parse !== 'function') throw new Error('Pinned parser API is unavailable')
    cachedParser = Object.freeze({ parse: module.exports.parse })
  }
  return cachedParser
}

/** Parse data only. Recovery ASTs are never admitted as complete dependency inventories. */
export function parseReviewSource(source, { jsx = false, filename = 'review-source.ts' } = {}) {
  return loadReviewParser().parse(source, {
    sourceType: 'unambiguous',
    sourceFilename: filename,
    errorRecovery: false,
    createImportExpressions: true,
    allowReturnOutsideFunction: /\.(?:cjs|cts|js)$/.test(filename),
    attachComment: false,
    plugins: ['typescript', ...(jsx ? ['jsx'] : [])]
  })
}
