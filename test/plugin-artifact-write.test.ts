import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, linkSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { writeArtifact } from '../scripts/plugins/write-artifact.mjs'

test('plugin artifact replacement preserves an existing runtime hard link and removes temporary files', () => {
  const root = mkdtempSync(join(tmpdir(), 'px-build-artifact-')),
    output = join(root, 'index.js'),
    runtime = join(root, 'runtime.js')
  try {
    writeFileSync(output, 'previous verified artifact')
    linkSync(output, runtime)
    writeArtifact(output, 'new build artifact')
    assert.equal(readFileSync(output, 'utf8'), 'new build artifact')
    assert.equal(readFileSync(runtime, 'utf8'), 'previous verified artifact')
    assert.deepEqual(readdirSync(root).sort(), ['index.js', 'runtime.js'])
  } finally {
    assert.ok(resolve(root).startsWith(resolve(tmpdir()) + sep))
    rmSync(root, { recursive: true, force: true })
  }
})
