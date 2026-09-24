/** Verify the actual NSIS payload, then compare the companion ZIP's critical files. */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs'
import { execFileSync, spawnSync } from 'node:child_process'
import { basename, dirname, join, resolve, sep } from 'node:path'
import { tmpdir } from 'node:os'
import { listZipEntries } from './unzip-list'
import { repoRoot } from './paths'
import { verifyBuiltApplication, verifyManagedPackageSources } from './package-integrity'
import { MANAGED_PLUGIN_NAMES, RUNTIME_VERSIONS } from '../src/shared/plugin-catalog'
import { verifyRuntimeIntegrity, sha256File } from '../src/shared/runtime-integrity'
import { forbiddenPayloadPaths } from '../src/shared/payload-policy'

const REPO = repoRoot()
const log = (message: string): void => {
  process.stdout.write(`[pkg] ${message}\n`)
}
const REQUIRED = [
  'resources/app.asar',
  'resources/app-update.yml',
  'resources/runtime/runtime-manifest.json',
  'resources/runtime/node/node.exe',
  'resources/runtime/dsh/package.json',
  'resources/runtime/dsh/lib/bin.js',
  'resources/runtime/dsh-home/profiles/web/package.json',
  'resources/runtime/dsh-home/profiles/web/node_modules/dsh-better-sidebar/package.json',
  'resources/runtime/dsh-home/profiles/web/node_modules/dsh-better-sidebar/lib/index.js',
  ...MANAGED_PLUGIN_NAMES.flatMap((name) =>
    ['package.json', 'lib/index.js', 'lib/client.js', 'cordis.patch.yml'].map(
      (file) => `resources/runtime/dsh-home/profiles/web/node_modules/${name}/${file}`
    )
  )
]

function sevenZip(): string {
  if (process.env.DSH_PX_7Z) {
    if (!existsSync(process.env.DSH_PX_7Z)) throw new Error('DSH_PX_7Z 指向不存在的 7-Zip 程序')
    return process.env.DSH_PX_7Z
  }
  for (const file of [
    'C:/Program Files/7-Zip/7z.exe',
    'C:/Program Files (x86)/7-Zip/7z.exe',
    join(REPO, 'node_modules/electron-winstaller/vendor/7z-x64.exe'),
    join(REPO, 'node_modules/electron-winstaller/vendor/7z.exe')
  ]) {
    if (existsSync(file)) return file
  }
  const found = spawnSync(process.platform === 'win32' ? 'where' : 'which', ['7z'], {
    encoding: 'utf8',
    windowsHide: true
  })
  if (found.status === 0 && found.stdout.trim()) return found.stdout.trim().split(/\r?\n/)[0]
  throw new Error(
    '安装包校验需要支持 NSIS 的 7-Zip；请安装 7-Zip 或设置 DSH_PX_7Z，不能以 ZIP 代替安装包验证'
  )
}

function archivePaths(seven: string, archive: string): string[] {
  const output = execFileSync(seven, ['l', '-slt', archive], {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 120_000,
    maxBuffer: 64 * 1024 * 1024
  })
  const entries = output
    .split(/\r?\n/)
    .flatMap((line) =>
      line.startsWith('Path = ') ? [line.slice(7).replaceAll('\\', '/').replace(/\/+$/, '')] : []
    )
  return entries.filter((path) => path !== archive.replaceAll('\\', '/') && !/^[a-z]:\//i.test(path))
}

function checkPaths(paths: string[], label: string): void {
  if (paths.length < 1000) throw new Error(`${label} 只有 ${paths.length} 条载荷记录，无法确认已读取应用载荷`)
  const normalized = new Set(paths.map((path) => path.toLowerCase()))
  const missing = REQUIRED.filter((file) => !normalized.has(file.toLowerCase()))
  const forbidden = forbiddenPayloadPaths(paths)
  const extra = paths.filter(
    (file) => file.startsWith('resources/runtime/') && /\.(?:[cm]?js|css|d\.ts)\.map$/.test(file)
  )
  if (missing.length || forbidden.length || extra.length)
    throw new Error(
      `${label} 载荷不合格：${JSON.stringify({ missing, forbidden: forbidden.slice(0, 20), unpruned: extra.slice(0, 10) })}`
    )
  log(`${label} 必需载荷完整，无敏感、运行或测试数据（${paths.length} 条）`)
}

function extract(seven: string, archive: string, destination: string, entries: string[]): void {
  mkdirSync(destination, { recursive: true })
  execFileSync(
    seven,
    [
      'x',
      '-y',
      '-bd',
      '-bso0',
      '-bsp0',
      `-o${destination}`,
      archive,
      ...entries.map((entry) => entry.replaceAll('/', '\\'))
    ],
    {
      windowsHide: true,
      timeout: 180_000,
      maxBuffer: 4 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe']
    }
  )
}

function main(): void {
  if (process.platform !== 'win32')
    throw new Error('Windows 安装包必须在 Windows 上运行其实际 Node 二进制进行校验')
  const version = JSON.parse(readFileSync(join(REPO, 'package.json'), 'utf8')).version as string
  const candidates = existsSync(join(REPO, 'dist'))
    ? readdirSync(join(REPO, 'dist')).filter(
        (file) => /Setup.*\.exe$/i.test(file) && file.endsWith(`${version}.exe`)
      )
    : []
  const installer = process.argv[2]
    ? resolve(process.argv[2])
    : candidates.length === 1
      ? join(REPO, 'dist', candidates[0])
      : ''
  if (!installer || !existsSync(installer))
    throw new Error(`找不到当前版本 ${version} 的唯一安装包；请显式传入路径`)
  if (!basename(installer).endsWith(`${version}.exe`))
    throw new Error(`安装包文件名不属于当前版本 ${version}`)
  const zip = join(dirname(installer), `DSH-PX-${version}-win.zip`)
  if (!existsSync(zip)) throw new Error('缺少同版本 ZIP，无法核对两个交付物是否一致')
  log(`实际安装包：${installer}（${(statSync(installer).size / 1048576).toFixed(1)} MB）`)
  const seven = sevenZip()
  const temporary = mkdtempSync(join(tmpdir(), 'dshpx-package-verify-'))
  try {
    const embedded = archivePaths(seven, installer).filter((path) =>
      /(?:^|\/)app-(?:64|x64)\.7z$/i.test(path)
    )
    if (embedded.length !== 1 || embedded[0].split('/').includes('..'))
      throw new Error('NSIS 中没有唯一的 x64 应用载荷')
    extract(seven, installer, join(temporary, 'nsis'), embedded)
    const payload = join(temporary, 'nsis', embedded[0])
    const paths = archivePaths(seven, payload)
    checkPaths(paths, 'NSIS 内嵌应用')
    const zipPaths = listZipEntries(zip)
    checkPaths(zipPaths, '同版本 ZIP')
    const nsisRoot = join(temporary, 'payload'),
      zipRoot = join(temporary, 'zip')
    extract(seven, payload, nsisRoot, REQUIRED)
    extract(seven, zip, zipRoot, REQUIRED)
    for (const file of REQUIRED)
      if (sha256File(join(nsisRoot, file)) !== sha256File(join(zipRoot, file)))
        throw new Error(`NSIS 与 ZIP 的实际文件不一致：${file}`)
    verifyRuntimeIntegrity(join(nsisRoot, 'resources/runtime'), {
      node: process.env.DSH_PX_NODE_VERSION ?? RUNTIME_VERSIONS.node,
      dsh: process.env.DSH_PX_DSH_VERSION ?? RUNTIME_VERSIONS.dsh,
      app: version
    })
    verifyManagedPackageSources(join(nsisRoot, 'resources/runtime'), REPO, 'web', version)
    verifyBuiltApplication(join(nsisRoot, 'resources/app.asar'), REPO, version)
    log(`NSIS 与 ZIP 的应用、实际 Node/DSH、四插件版本与摘要一致：${version}`)
    log('交付物校验通过')
  } finally {
    if (
      !resolve(temporary).startsWith(resolve(tmpdir()) + sep) ||
      !basename(temporary).startsWith('dshpx-package-verify-')
    )
      throw new Error('临时目录边界错误，未执行清理')
    rmSync(temporary, { recursive: true, force: true, maxRetries: 3 })
  }
}

try {
  main()
} catch (error) {
  process.stderr.write(`[pkg] 校验失败：${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
}
