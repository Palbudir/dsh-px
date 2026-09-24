/** Isolated native Electron smoke test. A packaged executable must be selected explicitly. */
import { createRequire } from 'node:module'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { extractFile } from '@electron/asar'
import { repoRoot } from './paths'
import { sourceFingerprint } from '../src/shared/build-identity'

const { _electron } = createRequire(import.meta.url)('playwright-core') as typeof import('playwright-core')
const root = repoRoot(),
  expected = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version
const packaged = process.env.DSH_PX_SHOT_EXECUTABLE
const executable = packaged ? resolve(packaged) : join(root, 'node_modules/electron/dist/electron.exe')
const readOutput = (file: string): Buffer =>
  packaged
    ? extractFile(join(dirname(executable), 'resources/app.asar'), `out/${file}`)
    : readFileSync(join(root, 'out', file))
const info = JSON.parse(readOutput('build-info.json').toString('utf8'))
if (info.version !== expected || info.sourceFingerprint !== sourceFingerprint(root))
  throw new Error('截图目标不对应当前源码与版本，请重新构建或显式选择正确安装包。')
for (const [file, hash] of Object.entries(info.outputs)) {
  if (createHash('sha256').update(readOutput(file)).digest('hex') !== hash)
    throw new Error(`截图目标文件已变化：${file}`)
}
const output = resolve(process.env.DSH_PX_SHOT_DIR ?? join(root, 'build/screenshots'))
const userData = process.env.DSH_PX_SHOT_USER_DATA
  ? resolve(process.env.DSH_PX_SHOT_USER_DATA)
  : mkdtempSync(join(tmpdir(), 'dshpx-ui-'))
if (process.env.APPDATA && userData.toLowerCase() === join(process.env.APPDATA, 'dsh-px').toLowerCase())
  throw new Error('自动截图必须使用隔离数据目录。')
mkdirSync(output, { recursive: true })
mkdirSync(userData, { recursive: true })
const app = await _electron.launch({
  executablePath: executable,
  args: packaged ? [] : [join(root, 'out/main/index.js')],
  cwd: root,
  env: {
    ...process.env,
    DSH_PX_USER_DATA_DIR: userData,
    DSH_PX_HOME: '',
    DSH_PX_PORT: process.env.DSH_PX_SHOT_PORT ?? '3120'
  },
  timeout: 30000
})
const errors: string[] = []
try {
  const page = await app.firstWindow()
  page.on('pageerror', (error) => errors.push(String(error)))
  let previewNoticeDismissed = false
  let providerSetupSkipped = false
  await page.addLocatorHandler(page.getByRole('dialog').filter({ hasText: '内测声明' }), async (notice) => {
    await notice.getByRole('button', { name: '继续', exact: true }).click()
    previewNoticeDismissed = true
  })
  await page.addLocatorHandler(
    page.getByRole('dialog').filter({ hasText: '添加一个 API Key 开始使用' }),
    async (setup) => {
      await setup.getByRole('button', { name: '稍后配置', exact: true }).click()
      providerSetupSkipped = true
    }
  )
  const actual = await app.evaluate(({ app, BrowserWindow }) => ({
    userData: app.getPath('userData'),
    packaged: app.isPackaged,
    version: app.getVersion(),
    bounds: BrowserWindow.getAllWindows()[0].getBounds()
  }))
  if (
    resolve(actual.userData) !== userData ||
    actual.packaged !== Boolean(packaged) ||
    (packaged && actual.version !== expected)
  )
    throw new Error('原生窗口身份不匹配')
  await page.locator('.px-bar').waitFor({ state: 'visible', timeout: 180000 })
  const capture = async (name: string): Promise<void> => {
    const size = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }))
    const png = await app.evaluate(async ({ BrowserWindow }, size) => {
      const image = await BrowserWindow.getAllWindows()[0].capturePage()
      return image.resize(size).toPNG().toString('base64')
    }, size)
    writeFileSync(join(output, name), Buffer.from(png, 'base64'))
  }
  await page.getByRole('button', { name: '设置', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '设置', exact: true })
  await dialog.getByRole('button', { name: '版本与更新', exact: true }).click()
  await dialog.getByText(expected, { exact: true }).first().waitFor({ timeout: 10000 })
  await capture('versions.png')
  await dialog.getByRole('button', { name: '运行与帮助', exact: true }).click()
  await dialog.getByText(/^桌面窗口 · /).waitFor({ timeout: 10000 })
  const status = await dialog.innerText()
  await capture('runtime.png')
  await dialog.getByRole('button', { name: '关闭', exact: true }).click()
  const fit = await page.evaluate(() => ({
    width: innerWidth,
    height: innerHeight,
    scrollWidth: document.documentElement.scrollWidth
  }))
  if (fit.scrollWidth > fit.width + 1 || errors.length)
    throw new Error('原生窗口布局溢出或客户端报错：' + errors.join('; '))
  writeFileSync(
    join(output, 'smoke.json'),
    JSON.stringify(
      {
        ...info,
        actual,
        fit,
        status,
        errors,
        previewNoticeDismissed,
        providerSetupSkipped,
        surface: 'electron'
      },
      null,
      2
    )
  )
  console.log(`Native Electron smoke passed: ${expected}`)
} finally {
  await app.close()
}
