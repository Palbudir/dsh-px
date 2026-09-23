import { test } from 'node:test'
import type { TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { UpdateController, createManualUpdateCheck } from '../src/main/update-controller'
import { createServiceState } from '../src/main/service-state'

class FakeUpdater extends EventEmitter {
  autoDownload = true
  autoInstallOnAppQuit = true
  checks = 0
  downloads = 0
  installs: boolean[][] = []
  checkResult: () => Promise<unknown> = async () => {
    this.emit('checking-for-update')
    this.emit('update-not-available', { version: '0.1.0-beta.re.0.5' })
    return {}
  }
  downloadResult: () => Promise<string[]> = async () => []
  installResult: () => void = () => {}
  async checkForUpdates (): Promise<unknown> { this.checks++; return this.checkResult() }
  async downloadUpdate (): Promise<string[]> { this.downloads++; return this.downloadResult() }
  quitAndInstall (...args: boolean[]): void { this.installs.push(args); this.installResult() }
}

function setup (t: TestContext) {
  const updater = new FakeUpdater()
  let notices = 0
  const controller = new UpdateController(updater as unknown as ConstructorParameters<typeof UpdateController>[0], {
    publish: () => {}, ready: () => { notices++ }, now: () => '2026-09-22T00:00:00.000Z',
    installDelayMs: 10, installTimeoutMs: 100
  })
  t.after(() => controller.dispose())
  return { updater, controller, notices: () => notices }
}

for (const mode of ['success', 'failure'] as const) {
  test(`手动更新检查 ${mode}：只取消启动检查，服务心跳持续，退出才停止`, async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: 10000 })
    const dir = mkdtempSync(join(tmpdir(), 'dshpx-update-heartbeat-'))
    const service = createServiceState(dir)
    t.after(() => { service.dispose(); rmSync(dir, { recursive: true, force: true }) })
    const read = () => JSON.parse(readFileSync(join(dir, 'service-state.json'), 'utf8'))
    service.set('running', '服务正在运行', 123)
    const before = read()
    const { updater, controller } = setup(t)
    if (mode === 'failure') updater.checkResult = async () => { throw new Error('offline') }
    const startup = setTimeout(() => { void controller.check() }, 8000)
    const check = createManualUpdateCheck(() => controller, () => clearTimeout(startup))
    await check()
    assert.equal(updater.checks, 1)
    assert.equal(controller.getState().phase, mode === 'success' ? 'idle' : 'error')
    // 超过界面 15 秒新鲜度窗口，不能只看检查刚结束时的旧文件。
    for (let i = 0; i < 5; i++) t.mock.timers.tick(4000)
    const after = read()
    assert.equal(after.phase, 'running')
    assert.equal(after.pid, 123)
    assert.ok(Date.parse(after.updatedAt) > Date.parse(before.updatedAt))
    assert.ok(Date.now() - Date.parse(after.updatedAt) < 4000)
    assert.equal(updater.checks, 1)
    service.dispose()
    assert.equal(read().phase, 'stopped')
    const stoppedAt = read().updatedAt
    t.mock.timers.tick(8000)
    assert.equal(read().updatedAt, stoppedAt)
  })
}

test('首次检查先 emit error 再 reject：可见失败时间，随后可重试', async (t) => {
  const { updater, controller } = setup(t)
  updater.checkResult = async () => { const e = new Error('offline'); updater.emit('error', e); throw e }
  await controller.check()
  assert.equal(controller.getState().phase, 'error')
  assert.equal(controller.getState().error, 'offline')
  assert.equal(controller.getState().lastCheckedAt, '2026-09-22T00:00:00.000Z')
  updater.checkResult = async () => { updater.emit('update-not-available', { version: '1.0.0' }); return {} }
  await controller.check()
  assert.equal(controller.getState().phase, 'idle')
  assert.equal(controller.getState().error, null)
})

test('启动与手动检查并发：只发一次请求；空结果不能卡在检查中', async (t) => {
  const { updater, controller } = setup(t)
  let finish!: () => void
  updater.checkResult = () => new Promise((resolve) => { finish = () => resolve(null) })
  const first = controller.check()
  await controller.check()
  assert.equal(updater.checks, 1)
  finish()
  await first
  assert.equal(controller.getState().phase, 'error')
})

test('下载失败后重试不积累监听；ready 不被后续检查覆盖', async (t) => {
  const { updater, controller, notices } = setup(t)
  updater.checkResult = async () => { updater.emit('update-available', { version: '1.0.1' }); return {} }
  updater.downloadResult = async () => { throw new Error('download failed') }
  await controller.check()
  assert.equal(controller.getState().phase, 'error')
  updater.downloadResult = async () => {
    updater.emit('download-progress', { percent: 48.7 })
    assert.equal(controller.getState().percent, 49)
    updater.emit('update-downloaded', { version: '1.0.1' })
    return ['installer.exe']
  }
  await controller.check()
  await controller.check()
  assert.equal(updater.checks, 2)
  assert.equal(updater.downloads, 2)
  assert.equal(notices(), 1)
  assert.equal(controller.getState().phase, 'ready')
  for (const event of ['error', 'download-progress', 'update-downloaded']) assert.equal(updater.listenerCount(event), 1)
})

test('未下载不能安装；重复点击只调用一次静默安装；void 返回值不是失败', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const { updater, controller } = setup(t)
  assert.equal(controller.install(), false)
  updater.emit('update-downloaded', { version: '1.0.1' })
  assert.equal(controller.install(), true)
  assert.equal(controller.install(), false)
  assert.equal(updater.installs.length, 0)
  t.mock.timers.tick(10)
  assert.deepEqual(updater.installs, [[true, true]])
  assert.equal(controller.getState().phase, 'installing')
})

for (const mode of ['throw', 'event', 'timeout']) {
  test(`安装 ${mode} 失败：恢复可重试状态，不强制退出`, (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] })
    const { updater, controller } = setup(t)
    updater.emit('update-downloaded', { version: '1.0.1' })
    updater.installResult = () => {
      if (mode === 'throw') throw new Error('missing installer')
      if (mode === 'event') updater.emit('error', new Error('missing installer'))
    }
    controller.install()
    t.mock.timers.tick(10)
    if (mode === 'timeout') t.mock.timers.tick(100)
    assert.equal(controller.getState().phase, 'error')
    assert.equal(updater.autoInstallOnAppQuit, false)
    assert.match(controller.getState().error ?? '', mode === 'timeout' ? /未能退出/ : /missing installer/)
  })
}

test('退出时清理安装计时器和事件监听', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const { updater, controller } = setup(t)
  updater.emit('update-downloaded', { version: '1.0.1' })
  controller.install()
  controller.dispose()
  t.mock.timers.tick(200)
  assert.deepEqual(updater.installs, [])
  assert.equal(updater.listenerCount('error'), 0)
})
