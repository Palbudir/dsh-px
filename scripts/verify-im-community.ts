import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { stageImCommunity } from './stage-im-community'

const original = readFileSync(resolve(process.argv[2])),
  actual = readFileSync(resolve(process.argv[3]))
const parent = realpathSync(tmpdir()),
  directory = mkdtempSync(join(parent, 'px-im-verify-'))
function files(bytes: Buffer, label: string): Map<string, string> {
  const archive = join(directory, label + '.tgz'),
    output = join(directory, label)
  writeFileSync(archive, bytes)
  const names = execFileSync('tar', ['-tzf', archive], {
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 4e6
  })
    .split(/\r?\n/)
    .filter(Boolean)
  if (
    !names.length ||
    names.length > 20000 ||
    new Set(names).size !== names.length ||
    names.some(
      (name) =>
        !name.startsWith('package/') ||
        /[\\:\0]/.test(name) ||
        name.split('/').some((p) => p === '..' || p === '.')
    )
  )
    throw Error('Invalid IM archive entries')
  const listing = execFileSync('tar', ['-tvzf', archive], {
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 8e6
  })
    .split(/\r?\n/)
    .filter(Boolean)
  if (listing.length !== names.length || listing.some((row) => !['-', 'd'].includes(row[0])))
    throw Error('IM archive must contain regular files and directories only')
  mkdirSync(output)
  execFileSync('tar', ['-xzf', archive, '-C', output], { windowsHide: true })
  return new Map(
    names
      .filter((name) => !name.endsWith('/'))
      .map((name) => [
        name,
        createHash('sha256')
          .update(readFileSync(join(output, name)))
          .digest('hex')
      ])
  )
}
let passed = false
try {
  const expected = files(stageImCommunity(original, join(directory, 'rebuilt')).archive, 'expected'),
    included = files(actual, 'actual')
  if (
    expected.size !== included.size ||
    [...expected].some(([name, digest]) => included.get(name) !== digest)
  )
    throw Error('IM archive differs from the pinned compatibility derivation')
  passed = true
  console.log('IM community archive matches every original and derived file.')
} finally {
  if (!resolve(directory).startsWith(parent + sep)) throw Error('Invalid IM verification directory')
  if (passed) rmSync(directory, { recursive: true, force: true })
  else console.error('IM verification evidence retained:', directory)
}
