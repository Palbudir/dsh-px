import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import driver from '../config/computer-driver.json'
import { repoRoot } from './paths'

/** Verified upstream binaries belong to release payloads, never the source checkout or runtime downloads. */
export async function stageComputerDriver(
  member: string,
  scratch: string,
  archiveFile?: string
): Promise<void> {
  const manifestFile = join(member, 'package.json')
  const manifest = JSON.parse(readFileSync(manifestFile, 'utf8'))
  if (manifest.dependencies?.['@trycua/cua-driver'] !== driver.version)
    throw Error('Computer SDK and native executable versions differ')
  const bytes = archiveFile
    ? readFileSync(resolve(archiveFile))
    : await (async () => {
        const response = await fetch(driver.url, { signal: AbortSignal.timeout(120000) })
        if (!response.ok) throw Error(`Computer driver download failed: ${response.status}`)
        return Buffer.from(await response.arrayBuffer())
      })()
  if (createHash('sha256').update(bytes).digest('hex') !== driver.sha256)
    throw Error('Computer driver archive integrity mismatch')
  mkdirSync(scratch)
  const archive = join(scratch, 'driver.zip')
  writeFileSync(archive, bytes, { flag: 'wx' })
  const unpacked = join(scratch, 'unpacked')
  mkdirSync(unpacked)
  if (process.platform === 'win32')
    execFileSync('tar', ['-xf', archive, '-C', unpacked], { windowsHide: true })
  else execFileSync('unzip', ['-q', archive, '-d', unpacked])
  const target = join(member, 'native', driver.platform)
  mkdirSync(target, { recursive: true })
  for (const [file, expected] of Object.entries(driver.files)) {
    const source = join(unpacked, file)
    if (createHash('sha256').update(readFileSync(source)).digest('hex') !== expected)
      throw Error(`Computer driver executable integrity mismatch: ${file}`)
    copyFileSync(source, join(target, file))
  }
  const windows = process.platform === 'win32'
  const compiler = windows
    ? join(process.env.SystemRoot ?? 'C:\\Windows', 'Microsoft.NET/Framework64/v4.0.30319/csc.exe')
    : 'mcs'
  const flag = windows ? '/' : '-'
  const inputFile = join(target, 'px-windows-input.exe')
  execFileSync(
    compiler,
    [
      flag + 'nologo',
      flag + 'target:exe',
      flag + 'platform:x64',
      flag + 'out:' + inputFile,
      flag + 'r:System.Web.Extensions.dll',
      flag + 'r:System.Drawing.dll',
      join(repoRoot(), 'packages/dsh-px-computer/native/windows-input.cs'),
      join(repoRoot(), 'packages/dsh-px-computer/native/windows-controls.cs'),
      join(repoRoot(), 'packages/dsh-px-computer/native/windows-view.cs')
    ],
    { windowsHide: true }
  )
  const input = { sha256: createHash('sha256').update(readFileSync(inputFile)).digest('hex') }
  writeFileSync(join(target, 'manifest.json'), JSON.stringify({ ...driver, input }, null, 2) + '\n')
  // Generated release members declare the additional files, so split feature archives include them too.
  manifest.files = [...new Set([...(manifest.files ?? []), 'native'])]
  writeFileSync(manifestFile, JSON.stringify(manifest, null, 2) + '\n')
}
