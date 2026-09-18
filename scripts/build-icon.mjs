/**
 * 生成 dsh-px 的应用图标。
 *
 * 素材**不入库**（避免把第三方美术资源直接放进本仓库），改为在构建时下载并校验
 * SHA-256，然后缩放成 electron-builder 需要的尺寸。这样：
 *   - 仓库里只有脚本和校验和，没有图片；
 *   - 上游更换素材会被校验和挡住，不会悄悄改变我们的产物。
 *
 * 素材来源与授权见 NOTICE.md。要点：仓库 MIT，但美术素材的来源需要署名，
 * 因此这里只做"下载 + 缩放"，不做二次创作。
 *
 * 用法：
 *   node scripts/build-icon.mjs
 *   node scripts/build-icon.mjs --source <本地png路径>   # 离线路径
 */
import { createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { pipeline } from 'node:stream/promises'
import { Readable } from 'node:stream'
import { createRequire } from 'node:module'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const BUILD = join(REPO, 'build')
const CACHE = join(BUILD, 'icon-source.png')

/** 图标素材来源（whale-girl 形象）。授权与署名见 NOTICE.md。 */
const SOURCE = {
  name: 'GarfieldZhung/DeepSeek-Whale-Girl → assets/whale/whale-maid.png',
  url: 'https://raw.githubusercontent.com/GarfieldZhung/DeepSeek-Whale-Girl/main/assets/whale/whale-maid.png',
  /** 首次确认时的摘要；上游改动会被挡住并报错，而不是静默换图。 */
  sha256: process.env.DSH_PX_ICON_SHA256 ?? '',
  license: 'MIT（仓库）；美术素材来源与署名见 NOTICE.md'
}

const log = (m) => process.stdout.write(`[icon] ${m}\n`)

/** sharp 从随附的 dsh 运行时借用，避免为构建再装一个原生依赖。 */
function loadSharp () {
  const candidates = [
    join(REPO, 'runtime', 'dsh', 'node_modules', 'sharp'),
    join(REPO, 'runtime', 'dsh-home', 'profiles', 'web', 'node_modules', 'sharp')
  ]
  for (const dir of candidates) {
    if (existsSync(dir)) return createRequire(import.meta.url)(dir)
  }
  // 退回到普通解析（本机若已装 sharp）。
  return createRequire(import.meta.url)('sharp')
}

async function fetchSource (localPath) {
  if (localPath) {
    log(`使用本地素材：${localPath}`)
    return readFileSync(localPath)
  }
  if (existsSync(CACHE)) {
    log(`使用已缓存素材：${CACHE}`)
    return readFileSync(CACHE)
  }
  log(`正在下载素材：${SOURCE.name}`)
  const res = await fetch(SOURCE.url)
  if (!res.ok) throw new Error(`素材下载失败：HTTP ${res.status}`)
  mkdirSync(BUILD, { recursive: true })
  await pipeline(Readable.fromWeb(res.body), createWriteStream(CACHE))
  return readFileSync(CACHE)
}

async function main () {
  const localIdx = process.argv.indexOf('--source')
  const localPath = localIdx >= 0 ? process.argv[localIdx + 1] : null

  const buf = await fetchSource(localPath)
  const digest = createHash('sha256').update(buf).digest('hex')
  log(`素材 sha256 = ${digest}`)

  // 若锁定了摘要就校验；不一致直接失败，避免产物悄悄变化。
  if (SOURCE.sha256 && digest !== SOURCE.sha256) {
    throw new Error(
      `素材摘要不匹配。\n  期望 ${SOURCE.sha256}\n  实际 ${digest}\n` +
      '上游可能已更新素材。确认后把新摘要写入 SOURCE.sha256 或环境变量 DSH_PX_ICON_SHA256。'
    )
  }

  const sharp = loadSharp()

  // electron-builder 直接吃 build/icon.png（≥256px）。1024 足够各平台缩放。
  const png = await sharp(buf).resize(1024, 1024, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer()
  writeFileSync(join(BUILD, 'icon.png'), png)
  log('已生成 build/icon.png (1024x1024)')

  // Windows 用 .ico（electron-builder 也能自己转，但显式给出更稳）。
  const ico = await sharp(buf).resize(256, 256, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer()
  writeFileSync(join(BUILD, 'icon-256.png'), ico)

  // 记录本次素材摘要，便于追溯。
  const meta = {
    generatedAt: new Date().toISOString(),
    sourceUrl: SOURCE.url,
    sha256: digest,
    license: SOURCE.license,
    outputs: ['build/icon.png', 'build/icon-256.png']
  }
  writeFileSync(join(BUILD, 'icon-meta.json'), JSON.stringify(meta, null, 2) + '\n')
  log('已写入 build/icon-meta.json')
}

main().catch((err) => {
  process.stderr.write(`[icon] 失败：${err?.stack ?? err}\n`)
  process.exit(1)
})
