import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { stageQqCommunity } from './stage-qq-community'

// Compare extracted bytes to the pinned derivation; tar timestamps and compression are not identities.
const original = readFileSync(resolve(process.argv[2]))
const actual = readFileSync(resolve(process.argv[3]))
const parent = realpathSync(tmpdir()),
  directory = mkdtempSync(join(parent, 'px-qq-verify-'))
function files(archive: Buffer): Map<string, string> {
  const names = execFileSync('tar', ['-tzf', '-'], { input: archive, encoding: 'utf8', windowsHide: true })
    .split(/\r?\n/)
    .filter((n) => n && !n.endsWith('/'))
  if (new Set(names).size !== names.length) throw Error('Duplicate QQ archive entries')
  return new Map(
    names.map((name) => {
      const bytes = execFileSync('tar', ['-xOzf', '-', name], {
        input: archive,
        windowsHide: true,
        maxBuffer: 32 * 1024 * 1024
      })
      return [name, createHash('sha256').update(bytes).digest('hex')]
    })
  )
}
try {
  const expected = files(stageQqCommunity(original, join(directory, 'expected')).archive),
    included = files(actual)
  if (
    expected.size !== included.size ||
    [...expected].some(([name, digest]) => included.get(name) !== digest)
  )
    throw Error('QQ archive differs from the pinned compatibility derivation')
  console.log('QQ community archive matches every pinned and derived file.')
} finally {
  if (!resolve(directory).startsWith(parent + sep)) throw Error('Invalid QQ verification cleanup path')
  rmSync(directory, { recursive: true, force: true })
}
