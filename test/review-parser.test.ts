import { test, type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import {
  copyFileSync,
  existsSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'

const parserModule = resolve('scripts/review-parser.mjs')
const {
  REVIEW_PARSER_FILES,
  REVIEW_PARSER_PACKAGE_JSON,
  REVIEW_PARSER_SOURCE,
  installReviewParser,
  loadReviewParser,
  readLockedParserSource
} = await import(pathToFileURL(parserModule).href)
const hash = (value: Buffer) => createHash('sha256').update(value).digest('hex')

function fixture(t: TestContext) {
  const parent = realpathSync(tmpdir()),
    root = mkdtempSync(join(parent, 'dshpx-parser-fixture-'))
  const installed = join(root, 'trusted'),
    source = join(root, 'source')
  mkdirSync(installed)
  mkdirSync(join(source, 'node_modules/@babel/parser/lib'), { recursive: true })
  copyFileSync(resolve('package.json'), join(source, 'package.json'))
  copyFileSync(resolve('package-lock.json'), join(source, 'package-lock.json'))
  for (const file of Object.keys(REVIEW_PARSER_SOURCE.files))
    copyFileSync(
      resolve('node_modules/@babel/parser', file),
      join(source, 'node_modules/@babel/parser', file)
    )
  t.after(() => {
    assert.ok(resolve(root).startsWith(parent + sep))
    rmSync(root, { recursive: true, force: true })
  })
  const install = () => {
    const files = installReviewParser(source, installed)
    writeFileSync(join(installed, 'installation.json'), JSON.stringify({ files }))
    return files
  }
  return { root, installed, source, install }
}

test('embedded official package metadata is byte-identical to the pinned source and supplies its standalone contract', () => {
  const metadataBytes = Buffer.from(REVIEW_PARSER_PACKAGE_JSON, 'utf8')
  assert.equal(metadataBytes.length, 1382)
  assert.equal(hash(metadataBytes), 'fa70cca00587bdb335e8249fa40e9356ed7b7c9a4fc92b1e74245ab1b852cda1')
  assert.deepEqual(metadataBytes, readLockedParserSource(resolve('.'))['package.json'])
  const metadata = JSON.parse(REVIEW_PARSER_PACKAGE_JSON)
  assert.equal(metadata.name, '@babel/parser')
  assert.equal(metadata.version, REVIEW_PARSER_SOURCE.version)
  assert.equal(metadata.main, './lib/index.js')
  assert.equal(metadata.type, 'commonjs')
  assert.deepEqual(metadata.dependencies, { '@babel/types': '^7.29.8' })
  assert.equal(
    metadata['# dependencies'],
    "This package doesn't actually have runtime dependencies. @babel/types is only needed for type definitions."
  )
})

test('altered embedded metadata is rejected before any installed parser can be loaded', async (t) => {
  const f = fixture(t),
    modified = join(f.root, 'review-parser.mjs')
  const original = readFileSync(parserModule, 'utf8')
  const changed = original.replace(
    "This package doesn't actually have runtime dependencies.",
    'Unverified metadata statement.'
  )
  assert.notEqual(changed, original)
  writeFileSync(modified, changed)
  await assert.rejects(
    import(pathToFileURL(modified).href),
    /Embedded parser package metadata digest mismatch/
  )
})

function installerCli(t: TestContext) {
  const f = fixture(t),
    helper = join(f.root, 'invoke-installer.mjs')
  const paths = [
    'scripts/review-install.mjs',
    'scripts/review-parser.mjs',
    'scripts/review-process.mjs',
    'scripts/review-model.mjs',
    'scripts/review-core.mjs',
    'scripts/review-diff.mjs',
    'scripts/review-tools.mjs',
    'scripts/release-quality.mjs',
    'scripts/release-catalog.mjs',
    'scripts/release-package.mjs',
    'scripts/release-version.mjs',
    'scripts/release-gate.mjs',
    'scripts/build-native-pack.ts',
    'scripts/prepare-native-desktop.mjs',
    'scripts/verify-native-pack-install.mjs',
    'scripts/brand-native-installer.mjs',
    'scripts/brand-installer-images.ps1',
    'scripts/build-icon.ts',
    'scripts/check-secrets.mjs',
    'scripts/run.mjs',
    '.github/workflows/trusted-quality.yml',
    '.github/workflows/release.yml'
  ]
  for (const path of paths) {
    mkdirSync(dirname(join(f.source, path)), { recursive: true })
    copyFileSync(resolve(path), join(f.source, path))
  }
  writeFileSync(
    helper,
    `import cp from 'node:child_process';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { syncBuiltinESMExports } from 'node:module';
import { pathToFileURL } from 'node:url';
import { writeFileSync } from 'node:fs';
const [installer,destination,mutate,...extra]=process.argv.slice(2);
let calls=0;
cp.spawn=(exe,args)=>{
  calls++;
  const child=new EventEmitter();
  child.stdout=new PassThrough(); child.stderr=new PassThrough(); child.stdin=new PassThrough(); child.kill=()=>true;
  process.nextTick(()=>{
    if(args[0]==='api' && args[1]==='user'){
      if(mutate)writeFileSync(mutate,'CHANGED_AFTER_PREFLIGHT');
      child.stdout.end(JSON.stringify({login:'fixture'}));
    }
    else throw Error('Unexpected isolated command');
    child.emit('close',0);
  });
  return child;
};
syncBuiltinESMExports();
process.argv=[process.execPath,installer,'--directory='+destination,'--git='+process.execPath,'--gh='+process.execPath,...extra];
try { await import(pathToFileURL(installer).href); console.log(JSON.stringify({ok:true,calls})); }
catch(error){ console.log(JSON.stringify({ok:false,calls,error:String(error)})); process.exitCode=1; }
`
  )
  const run = (destination: string, mutate = '', extra: string[] = []) => {
    const child = spawnSync(
      process.execPath,
      [helper, join(f.source, 'scripts/review-install.mjs'), destination, mutate, ...extra],
      {
        windowsHide: true,
        encoding: 'utf8',
        timeout: 15000,
        env: {
          ...process.env,
          DSHPX_INSTALL_FIXTURE_KEY: 'install-fixture-secret-value',
          NODE_OPTIONS: '',
          NODE_PATH: '',
          GH_TOKEN: '',
          GITHUB_TOKEN: ''
        }
      }
    )
    assert.equal(child.error, undefined)
    const result = JSON.parse(child.stdout.trim().split(/\r?\n/).at(-1)!)
    return { ...result, status: child.status }
  }
  return { ...f, run }
}

test('installer CLI rejects every bad parser source before mkdir, key handling or overwriting existing installation bytes', (t) => {
  const f = installerCli(t)
  writeFileSync(join(f.installed, 'worker.json'), '{}')
  writeFileSync(join(f.installed, 'review-core.mjs'), 'OLD_APPROVED_SCRIPT\n')
  writeFileSync(join(f.installed, 'installation.json'), '{"unchanged":true}\n')
  const snapshot = () =>
    Object.fromEntries(
      readdirSync(f.installed)
        .sort()
        .map((name) => [name, readFileSync(join(f.installed, name)).toString('base64')])
    )
  const before = snapshot(),
    fresh = join(f.root, 'must-not-be-created')
  const changes = [
    'package.json',
    'package-lock.json',
    ...Object.keys(REVIEW_PARSER_SOURCE.files).map((name) => 'node_modules/@babel/parser/' + name)
  ]
  const keyArgs = [
    '--app-id=1',
    '--installation-id=2',
    '--repository-id=3',
    '--app-private-key=' + join(f.root, 'must-not-be-read.pem')
  ]
  for (const name of changes) {
    const path = join(f.source, name),
      original = readFileSync(path)
    if (name === 'package.json' || name === 'package-lock.json') {
      const value = JSON.parse(original.toString())
      if (name === 'package.json') value.devDependencies['@babel/parser'] = '^7.29.9'
      else value.packages['node_modules/@babel/parser'].integrity = 'sha512-wrong'
      writeFileSync(path, JSON.stringify(value))
    } else writeFileSync(path, Buffer.concat([original, Buffer.from('\ncorrupt')]))
    for (const target of [f.installed, fresh]) {
      const result = f.run(target, '', keyArgs)
      assert.equal(result.status, 1, name)
      assert.equal(result.ok, false)
      assert.equal(result.calls, 0, 'preflight precedes even fake publisher/CLI calls')
      assert.match(result.error, /pinned registry|digest mismatch/, name)
      assert.deepEqual(snapshot(), before)
      assert.equal(existsSync(fresh), false, 'invalid source cannot create a fresh destination')
      assert.equal(existsSync(join(f.installed, 'signing-key.pem')), false)
      assert.equal(existsSync(join(f.installed, 'github-app.pem')), false)
    }
    writeFileSync(path, original)
  }
})

test('installer CLI copies its validated memory snapshot even if source files change during later publisher lookup', (t) => {
  const f = installerCli(t),
    path = join(f.source, 'node_modules/@babel/parser/lib/index.js')
  const result = f.run(f.installed, path)
  assert.equal(result.status, 0, result.error)
  assert.equal(result.ok, true)
  assert.equal(result.calls, 1, 'only the isolated fake publisher command')
  assert.equal(readFileSync(path, 'utf8'), 'CHANGED_AFTER_PREFLIGHT')
  assert.equal(
    hash(readFileSync(join(f.installed, 'review-parser.cjs'))),
    REVIEW_PARSER_FILES['review-parser.cjs']
  )
  const manifest = JSON.parse(readFileSync(join(f.installed, 'installation.json'), 'utf8'))
  for (const [name, expected] of Object.entries(REVIEW_PARSER_FILES))
    assert.equal(manifest.files[name], expected)
  assert.equal(typeof loadReviewParser(f.installed).parse, 'function')
})

test('installer records only the DeepSeek model identity and key variable name, never the key value', (t) => {
  const f = installerCli(t)
  const result = f.run(f.installed, '', ['--api-key-env=DSHPX_INSTALL_FIXTURE_KEY'])
  assert.equal(result.status, 0, result.error)
  const config = JSON.parse(readFileSync(join(f.installed, 'worker.json'), 'utf8'))
  assert.deepEqual(config.model, {
    provider: 'deepseek',
    model: 'deepseek-flash',
    baseUrl: 'https://api.deepseek.com',
    apiKeyEnv: 'DSHPX_INSTALL_FIXTURE_KEY'
  })
  for (const legacy of ['codex', 'authHome', 'cliVersion', 'codexOverrides', 'codexEnvKeys'])
    assert.equal(legacy in config, false, legacy)
  for (const name of readdirSync(f.installed))
    assert.doesNotMatch(readFileSync(join(f.installed, name), 'latin1'), /install-fixture-secret-value/, name)
  const fresh = join(f.root, 'insecure-model-endpoint')
  for (const bad of ['--base-url=http://api.deepseek.com', '--api-key-env=GH_TOKEN', '--model=bad model']) {
    const rejected = f.run(fresh, '', [bad])
    assert.equal(rejected.status, 1, bad)
    assert.equal(rejected.calls, 0, 'model settings are validated before any command')
    assert.match(rejected.error, /https|GitHub credentials|model name/, bad)
    assert.equal(existsSync(fresh), false, 'invalid model settings cannot create an installation')
  }
})

test('installer CLI rejects Git placement and linked destinations before mutating old scripts or keys', (t) => {
  const f = installerCli(t),
    checkout = join(f.root, 'other-checkout'),
    gitTarget = join(checkout, 'trusted')
  mkdirSync(join(checkout, '.git'), { recursive: true })
  mkdirSync(gitTarget)
  const populate = (directory: string) => {
    writeFileSync(join(directory, 'review-core.mjs'), 'OLD_APPROVED_CORE')
    writeFileSync(join(directory, 'signing-key.pem'), 'EXISTING_PRIVATE_KEY_MUST_NOT_BE_READ')
    writeFileSync(join(directory, 'worker.json'), '{}')
  }
  populate(gitTarget)
  populate(f.installed)
  const snapshot = (directory: string) =>
    Object.fromEntries(
      readdirSync(directory)
        .sort()
        .map((name) => [name, readFileSync(join(directory, name)).toString('base64')])
    )
  const gitBefore = snapshot(gitTarget),
    trustedBefore = snapshot(f.installed)
  const link = join(f.root, 'linked-trusted'),
    parentLink = join(f.root, 'linked-parent')
  symlinkSync(f.installed, link, process.platform === 'win32' ? 'junction' : 'dir')
  const container = join(f.root, 'container')
  mkdirSync(container)
  symlinkSync(container, parentLink, process.platform === 'win32' ? 'junction' : 'dir')
  const freshGit = join(checkout, 'fresh', 'install'),
    freshLink = join(parentLink, 'fresh', 'install')
  for (const target of [gitTarget, freshGit, link, freshLink]) {
    const result = f.run(target)
    assert.equal(result.status, 1)
    assert.equal(result.calls, 0)
    assert.match(result.error, /outside Git checkouts|must not contain links/)
    assert.deepEqual(snapshot(gitTarget), gitBefore)
    assert.deepEqual(snapshot(f.installed), trustedBefore)
    assert.equal(existsSync(join(checkout, 'fresh')), false)
    assert.equal(existsSync(join(container, 'fresh')), false)
  }
  const sharedParser = join(f.root, 'shared-parser.cjs')
  writeFileSync(sharedParser, 'SHARED_PAYLOAD_MUST_NOT_BE_OVERWRITTEN')
  linkSync(sharedParser, join(f.installed, 'review-parser.cjs'))
  const linkedBefore = snapshot(f.installed),
    result = f.run(f.installed)
  assert.equal(result.status, 1)
  assert.equal(result.calls, 0)
  assert.match(result.error, /private bounded regular file/)
  assert.deepEqual(snapshot(f.installed), linkedBefore)
  assert.equal(readFileSync(sharedParser, 'utf8'), 'SHARED_PAYLOAD_MUST_NOT_BE_OVERWRITTEN')
})

test('locked parser installation contains only the exact implementation, license and source provenance', (t) => {
  const f = fixture(t),
    files = f.install()
  assert.deepEqual(Object.keys(files).sort(), [
    'review-parser-LICENSE.txt',
    'review-parser-provenance.json',
    'review-parser.cjs'
  ])
  for (const [name, digest] of Object.entries(files))
    assert.equal(hash(readFileSync(join(f.installed, name))), digest)
  assert.deepEqual(JSON.parse(readFileSync(join(f.installed, 'review-parser-provenance.json'), 'utf8')), {
    schemaVersion: 1,
    ...REVIEW_PARSER_SOURCE
  })
  assert.match(
    readFileSync(join(f.installed, 'review-parser-LICENSE.txt'), 'utf8'),
    /Permission is hereby granted, free of charge/
  )
  const parser = loadReviewParser(f.installed)
  const marker = `parserCandidate_${randomUUID().replaceAll('-', '')}`
  const ast = parser.parse(
    `globalThis.${marker} = true; if (enabled) /[//]/.test(value); import './guard.js';`,
    { sourceType: 'module' }
  )
  assert.equal(ast.program.body.at(-1).source.value, './guard.js')
  assert.equal(Reflect.get(globalThis, marker), undefined, 'candidate source is parsed without execution')
})

test('all pinned sources and both dependency declarations are validated before any installation write', (t) => {
  const f = fixture(t)
  const inputs = [
    'package.json',
    'package-lock.json',
    ...Object.keys(REVIEW_PARSER_SOURCE.files).map((name) => 'node_modules/@babel/parser/' + name)
  ]
  for (const name of inputs) {
    const path = join(f.source, name),
      original = readFileSync(path)
    if (name === 'package.json' || name === 'package-lock.json') {
      const value = JSON.parse(original.toString())
      if (name === 'package.json') value.devDependencies['@babel/parser'] = '^7.29.9'
      else value.packages['node_modules/@babel/parser'].integrity = 'sha512-wrong'
      writeFileSync(path, JSON.stringify(value))
    } else writeFileSync(path, Buffer.concat([original, Buffer.from('\nmodified')]))
    assert.throws(() => installReviewParser(f.source, f.installed), /pinned registry|digest mismatch/, name)
    assert.deepEqual(readdirSync(f.installed), [], 'bad input must not partially overwrite an installation')
    writeFileSync(path, original)
  }
  const lockPath = join(f.source, 'package-lock.json'),
    lock = JSON.parse(readFileSync(lockPath, 'utf8'))
  delete lock.packages[''].devDependencies['@babel/parser']
  writeFileSync(lockPath, JSON.stringify(lock))
  assert.throws(() => readLockedParserSource(f.source), /pinned registry/)
})

test('installed parser missing or tampered bytes and a forged digest never fall back, even after cache warmup', (t) => {
  const f = fixture(t)
  f.install()
  loadReviewParser(f.installed)
  for (const name of Object.keys(REVIEW_PARSER_FILES)) {
    const path = join(f.installed, name),
      original = readFileSync(path)
    rmSync(path)
    assert.throws(() => loadReviewParser(f.installed), /ENOENT/, name)
    writeFileSync(path, Buffer.from('globalThis.untrustedParserExecuted = true;'))
    assert.throws(() => loadReviewParser(f.installed), /digest mismatch/, name)
    writeFileSync(path, original)
  }
  const forged = {
    ...REVIEW_PARSER_FILES,
    'review-parser.cjs': hash(Buffer.from('globalThis.untrustedParserExecuted = true;'))
  }
  writeFileSync(join(f.installed, 'review-parser.cjs'), 'globalThis.untrustedParserExecuted = true;')
  writeFileSync(join(f.installed, 'installation.json'), JSON.stringify({ files: forged }))
  assert.throws(() => loadReviewParser(f.installed), /manifest is missing or changed/)
  assert.equal(Reflect.get(globalThis, 'untrustedParserExecuted'), undefined)
})

test('parser module import is inert; an external folder named scripts cannot enter development fallback', async (t) => {
  const f = fixture(t),
    scripts = join(f.root, 'scripts')
  mkdirSync(scripts)
  copyFileSync(parserModule, join(scripts, 'review-parser.mjs'))
  const isolated = await import(pathToFileURL(join(scripts, 'review-parser.mjs')).href)
  assert.throws(() => isolated.loadReviewParser(), /there is no node_modules fallback/)
  mkdirSync(join(f.root, '.git'))
  writeFileSync(join(scripts, 'worker.json'), '{}')
  assert.throws(() => isolated.loadReviewParser(), /there is no node_modules fallback/)
  rmSync(join(scripts, 'worker.json'))
  writeFileSync(join(scripts, 'public-policy.json'), '{}')
  assert.throws(() => isolated.loadReviewParser(), /there is no node_modules fallback/)
  assert.equal(existsSync(join(f.root, 'node_modules')), false)
})

test('linked source or installation containers and hardlinked payload files are rejected', (t) => {
  const f = fixture(t)
  f.install()
  const name = 'review-parser.cjs',
    path = join(f.installed, name),
    other = join(f.root, 'shared-parser.cjs')
  copyFileSync(path, other)
  rmSync(path)
  linkSync(other, path)
  assert.throws(() => loadReviewParser(f.installed), /private bounded regular file/)
  rmSync(path)
  copyFileSync(other, path)
  const alias = join(f.root, 'linked-trusted')
  symlinkSync(f.installed, alias, process.platform === 'win32' ? 'junction' : 'dir')
  assert.throws(() => loadReviewParser(alias), /must not contain links/)
  const sourceAlias = join(f.root, 'linked-source')
  symlinkSync(f.source, sourceAlias, process.platform === 'win32' ? 'junction' : 'dir')
  assert.throws(() => readLockedParserSource(sourceAlias), /must not contain links/)
})

test('parser installed mode rejects omitted license/provenance entries and Git checkout placement', (t) => {
  const f = fixture(t)
  f.install()
  for (const omitted of Object.keys(REVIEW_PARSER_FILES)) {
    const files = { ...REVIEW_PARSER_FILES }
    delete files[omitted]
    writeFileSync(join(f.installed, 'installation.json'), JSON.stringify({ files }))
    assert.throws(() => loadReviewParser(f.installed), /manifest is missing or changed/)
  }
  writeFileSync(join(f.installed, 'installation.json'), JSON.stringify({ files: REVIEW_PARSER_FILES }))
  mkdirSync(join(f.root, '.git'))
  assert.throws(() => loadReviewParser(f.installed), /outside Git checkouts/)
  assert.throws(() => installReviewParser(f.source, f.installed), /outside Git checkouts/)
})
