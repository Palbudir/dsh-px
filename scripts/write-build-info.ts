import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { repoRoot } from './paths'
import { sourceFingerprint } from '../src/shared/build-identity'

const root = repoRoot()
const outputs = ['main/index.js', 'preload/index.cjs', 'renderer/index.html']
const info = {
  version: JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version,
  commit: execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true
  }).trim(),
  sourceFingerprint: sourceFingerprint(root),
  outputs: Object.fromEntries(
    outputs.map((file) => [
      file,
      createHash('sha256')
        .update(readFileSync(join(root, 'out', file)))
        .digest('hex')
    ])
  )
}
writeFileSync(join(root, 'out/build-info.json'), JSON.stringify(info, null, 2) + '\n')
console.log(`Build identity: ${info.version} ${info.sourceFingerprint.slice(0, 12)}`)
