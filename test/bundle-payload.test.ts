import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { copyBundlePayload } from '../src/shared/bundle-payload'

test('Pack members copy only declared release files, never sources, links or traversal', () => {
  const root = mkdtempSync(join(tmpdir(), 'dshpx-bundle-payload-'))
  try {
    const source = join(root, 'source')
    mkdirSync(join(source, 'lib'), { recursive: true })
    const pkg = { name: 'dsh-px-example', version: '1.0.0', files: ['lib', 'cordis.patch.yml'] }
    writeFileSync(join(source, 'package.json'), JSON.stringify(pkg))
    writeFileSync(join(source, 'lib/index.js'), 'export default {}')
    writeFileSync(join(source, 'cordis.patch.yml'), '[]\n')
    writeFileSync(join(source, 'source-only.ts'), 'not a release file')
    const destination = join(root, 'destination')
    copyBundlePayload(source, destination)
    assert.equal(readFileSync(join(destination, 'lib/index.js'), 'utf8'), 'export default {}')
    assert.equal(existsSync(join(destination, 'cordis.patch.yml')), true)
    assert.equal(existsSync(join(destination, 'source-only.ts')), false)
    for (const files of [['../outside'], ['lib/*.js'], [42]]) {
      writeFileSync(join(source, 'package.json'), JSON.stringify({ ...pkg, files }))
      assert.throws(
        () => copyBundlePayload(source, join(root, 'bad-' + String(files[0]).length)),
        /确切载荷路径/
      )
    }
    writeFileSync(join(source, 'package.json'), JSON.stringify(pkg))
    // A directory junction needs no Windows symlink privilege and is still a link to reject.
    mkdirSync(join(root, 'outside'))
    symlinkSync(join(root, 'outside'), join(source, 'lib', 'linked'), 'junction')
    assert.throws(() => copyBundlePayload(source, join(root, 'linked')), /外部链接/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
