import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import {
  existsSync,
  linkSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { gzipSync } from 'node:zlib'

const load = (name: string) => import(pathToFileURL(resolve('scripts', name)).href)
const {
  UPSTREAM_LOCK,
  upstreamLockDigest,
  tarballUrl,
  verifySri,
  readTarball,
  projectTarball,
  fetchTarball,
  loadUpstreamCatalog,
  requirePinnedHosts
} = await load('review-upstream.mjs')
const { selectUpstreamContracts, collectReviewContext, reviewHostServices } = await load('review-core.mjs')

type Entry = { name: string; body?: string | Buffer; type?: string; linkname?: string; raw?: Buffer }
/** Build a real ustar archive so the reader is exercised on genuine header layouts. */
function tar(entries: Entry[]) {
  const blocks: Buffer[] = []
  for (const entry of entries) {
    const body = entry.raw ?? Buffer.from(entry.body ?? '')
    const header = Buffer.alloc(512)
    header.write(entry.name.slice(0, 100), 0)
    header.write('0000644\0', 100)
    header.write('0000000\0', 108)
    header.write('0000000\0', 116)
    header.write(body.length.toString(8).padStart(11, '0') + '\0', 124)
    header.write('00000000000\0', 136)
    header.write(entry.type ?? '0', 156)
    if (entry.linkname) header.write(entry.linkname, 157)
    header.write('ustar\0', 257)
    header.write('00', 263)
    header.fill(' ', 148, 156)
    let sum = 0
    for (const byte of header) sum += byte
    header.write(sum.toString(8).padStart(6, '0') + '\0 ', 148)
    blocks.push(header, body, Buffer.alloc((512 - (body.length % 512)) % 512))
  }
  blocks.push(Buffer.alloc(1024))
  return Buffer.concat(blocks)
}
const sri = (bytes: Buffer) => 'sha512-' + createHash('sha512').update(bytes).digest('base64')
const pkg = (name = '@deepseek-ai/dsh-fixture', version = '0.1.5-rc.2') =>
  JSON.stringify({ name, version, license: 'MIT' })
const tgz = (entries: Entry[]) => gzipSync(tar(entries))
const pin = {
  files: ['package.json', 'lib/types/index.d.ts'],
  slices: [{ file: 'lib/index.js', anchor: 'ANCHOR(', before: 1, after: 1 }]
}
const good = () =>
  tgz([
    { name: 'package/package.json', body: pkg() },
    {
      name: 'package/lib/types/index.d.ts',
      body: 'export interface Contract { requestRejection(): 401 | 403 | undefined }'
    },
    { name: 'package/lib/index.js', body: 'one\nbefore\nANCHOR(request) {\nafter\nlast' }
  ])

test('tarball URL is derived from exact scoped identity and rejects injected names or versions', () => {
  assert.equal(
    tarballUrl('@deepseek-ai/dsh-client-connection', '0.1.5-rc.2'),
    'https://registry.npmjs.org/@deepseek-ai/dsh-client-connection/-/dsh-client-connection-0.1.5-rc.2.tgz'
  )
  for (const [name, version] of [
    ['@deepseek-ai/../evil', '0.1.5'],
    ['dsh', '0.1.5'],
    ['@deepseek-ai/dsh', '0.1.5/../../x'],
    ['@deepseek-ai/dsh', 'latest'],
    ['@deepseek-ai/dsh', '^0.1.5']
  ])
    assert.throws(() => tarballUrl(name, version), /Invalid upstream package identity/)
  assert.throws(() => tarballUrl('@deepseek-ai/dsh', '0.1.5', 'https://evil.example'), /Invalid/)
})

test('projection verifies SRI and identity and records full-file hashes and labelled slices', () => {
  const bytes = good()
  const projected = projectTarball('@deepseek-ai/dsh-fixture', '0.1.5-rc.2', sri(bytes), bytes, pin)
  assert.equal(projected.license, 'MIT')
  const slice = projected.files.find((file: any) => file.slice)
  assert.equal(slice.text, 'before\nANCHOR(request) {\nafter')
  assert.deepEqual(slice.slice, { fromLine: 2, toLine: 4, anchor: 'ANCHOR(' })
  assert.equal(
    slice.sha256,
    createHash('sha256').update('one\nbefore\nANCHOR(request) {\nafter\nlast').digest('hex'),
    'a slice carries the complete upstream file hash'
  )
  assert.throws(() => verifySri(bytes, sri(Buffer.from('other'))), /SRI mismatch/)
  assert.throws(() => verifySri(bytes, 'sha256-' + 'a'.repeat(44)), /sha512 SRI/)
  assert.throws(() => verifySri(bytes, sri(bytes) + ' ' + sri(bytes)), /sha512 SRI/)
  // A real tarball of another package or version cannot stand in for the pinned one.
  for (const identity of [pkg('@deepseek-ai/other'), pkg(undefined, '0.2.0-rc.1')]) {
    const other = tgz([{ name: 'package/package.json', body: identity }])
    assert.throws(
      () =>
        projectTarball('@deepseek-ai/dsh-fixture', '0.1.5-rc.2', sri(other), other, {
          files: ['package.json']
        }),
      /identity mismatch/
    )
  }
})

test('tar reader rejects links, traversal, absolute and duplicate entries and bad checksums', () => {
  const cases: Array<[Entry[], RegExp]> = [
    [[{ name: 'package/lib/link', type: '2', linkname: '/etc/passwd' }], /non-regular/],
    [[{ name: 'package/lib/hard', type: '1', linkname: 'package/package.json' }], /non-regular/],
    [[{ name: 'package/lib/dev', type: '3' }], /non-regular/],
    [[{ name: 'package/../escape.js', body: 'x' }], /Unsafe upstream tar path/],
    [[{ name: '/package/abs.js', body: 'x' }], /Unsafe upstream tar path/],
    [[{ name: 'other/file.js', body: 'x' }], /Unsafe upstream tar path/],
    [[{ name: 'package\\win.js', body: 'x' }], /Unsafe upstream tar path/],
    [
      [
        { name: 'package/a.js', body: '1' },
        { name: 'package/a.js', body: '2' }
      ],
      /Duplicate upstream tar entry/
    ]
  ]
  for (const [entries, error] of cases) assert.throws(() => readTarball(tar(entries)), error)
  const corrupt = tar([{ name: 'package/a.js', body: 'x' }])
  corrupt[10] ^= 1
  assert.throws(() => readTarball(corrupt), /Malformed upstream tar header/)
  // pax long path records are honoured, including traversal checks.
  const pax = (path: string) => {
    const record = ` path=${path}\n`
    const size = String(record.length + 2).length + record.length
    return `${size}${record}`
  }
  const long = 'package/' + 'd/'.repeat(60) + 'file.d.ts'
  assert.ok(
    readTarball(
      tar([
        { name: 'pax', type: 'x', body: pax(long) },
        { name: 'short', body: 'ok' }
      ])
    ).has(long.slice(8))
  )
  assert.throws(
    () =>
      readTarball(
        tar([
          { name: 'pax', type: 'x', body: pax('package/../../x') },
          { name: 'short', body: 'x' }
        ])
      ),
    /Unsafe upstream tar path/
  )
})

test('missing pinned files, ambiguous anchors, oversize files and binary contracts fail closed', () => {
  const bytes = good(),
    integrity = sri(bytes)
  assert.throws(
    () =>
      projectTarball('@deepseek-ai/dsh-fixture', '0.1.5-rc.2', integrity, bytes, {
        files: ['lib/absent.d.ts']
      }),
    /Pinned upstream contract is missing/
  )
  for (const anchor of ['NOT-PRESENT', 'e']) {
    assert.throws(
      () =>
        projectTarball('@deepseek-ai/dsh-fixture', '0.1.5-rc.2', integrity, bytes, {
          files: [],
          slices: [{ file: 'lib/index.js', anchor, before: 0, after: 0 }]
        }),
      /exactly once/
    )
  }
  const large = tgz([
    { name: 'package/package.json', body: pkg() },
    { name: 'package/big.d.ts', body: 'x'.repeat(70 * 1024) },
    { name: 'package/bin.d.ts', raw: Buffer.from([0x61, 0, 0x62]) }
  ])
  assert.throws(
    () =>
      projectTarball('@deepseek-ai/dsh-fixture', '0.1.5-rc.2', sri(large), large, { files: ['big.d.ts'] }),
    /per-file limit/
  )
  assert.throws(
    () =>
      projectTarball('@deepseek-ai/dsh-fixture', '0.1.5-rc.2', sri(large), large, { files: ['bin.d.ts'] }),
    /not text/
  )
})

test('cache is re-verified on every read, damaged entries are quarantined and offline misses block', async (t) => {
  const parent = realpathSync(tmpdir()),
    cache = mkdtempSync(join(parent, 'dshpx-upstream-cache-'))
  t.after(() => {
    assert.ok(resolve(cache).startsWith(parent + sep))
    rmSync(cache, { recursive: true, force: true })
  })
  const bytes = good(),
    integrity = sri(bytes)
  const requests: any[] = []
  const fetch = async (url: string, init: any) => {
    requests.push({ url, init })
    return { ok: true, status: 200, headers: new Map(), arrayBuffer: async () => bytes }
  }
  const name = '@deepseek-ai/dsh-fixture'
  assert.deepEqual(await fetchTarball(name, '0.1.5-rc.2', integrity, { cacheDirectory: cache, fetch }), bytes)
  assert.equal(requests.length, 1)
  assert.equal(requests[0].url, tarballUrl(name, '0.1.5-rc.2'))
  assert.equal(requests[0].init.redirect, 'error', 'redirects to other hosts are refused')
  assert.equal(requests[0].init.method, undefined, 'only a plain GET is issued')
  assert.equal(requests[0].init.body, undefined)
  await fetchTarball(name, '0.1.5-rc.2', integrity, { cacheDirectory: cache, fetch, offline: true })
  assert.equal(requests.length, 1, 'a verified cache entry is reused')
  const [file] = readdirSync(cache)
  const damaged = Buffer.from(bytes)
  damaged[damaged.length - 5] ^= 1
  writeFileSync(join(cache, file), damaged)
  await assert.rejects(
    fetchTarball(name, '0.1.5-rc.2', integrity, { cacheDirectory: cache, fetch, offline: true }),
    /not cached/
  )
  assert.ok(
    readdirSync(cache).some((entry) => entry.includes('.corrupt-')),
    'damaged cache is quarantined, not deleted'
  )
  assert.deepEqual(await fetchTarball(name, '0.1.5-rc.2', integrity, { cacheDirectory: cache, fetch }), bytes)
  assert.equal(requests.length, 2)
  // Registry substitution is rejected even when the transport succeeds; nothing is cached.
  const pinned = sri(Buffer.from('expected-other-tarball'))
  const evil = async () => ({
    ok: true,
    status: 200,
    headers: new Map(),
    arrayBuffer: async () => Buffer.from('evil')
  })
  await assert.rejects(
    fetchTarball(name, '0.1.5-rc.3', pinned, { cacheDirectory: cache, fetch: evil }),
    /SRI mismatch/
  )
  await assert.rejects(
    fetchTarball(name, '0.1.5-rc.3', pinned, { cacheDirectory: cache, fetch: evil, offline: true }),
    /not cached/
  )
  const failing = async () => ({
    ok: false,
    status: 404,
    headers: new Map(),
    arrayBuffer: async () => Buffer.alloc(0)
  })
  await assert.rejects(
    fetchTarball(name, '0.1.5-rc.4', pinned, { cacheDirectory: cache, fetch: failing }),
    /Registry returned 404/
  )
  const oversized = async () => ({
    ok: true,
    status: 200,
    headers: new Map([['content-length', String(9 * 1024 * 1024)]]),
    arrayBuffer: async () => bytes
  })
  await assert.rejects(
    fetchTarball(name, '0.1.5-rc.5', pinned, { cacheDirectory: cache, fetch: oversized }),
    /size limit/
  )
  // A linked cache entry is not accepted as trusted private state.
  const linked = join(cache, 'linked-source.tgz')
  writeFileSync(linked, bytes)
  const other = sri(Buffer.concat([bytes, Buffer.from('x')]))
  const target = join(cache, createHash('sha256').update(other).digest('hex') + '.tgz')
  linkSync(linked, target)
  await assert.rejects(
    fetchTarball(name, '0.1.5-rc.2', other, { cacheDirectory: cache, fetch, offline: true }),
    /private regular file/
  )
})

test('pinned lock covers both hosts, is immutable and its digest identifies the selection', () => {
  assert.deepEqual(UPSTREAM_LOCK.hosts, ['0.1.5-rc.2', '0.2.0-rc.1'])
  for (const [name, entry] of Object.entries<any>(UPSTREAM_LOCK.packages)) {
    for (const host of UPSTREAM_LOCK.hosts)
      assert.match(entry.integrity[host], /^sha512-[A-Za-z0-9+/]{86}==$/, name)
    assert.ok(entry.files.includes('LICENSE') && entry.files.includes('package.json'), name)
  }
  for (const names of Object.values<string[]>(UPSTREAM_LOCK.services))
    for (const name of names) assert.ok(UPSTREAM_LOCK.packages[name], name)
  assert.throws(() => {
    ;(UPSTREAM_LOCK.packages as any)['@deepseek-ai/dsh-client-connection'].files.push('x')
  }, TypeError)
  assert.match(upstreamLockDigest(), /^[a-f0-9]{64}$/)
  const changed = JSON.parse(JSON.stringify(UPSTREAM_LOCK))
  changed.packages['@deepseek-ai/dsh-client-connection'].files.pop()
  assert.notEqual(upstreamLockDigest(changed), upstreamLockDigest())
})

test('candidate hosts must be pinned; unknown or malformed product contracts block', () => {
  const catalog = {
    hosts: new Map([
      ['0.1.5-rc.2', new Map()],
      ['0.2.0-rc.1', new Map()]
    ])
  }
  assert.deepEqual(
    requirePinnedHosts(
      catalog,
      JSON.stringify({ pack: { hostVersions: ['0.1.5-rc.2'] }, desktop: { hostVersion: '0.2.0-rc.1' } })
    ),
    ['0.1.5-rc.2', '0.2.0-rc.1']
  )
  assert.throws(
    () => requirePinnedHosts(catalog, JSON.stringify({ pack: { hostVersions: ['0.1.5-rc.2', '0.3.0'] } })),
    /not pinned for declared host "0.3.0"/
  )
  assert.throws(() => requirePinnedHosts(catalog, '{bad'), /not valid JSON/)
  // A missing contract, or one whose keys declare no host at all, proves nothing is pinned.
  assert.throws(() => requirePinnedHosts(catalog, undefined), /products\.json is missing/)
  assert.throws(
    () => requirePinnedHosts(catalog, JSON.stringify({ packs: { hostVersionz: ['0.1.5-rc.2'] } })),
    /declares no host version/
  )
})

test('a streamed body without a declared length stops at the tarball limit', async () => {
  const { boundedBody } = await import(pathToFileURL(resolve('scripts/review-upstream.mjs')).href)
  let delivered = 0,
    cancelled = false
  const chunk = new Uint8Array(1024 * 1024)
  // Chunked transfer: no content-length, and far more data than the limit if read to the end.
  const response = {
    headers: new Map(),
    body: new ReadableStream({
      pull(controller) {
        delivered++
        if (delivered > 64) controller.close()
        else controller.enqueue(chunk)
      },
      cancel() {
        cancelled = true
      }
    })
  }
  await assert.rejects(boundedBody(response, 8 * 1024 * 1024), /exceeds size limit/)
  assert.ok(cancelled, 'the stream is cancelled at the limit')
  assert.ok(delivered <= 10, `read stops near the limit, read ${delivered} MiB`)
  // Within the limit the exact bytes are returned.
  const small = { headers: new Map(), body: new Response(new Uint8Array([1, 2, 3])).body }
  assert.deepEqual([...(await boundedBody(small, 8))], [1, 2, 3])
})

test('real pinned tarballs match the installed DSH 0.1.5-rc.2 runtime byte for byte', async (t) => {
  const cache = resolve('build-test', 'review-upstream-cache')
  const runtime = resolve('runtime/dsh/node_modules')
  if (!existsSync(runtime)) return t.skip('pinned runtime is not staged')
  let catalog
  try {
    catalog = await loadUpstreamCatalog({
      cacheDirectory: cache,
      offline: !process.env.DSH_PX_UPSTREAM_ONLINE
    })
  } catch (error) {
    return t.skip('upstream cache unavailable offline: ' + String((error as Error).message).slice(0, 120))
  }
  let compared = 0
  for (const [name, projected] of catalog.hosts.get('0.1.5-rc.2')) {
    for (const file of projected.files) {
      const local = join(runtime, name, file.path)
      if (!existsSync(local)) continue
      assert.equal(
        createHash('sha256').update(readFileSync(local)).digest('hex'),
        file.sha256,
        name + '/' + file.path
      )
      compared++
    }
  }
  assert.ok(compared > 40, `compared ${compared} files`)
})

test('group selection names referenced modules, host services and loader contracts once per identical file', async () => {
  const file = (text: string, host: string) => ({
    path: 'lib/types/index.d.ts',
    sha256: createHash('sha256').update(text).digest('hex'),
    bytes: text.length,
    text,
    host
  })
  const entry = (name: string, host: string, text: string) => ({
    name,
    version: host,
    tarball: tarballUrl(name, host),
    integrity: 'sha512-' + 'A'.repeat(86) + '==',
    license: 'MIT',
    files: [file(text, host)]
  })
  const catalog = {
    lockDigest: 'f'.repeat(64),
    services: {
      connection: ['@deepseek-ai/dsh-client-connection'],
      slots: ['@deepseek-ai/dsh-client-ui-slots']
    },
    manifest: ['@deepseek-ai/dsh-client-modules'],
    hosts: new Map(
      ['0.1.5-rc.2', '0.2.0-rc.1'].map((host) => [
        host,
        new Map([
          [
            '@deepseek-ai/dsh-client-connection',
            entry('@deepseek-ai/dsh-client-connection', host, 'CONNECTION_' + host)
          ],
          [
            '@deepseek-ai/dsh-client-ui-slots',
            entry('@deepseek-ai/dsh-client-ui-slots', host, 'SLOTS_SHARED')
          ],
          [
            '@deepseek-ai/dsh-client-modules',
            entry('@deepseek-ai/dsh-client-modules', host, 'LOADER_' + host)
          ]
        ])
      ])
    )
  }
  const selected = selectUpstreamContracts(catalog, {
    modules: ['@deepseek-ai/dsh-client-ui-slots', '@deepseek-ai/dsh-not-pinned/sub', 'react'],
    services: ['connection', 'mystery']
  })
  assert.deepEqual(selected.packages, [
    '@deepseek-ai/dsh-client-connection',
    '@deepseek-ai/dsh-client-ui-slots'
  ])
  assert.deepEqual(selected.unprojectedModules, ['@deepseek-ai/dsh-not-pinned'])
  assert.deepEqual(selected.unprojectedServices, ['mystery'])
  const slots = selected.files.filter((f: any) => f.name === '@deepseek-ai/dsh-client-ui-slots')
  assert.equal(slots.length, 1, 'identical upstream bytes are printed once')
  assert.deepEqual(
    slots[0].hosts.map((h: any) => h.version),
    ['0.1.5-rc.2', '0.2.0-rc.1']
  )
  assert.equal(selected.files.filter((f: any) => f.name === '@deepseek-ai/dsh-client-connection').length, 2)
  assert.deepEqual(
    reviewHostServices("ctx.inject(['connection', 'webServer'], (host) => host.slots.x)", new Set(['slots'])),
    ['connection', 'slots', 'webServer']
  )
  // End-to-end: a plugin manifest change and a Connection consumer receive labelled upstream sections.
  const tree = {
    'packages/dsh-px-a/package.json': '{"name":"dsh-px-a"}',
    'packages/dsh-px-a/src/index.ts':
      "import type { X } from '@deepseek-ai/dsh-client-ui-slots'\nctx.inject(['connection'], () => {})"
  }
  const head = 'a'.repeat(40),
    base = 'b'.repeat(40)
  const blobs = new Map<string, Buffer>()
  const list = (ref: string) =>
    Object.entries(tree).map(([path, text]) => {
      const bytes = Buffer.from(ref === head && path.endsWith('.ts') ? text + '\n// head' : text)
      blobs.set(ref + ':' + path, bytes)
      return {
        path,
        mode: '100644',
        type: 'blob',
        size: bytes.length,
        oid: createHash('sha1')
          .update(ref + path)
          .digest('hex')
      }
    })
  const reader = {
    list: async (ref: string) => list(ref),
    read: async (ref: string, path: string) => blobs.get(ref + ':' + path)!
  }
  const result = await collectReviewContext(
    {
      repository: 'fixture/repo',
      head,
      base,
      mergeBase: base,
      names: ['packages/dsh-px-a/src/index.ts', 'packages/dsh-px-a/package.json']
    },
    reader,
    {},
    [],
    { upstream: catalog }
  )
  // Upstream files are named in the header and read on demand with read_upstream, not inlined.
  assert.deepEqual(
    result.upstream.map((item: any) => item.package),
    [
      '@deepseek-ai/dsh-client-connection',
      '@deepseek-ai/dsh-client-modules',
      '@deepseek-ai/dsh-client-ui-slots'
    ]
  )
  assert.ok(result.upstream.every((item: any) => item.paths.includes('lib/types/index.d.ts')))
  assert.match(result.context, /read_upstream; trusted worker lock f{64}/)
  for (const text of ['SLOTS_SHARED', 'LOADER_0.2.0-rc.1', 'CONNECTION_'])
    assert.ok(!result.context.includes(text), text)
  const without = await collectReviewContext(
    { repository: 'fixture/repo', head, base, mergeBase: base, names: ['packages/dsh-px-a/src/index.ts'] },
    reader
  )
  assert.match(without.context, /read_upstream is unavailable/)
  assert.match(without.context, /External module references[^\n]*@deepseek-ai\/dsh-client-ui-slots/)
})
