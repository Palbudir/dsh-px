/**
 * 打包产物的**真实界面**冒烟：用 Playwright 驱动 Electron 窗口截图。
 *
 * ## 为什么需要它
 *
 * 本项目有一类问题**只能靠看**才能确认：进度页排版、设置页分区的渲染、
 * 布局有没有溢出。此前这些只能靠人眼，而"人眼确认"在改动频繁时跟不上 ——
 * 实测就漏过：进度页入口只有异步的模块脚本提供，主进程核对时才报出来。
 *
 * Playwright 的 `_electron` 能直接驱动 Electron 应用：拿到窗口、切页面、
 * 截图、读 DOM。这样"界面是否正常"就变成了可自动检查的东西。
 *
 * ## 用 playwright-core + 本机 Chrome
 *
 * `playwright-core` **不带**浏览器二进制，因此不产生几百 MB 下载；
 * `_electron` 用的是我们自己的 `node_modules/electron`。
 * 界面截图若要用 Chromium 则复用系统已装的 Chrome（见 SHOT_BROWSER）。
 *
 * 用法：
 *   node scripts/run-mjs.mjs screenshot-app           # 截图到 build/screenshots/
 *   DSH_PX_SHOT_DIR=<目录> node scripts/...           # 指定输出目录
 *
 * @module dsh-px/scripts/screenshot-app
 */
import { _electron as electron } from 'playwright-core'
import { existsSync, mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { repoRoot } from './paths'

const REPO = repoRoot()
const OUT_DIR = process.env.DSH_PX_SHOT_DIR ?? join(REPO, 'build', 'screenshots')
const PORT = process.env.DSH_PX_PORT ?? '3099'

/** 打包产物或开发态产物，优先用打包后的（更接近交付形态）。 */
function appEntry (): { executable: string, args: string[] } {
  const packaged = join(REPO, 'dist', 'win-unpacked', 'DSH-PX.exe')
  if (process.platform === 'win32' && existsSync(packaged)) {
    return { executable: packaged, args: [] }
  }
  const electronExe = join(REPO, 'node_modules', 'electron', 'dist',
    process.platform === 'win32' ? 'electron.exe' : 'electron')
  return { executable: electronExe, args: [join(REPO, 'out', 'main', 'index.js')] }
}

/** 等待条件成立，超时抛错。 */
async function waitFor<T> (what: string, fn: () => Promise<T | null>, timeoutMs = 90_000): Promise<T> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const v = await fn()
    if (v !== null && v !== undefined && v !== false) return v as T
    await new Promise((r) => setTimeout(r, 400))
  }
  throw new Error(`等待超时：${what}`)
}

const { executable, args } = appEntry()
const userData = mkdtempSync(join(tmpdir(), 'dshpx-shot-'))
mkdirSync(OUT_DIR, { recursive: true })

console.log(`应用：${executable} ${args.join(' ')}`)
console.log(`userData：${userData}`)
console.log(`输出：${OUT_DIR}`)

const app = await electron.launch({
  executablePath: executable,
  args: [...args, `--user-data-dir=${userData}`],
  env: { ...process.env, DSH_PX_PORT: PORT, DSH_PX_HOME: '' }
})

try {
  const page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')

  // ── 1. 进度页 ────────────────────────────────────────────────────────────
  // 首启物化期间窗口显示进度页。同卷只需几秒，因此这里**尽快**截。
  const phaseText = await page.locator('#phase').textContent().catch(() => null)
  const isSplash = phaseText !== null
  if (isSplash) {
    await page.screenshot({ path: join(OUT_DIR, '01-splash.png') })
    console.log(`已截图 01-splash.png（阶段文案：${String(phaseText)}）`)
  } else {
    console.log('未捕获到进度页（页面可能已完成启动切走），跳过 01')
  }

  // ── 2. 等 harness 就绪并切到真实界面 ────────────────────────────────────
  await waitFor('窗口切到 harness 页面', async () => {
    const url = page.url()
    return url.startsWith('http://127.0.0.1') || url.startsWith('http://localhost') ? url : null
  })
  console.log(`窗口已加载：${page.url()}`)
  await page.waitForLoadState('domcontentloaded')
  await page.waitForTimeout(4000)

  // dsh 首启会**连续**弹出多个引导弹窗（内测声明 → 添加 API Key 等），
  // 它们会盖住设置面板。每个新建的 userData 都会出现一遍，且没有持久化的
  // "已阅"标记。因此这里**循环**关闭，直到没有可点的引导按钮为止。
  //
  // 优先点"稍后/跳过"这类，避免误触"保存并继续"真的去提交表单。
  for (let round = 1; round <= 6; round += 1) {
    const clicked = await page.evaluate(() => {
      const later = /稍后|跳过|以后|Later|Skip/
      const any = /继续|知道了|我知道了|开始使用|Got it|Continue/
      const nodes = [...document.querySelectorAll('button, [role="button"]')]
        .filter((n) => (n as HTMLElement).offsetParent !== null)
      const hit = nodes.find((n) => later.test((n.textContent ?? '').trim())) ??
        nodes.find((n) => any.test((n.textContent ?? '').trim()))
      if (hit === undefined) return null
      hit.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      return (hit.textContent ?? '').trim()
    })
    if (clicked === null) {
      console.log(`引导弹窗：第 ${String(round)} 轮无可点项，已清理干净`)
      break
    }
    console.log(`引导弹窗：已点「${clicked}」`)
    await page.waitForTimeout(1200)
  }
  await page.waitForTimeout(1200)

  await page.screenshot({ path: join(OUT_DIR, '02-harness.png') })
  console.log('已截图 02-harness.png')

  // ── 3. 打开设置并切到 DSH-PX 分区 ───────────────────────────────────────
  // dsh 的设置入口在侧边栏底部；这里按可见文本点，避免依赖内部 CSS 类名。
  const opened = await page.evaluate(() => {
    const nodes = [...document.querySelectorAll('button, [role="button"], a')]
    const hit = nodes.find((n) => /设置|Settings/.test(n.textContent ?? ''))
    if (hit === undefined) return false
    hit.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    return true
  })
  console.log(`点击"设置"入口：${opened ? '成功' : '未找到'}`)
  await page.waitForTimeout(2500)

  const switched = await page.evaluate(() => {
    const nodes = [...document.querySelectorAll('button, [role="button"], a, div[role="tab"]')]
    const hit = nodes.find((n) => (n.textContent ?? '').trim() === 'DSH-PX')
    if (hit === undefined) return false
    hit.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    return true
  })
  console.log(`点击"DSH-PX"分区：${switched ? '成功' : '未找到'}`)
  await page.waitForTimeout(1500)
  await page.screenshot({ path: join(OUT_DIR, '03-settings-dshpx.png') })
  console.log('已截图 03-settings-dshpx.png')

  // ── 4. 读回分区内的文本，作为**可断言的**证据 ───────────────────────────
  //
  // 断言只看"无论如何都该存在"的字段。「外壳状态」**不在**其中：
  // 它只在插件拿到外壳写的 `update-bridge/state.json` 时才渲染，而开发态
  // 外壳刻意跳过自动更新、不写该文件 —— 那是设计行为，不是缺陷。
  // （打包态由 electron-updater 触发事件后写状态，用户截图里可见。）
  const sectionText = await page.evaluate(() => {
    const body = document.body.innerText
    const i = body.indexOf('桌面客户端')
    return i >= 0 ? body.slice(i, i + 900) : '(未找到"桌面客户端"标题)'
  })
  console.log('--- 分区文本 ---')
  console.log(sectionText)

  const required = ['桌面客户端', '随附 dsh 核心', '更新', '目录', '检查更新']
  const missing = required.filter((k) => !sectionText.includes(k))
  if (missing.length > 0) {
    console.error(`\n分区缺少预期字段：${missing.join('、')}`)
    process.exitCode = 1
  } else {
    console.log('\n分区结构核对通过')
  }

  // 额外报告：外壳状态是否出现（开发态应为否、打包态应为是）。
  console.log(`外壳状态行是否渲染：${sectionText.includes('外壳状态') ? '是' : '否（开发态预期为否）'}`)
} finally {
  await app.close().catch(() => { /* 已退出 */ })
}
