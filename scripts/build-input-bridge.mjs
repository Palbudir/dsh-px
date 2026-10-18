/** Build the optional input-only Fabric adapter with a verified Gradle distribution and Java 25. */
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import {
  mkdirSync,
  readFileSync,
  writeFileSync,
  existsSync,
  copyFileSync,
  mkdtempSync,
  rmSync
} from 'node:fs'
import { join, resolve, dirname, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const cache = join(root, 'build-test', 'bridge-toolchain')
mkdirSync(cache, { recursive: true })
const version = '9.6.0'
const digest = 'bbaeb2fef8710818cf0e261201dab964c572f92b942812df0c3620d62a529a01'
const archive = join(cache, `gradle-${version}-bin.zip`)
if (!existsSync(archive)) {
  const response = await fetch(`https://services.gradle.org/distributions/gradle-${version}-bin.zip`, {
    signal: AbortSignal.timeout(180000)
  })
  if (!response.ok) throw Error(`Gradle download failed: ${response.status}`)
  const bytes = Buffer.from(await response.arrayBuffer())
  if (createHash('sha256').update(bytes).digest('hex') !== digest)
    throw Error('Gradle archive digest mismatch')
  writeFileSync(archive, bytes, { flag: 'wx' })
}
if (createHash('sha256').update(readFileSync(archive)).digest('hex') !== digest)
  throw Error('Cached Gradle digest mismatch')
// Extract a fresh verified toolchain; never trust executables left behind by another build.
const extracted = mkdtempSync(join(cache, 'run-'))
execFileSync(
  process.platform === 'win32' ? 'tar' : 'unzip',
  process.platform === 'win32' ? ['-xf', archive, '-C', extracted] : ['-q', archive, '-d', extracted],
  { windowsHide: true }
)
const java = process.env.JAVA_HOME
  ? join(process.env.JAVA_HOME, 'bin', process.platform === 'win32' ? 'java.exe' : 'java')
  : 'java'
const env = { ...process.env }
for (const key of Object.keys(env)) if (/API_KEY|TOKEN|SECRET|PASSWORD/i.test(key)) delete env[key]
const project = join(root, 'integrations', 'minecraft-input')
try {
  execFileSync(
    java,
    [
      '-jar',
      join(extracted, `gradle-${version}`, 'lib', `gradle-gradle-cli-main-${version}.jar`),
      '-p',
      project,
      'clean',
      'build',
      '--no-daemon'
    ],
    { windowsHide: true, stdio: 'inherit', env }
  )
} finally {
  if (!resolve(extracted).startsWith(resolve(cache) + sep)) throw Error('Invalid toolchain scratch path')
  try {
    rmSync(extracted, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 })
  } catch (error) {
    if (!['EPERM', 'EBUSY'].includes(error.code)) throw error
    console.warn('Gradle is still releasing its verified toolchain; retained scratch directory:', extracted)
  }
}
const file = join(project, 'build', 'libs', 'px-input-bridge-0.1.0.jar')
const bytes = readFileSync(file)
const jar = process.env.JAVA_HOME
  ? join(process.env.JAVA_HOME, 'bin', process.platform === 'win32' ? 'jar.exe' : 'jar')
  : 'jar'
const entries = execFileSync(jar, ['--list', '--file', file], { encoding: 'utf8', windowsHide: true })
  .trim()
  .split(/\r?\n/)
if (
  entries.some(
    (name) =>
      name.includes('..') ||
      !/^(?:META-INF\/|com\/(?:$|palbudir\/(?:$|dshpx\/(?:$|bridge\/)))|fabric\.mod\.json$|dshpx-input\.mixins\.json$|LICENSE$)/.test(
        name
      )
  ) ||
  !entries.includes('LICENSE')
)
  throw Error('Input bridge contains unexpected payloads or lacks its license')
if (process.argv[2]) {
  const destination = resolve(process.argv[2])
  mkdirSync(destination, { recursive: true })
  copyFileSync(file, join(destination, 'px-input-bridge-mc26.3.jar'))
  writeFileSync(
    join(destination, 'manifest.json'),
    JSON.stringify(
      {
        schemaVersion: 1,
        protocol: 'dsh-px-input-1',
        minecraft: '26.3',
        fabricLoader: '0.19.5',
        java: 25,
        file: 'px-input-bridge-mc26.3.jar',
        sha256: createHash('sha256').update(bytes).digest('hex')
      },
      null,
      2
    ) + '\n'
  )
}
