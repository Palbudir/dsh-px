/**
 * 外壳 ↔ 界面的更新状态桥。
 *
 * ## 为什么要它
 *
 * 更新状态原本只活在外壳的托盘菜单里。但用户看界面的时间远多于看托盘，
 * 而"有没有更新、下到哪了、要不要重启"恰恰是需要在这里看到的信息。
 * 可是外壳（Electron 主进程）与界面（harness 前端）之间**没有现成通道**：
 * 前端跑在 harness 的 HTTP 服务里，不是 Electron 的渲染进程，拿不到 IPC。
 *
 * 因此这里用一个最小的、双方都能访问的**文件**做桥：
 *
 *   <userData>/update-bridge/state.json    外壳写，插件读（再经 HTTP 给界面）
 *   <userData>/update-bridge/install.req   界面写（经插件），外壳读
 *
 * ## 为什么是文件而不是加一个 HTTP 服务
 *
 * 外壳里已经有 harness 的 HTTP 服务在监听，再起一个端口会带来"端口从哪来、
 * 要不要认证"的新问题；而这个方向的需求（非阻塞地把状态告诉界面）用文件就够了。
 * 写入是**原子**的（先写临时文件再 rename），避免界面读到半截 JSON。
 *
 * ## 请求安装为什么也要走文件
 *
 * 下载与安装必须在外壳里做（`electron-updater` 才能替换正在运行的 exe）。
 * 界面点"重启并安装"时写一个请求文件，外壳监听并执行 —— 这样界面侧不需要
 * 任何特权，也不会出现"浏览器直接调 Electron API"这种越界。
 *
 * @module dsh-px/update-bridge
 */
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, watch, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'

/** 更新所处的阶段。 */
export type UpdatePhase = 'idle' | 'checking' | 'downloading' | 'ready' | 'error'

/** 写进 state.json 的内容（字段名即协议，插件侧按它读）。 */
export interface UpdateBridgeState {
  phase: UpdatePhase
  /** 面向用户的短句，界面直接显示。 */
  status: string
  /** 正在下载/已就绪的版本号。 */
  version: string | null
  /** 下载进度 0–100；非下载阶段为 null。 */
  percent: number | null
  /** 失败原因（phase === 'error' 时有意义）。 */
  error: string | null
  updatedAt: string
}

/** 桥的目录与文件名。 */
function bridgeDir (): string {
  return join(app.getPath('userData'), 'update-bridge')
}
export function bridgeStatePath (): string {
  return join(bridgeDir(), 'state.json')
}

/** 当前状态（内存态；落盘只是给界面读的投影）。 */
let state: UpdateBridgeState = {
  phase: 'idle',
  status: '未检查',
  version: null,
  percent: null,
  error: null,
  updatedAt: new Date().toISOString()
}

/**
 * 原子写：先写临时文件再 rename。
 * 直接覆盖会让界面有概率读到半个 JSON（写非原子），而 JSON 解析失败在界面上
 * 只会表现成"更新信息不显示"，很难定位。
 */
function writeAtomic (path: string, text: string): void {
  const tmp = `${path}.tmp`
  writeFileSync(tmp, text)
  renameSync(tmp, path)
}

/** 把最新状态落盘，供插件/界面读取。 */
function persist (): void {
  try {
    mkdirSync(bridgeDir(), { recursive: true })
    writeAtomic(bridgeStatePath(), JSON.stringify(state, null, 2) + '\n')
  } catch (err) {
    // 落盘失败不该影响更新本身：状态仍在外壳内存里，托盘照常显示。
    process.stderr.write(`[dsh-px] 更新状态落盘失败：${err instanceof Error ? err.message : String(err)}\n`)
  }
}

/** 更新状态（会立即落盘）。 */
export function setUpdateState (patch: Partial<Omit<UpdateBridgeState, 'updatedAt'>>): UpdateBridgeState {
  state = { ...state, ...patch, updatedAt: new Date().toISOString() }
  persist()
  return state
}

/** 读当前状态（外壳内部用）。 */
export function getUpdateState (): UpdateBridgeState {
  return state
}

/**
 * 界面可请求的**外壳动作**。
 *
 * 界面跑在 harness 的浏览器里，够不到 Electron，所以"打开数据目录/日志目录"
 * 这类事只能这样转达。刻意做成**白名单字符串**而不是"传任意路径过来打开" ——
 * 后者等于把 shell.openPath 暴露给页面，是没有必要的权限面。
 */
export type ShellAction = 'install' | 'open-data' | 'open-log'

/** 请求文件路径：一个动作一个文件，内容为请求时间。 */
function requestPath (action: ShellAction): string {
  return join(bridgeDir(), `${action}.req`)
}

/** 插件的宿主半边写这个文件；内容即目标动作名，无需解析。 */
export function shellActionFileName (action: ShellAction): string {
  return `${action}.req`
}

/**
 * 监听界面发来的**外壳动作请求**（安装更新、打开数据目录、打开日志目录）。
 *
 * 监听用 `fs.watch`，但**不信任它**：不同平台/文件系统上 watch 的行为差异很大
 * （网络盘、编辑器写入方式都可能不触发）。因此同时起一个低频轮询兜底 ——
 * 一个用户点了却毫无反应的按钮是最糟的失败模式。
 *
 * @param onAction 收到某个动作请求时调用
 * @returns 停止监听
 */
export function watchShellActions (onAction: (action: ShellAction) => void): () => void {
  const dir = bridgeDir()
  const actions: ShellAction[] = ['install', 'open-data', 'open-log']
  try {
    mkdirSync(dir, { recursive: true })
  } catch { /* 已在别处报错 */ }

  let stopped = false

  const check = (): void => {
    if (stopped) return
    for (const action of actions) {
      const p = requestPath(action)
      try {
        if (!existsSync(p)) continue
        rmSync(p, { force: true })
        process.stdout.write(`[dsh-px] 收到界面请求：${action}\n`)
        onAction(action)
      } catch { /* 文件正在被写/已被删：下一轮再看 */ }
    }
  }

  const timer = setInterval(check, 800)
  let watcher: ReturnType<typeof watch> | null = null
  try {
    watcher = watch(dir, () => check())
  } catch {
    // watch 不可用就只靠轮询，功能不受影响。
  }
  check()

  return () => {
    stopped = true
    clearInterval(timer)
    try { watcher?.close() } catch { /* 已关闭 */ }
  }
}

/** 清理桥文件（测试与"重置状态"用）。 */
export function resetUpdateBridge (): void {
  for (const a of ['install', 'open-data', 'open-log'] as ShellAction[]) {
    try { rmSync(requestPath(a), { force: true }) } catch { /* 不存在 */ }
  }
  state = { phase: 'idle', status: '未检查', version: null, percent: null, error: null, updatedAt: new Date().toISOString() }
  persist()
}
