import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import {
  existsSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { test } from 'node:test'
import type { TestContext } from 'node:test'
import { pathToFileURL } from 'node:url'

const { ensureReleaseArchive, RELEASE_DOWNLOAD_TIMEOUT_MS, downloadCommand } = await import(
  pathToFileURL(resolve('scripts/release-assets.mjs')).href
)
const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex')
const bytes = Buffer.from('complete release archive fixture\x00\xff')

test('binary downloads preserve bytes and reject failed, timed out or oversized child output', async (t) => {
  const f = fixture(t)
  assert.equal(
    await downloadCommand(
      process.execPath,
      ['-e', 'process.stdout.write(Buffer.from([0,255,1]))'],
      f.archive
    ),
    3
  )
  assert.deepEqual(readFileSync(f.archive), Buffer.from([0, 255, 1]))
  await assert.rejects(downloadCommand(process.execPath, ['-e', 'process.exit(7)'], f.archive), /failed/)
  await assert.rejects(
    downloadCommand(process.execPath, ['-e', 'setTimeout(() => {}, 10000)'], f.archive, { timeout: 20 }),
    /timed out/
  )
  await assert.rejects(
    downloadCommand(process.execPath, ['-e', 'process.stdout.write(Buffer.alloc(100))'], f.archive, {
      maxBytes: 10
    }),
    /limit/
  )
})

function fixture(t: TestContext) {
  const parent = realpathSync(tmpdir()),
    directory = realpathSync(mkdtempSync(join(parent, 'dshpx-release-download-')))
  t.after(() => {
    assert.ok(directory.startsWith(parent + sep))
    rmSync(directory, { recursive: true, force: true })
  })
  const archive = join(directory, 'assets.zip')
  const artifact = { id: 91, size_in_bytes: bytes.length, digest: 'sha256:' + hash(bytes) }
  return {
    directory,
    archive,
    artifact,
    input: { gh: 'fixture-gh', repository: 'fixture/repo', artifact, archive }
  }
}

test('complete cache is reused only against current GitHub size and digest, not a local manifest', async (t) => {
  const f = fixture(t)
  writeFileSync(f.archive, bytes)
  writeFileSync(
    join(f.directory, 'release-manifest.json'),
    JSON.stringify({ files: [{ name: 'assets.zip', sha256: 'untrusted-local-value' }] })
  )
  const result = await ensureReleaseArchive(f.input, async () =>
    assert.fail('valid remote-bound cache must not download again')
  )
  assert.deepEqual(result, { reused: true, size: bytes.length })
  assert.deepEqual(readFileSync(f.archive), bytes)
})

test('missing, partial and same-size corrupt caches use one bounded 30-minute download', async (t) => {
  for (const mode of ['missing', 'partial', 'corrupt']) {
    await t.test(mode, async (t) => {
      const f = fixture(t)
      if (mode === 'partial') writeFileSync(f.archive, bytes.subarray(0, 5))
      if (mode === 'corrupt') writeFileSync(f.archive, Buffer.alloc(bytes.length, 120))
      let downloads = 0
      const result = await ensureReleaseArchive(
        f.input,
        async (exe: string, args: string[], file: string, options: { timeout: number; maxBytes: number }) => {
          downloads++
          assert.equal(exe, 'fixture-gh')
          assert.deepEqual(args, ['api', 'repos/fixture/repo/actions/artifacts/91/zip'])
          assert.equal(file, f.archive)
          assert.equal(options.timeout, 1800000)
          assert.equal(options.maxBytes, bytes.length)
          writeFileSync(file, bytes)
          return bytes.length
        }
      )
      assert.equal(RELEASE_DOWNLOAD_TIMEOUT_MS, 1800000)
      assert.equal(downloads, 1)
      assert.deepEqual(result, { reused: false, size: bytes.length })
      assert.deepEqual(readFileSync(f.archive), bytes)
    })
  }
})

test('archive links are rejected before a download can overwrite their targets', async (t) => {
  const kinds =
    process.platform === 'win32'
      ? ['junction', 'hardlink', 'dangling-junction']
      : ['symlink', 'hardlink', 'dangling-symlink']
  for (const kind of kinds) {
    await t.test(kind, async (t) => {
      const f = fixture(t),
        target = join(f.directory, 'protected-target')
      const directoryLink = kind.includes('junction'),
        dangling = kind.startsWith('dangling-')
      const protectedFile = directoryLink ? join(target, 'untouched') : target
      if (!dangling) {
        if (directoryLink) mkdirSync(target)
        writeFileSync(protectedFile, bytes)
      }
      if (kind === 'hardlink') linkSync(target, f.archive)
      else symlinkSync(target, f.archive, directoryLink ? 'junction' : 'file')
      await assert.rejects(
        ensureReleaseArchive(f.input, async () =>
          assert.fail('linked destination must never be passed to downloader')
        ),
        /private regular file without links/
      )
      if (!dangling) assert.deepEqual(readFileSync(protectedFile), bytes)
      else assert.equal(existsSync(target), false)
    })
  }
})

test('a linked ancestor directory and a non-file cache are refused without writes', async (t) => {
  const f = fixture(t),
    target = join(f.directory, 'target-directory'),
    linked = join(f.directory, 'linked-directory')
  mkdirSync(target)
  symlinkSync(target, linked, process.platform === 'win32' ? 'junction' : 'dir')
  await assert.rejects(
    ensureReleaseArchive({ ...f.input, archive: join(linked, 'assets.zip') }, async () =>
      assert.fail('linked parent must be rejected')
    ),
    /directory must not contain filesystem links/
  )
  assert.equal(existsSync(join(target, 'assets.zip')), false)
  mkdirSync(f.archive)
  await assert.rejects(
    ensureReleaseArchive(f.input, async () => assert.fail('directory is not an archive')),
    /private regular file/
  )
})

test('downloaded size or digest mismatch remains a failure and preserves downloaded bytes for diagnosis', async (t) => {
  for (const content of [bytes.subarray(0, 4), Buffer.alloc(bytes.length, 123)]) {
    await t.test(content.length === bytes.length ? 'digest' : 'size', async (t) => {
      const f = fixture(t)
      await assert.rejects(
        ensureReleaseArchive(f.input, async (_exe: string, _args: string[], file: string) => {
          writeFileSync(file, content)
          return content.length
        }),
        /size or digest differs from GitHub/
      )
      assert.deepEqual(readFileSync(f.archive), content)
    })
  }
})

test('timeout preserves partial bytes, retry downloads normally and the verified result is reusable', async (t) => {
  const f = fixture(t),
    partial = bytes.subarray(0, 7)
  await assert.rejects(
    ensureReleaseArchive(
      f.input,
      async (_exe: string, _args: string[], file: string, options: { timeout: number }) => {
        assert.equal(options.timeout, 1800000)
        writeFileSync(file, partial)
        throw new Error('Artifact download timed out')
      }
    ),
    /timed out/
  )
  assert.deepEqual(readFileSync(f.archive), partial)
  const retry = await ensureReleaseArchive(f.input, async (_exe: string, _args: string[], file: string) => {
    writeFileSync(file, bytes)
    return bytes.length
  })
  assert.equal(retry.reused, false)
  const cached = await ensureReleaseArchive(f.input, async () =>
    assert.fail('successful retry should be reusable')
  )
  assert.equal(cached.reused, true)
})

test('invalid or absent remote identity cannot authorize cache reuse or downloading', async (t) => {
  const changes = [
    { id: 0 },
    { size_in_bytes: 0 },
    { size_in_bytes: 2_000_000_001 },
    { size_in_bytes: undefined },
    { digest: undefined },
    { digest: 'sha256:not-a-digest' }
  ]
  for (const change of changes) {
    await t.test(Object.keys(change)[0] + ':' + Object.values(change)[0], async (t) => {
      const f = fixture(t)
      writeFileSync(f.archive, bytes)
      await assert.rejects(
        ensureReleaseArchive({ ...f.input, artifact: { ...f.artifact, ...change } }, async () =>
          assert.fail('remote identity must validate first')
        ),
        /bounded size and SHA-256 digest/
      )
      assert.deepEqual(readFileSync(f.archive), bytes)
    })
  }
})
