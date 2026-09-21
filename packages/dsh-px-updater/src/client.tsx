/**
 * dsh-px 更新插件的**客户端半边**：在 dsh 设置页里加一个「DSH-PX」分区。
 *
 * 存在的理由：更新相关信息（当前版本、随附 dsh 版本、有没有新版）此前只能从
 * 外壳的托盘菜单看到，或者问智能体。放进设置页之后，它与其它插件能力处在同一个
 * 位置 —— 用户不必知道"外壳"和"插件"的区别就能找到它。
 *
 * ## 产物形态（改本文件前务必先读）
 *
 * 本文件**不是**直接交付物。它由 `scripts/build-client.mjs` 用 esbuild 打包成
 * `lib/client.js`，并包成 dsh 客户端插件约定的形态：
 *
 * ```js
 * window.__ModuleLoader__.load({ id, factory: (require) => { ...exports... } })
 * ```
 *
 * 因此约定：
 *   - `react` 与 `react/jsx-runtime` 必须**留成外部 require**，交给宿主前端解析。
 *     宿主已在前端的静态模块表里提供它们（`dsh-client-modules` 的 seed 表），
 *     自带一份 React 会打破 hooks 的模块单例。
 *   - 只导出 `apply` / `inject`，与官方客户端插件一致。
 *   - 不要在这里 import 任何 node: 内置模块 —— 这是浏览器代码。
 *
 * ## 为什么用 slots.inject 而不是 slots.get
 *
 * `settings.section` 插槽由官方 `dsh-client-ui-settings` 的 apply 声明，而两者
 * 的激活顺序**没有保证**。`inject` 会等目标插槽出现在账本上再注册；
 * 直接 `get()` 在插槽尚未声明时会静默失败 —— 表现为"插件加载了但设置页没有它"。
 * 这与宿主半边里 `webServer` 那次踩的坑是同一类问题。
 *
 * @module dsh-px-updater/client
 */
import { useCallback, useEffect, useState } from 'react'
import type { ClientContext } from '@deepseek-ai/cordis'
import type { SlotComponentProps } from '@deepseek-ai/dsh-client-ui-slots'

/** 本插件的客户端模块 id；必须与 package.json 的包名一致（宿主用它索引模块）。 */
const NS = 'dsh-px-updater'

/** 宿主半边注册的 HTTP 端点前缀；必须与 lib/index.js 的 `routePrefix` 默认值一致。 */
const ROUTE_PREFIX = '/dsh-px-updater'

/** 客户端必需的服务。只声明真正用到的：插槽与本地化。 */
export const inject = ['slots', 'locale']

/** 站点文案。字典是扁平的 key → 模板串。 */
const DICT: Record<string, Record<string, string>> = {
  zh: {
    'nav': 'DSH-PX',
    'loading': '正在读取版本信息…',
    'section.app': '桌面客户端',
    'section.dsh': '随附 dsh 核心',
    'section.update': '更新',
    'check': '检查更新',
    'checking': '正在检查…',
    'notChecked': '尚未检查',
    'upToDate': '已是最新版本',
    'available': '有新版本可用',
    'current': '当前',
    'latest': '最新',
    'releaseNotes': '发布说明',
    'openRelease': '打开发布页',
    'paths': '目录',
    'dataDir': '数据目录',
    'logFile': '日志文件',
    'copyHint': '路径可复制，也可以直接用下面的按钮打开。',
    'copy': '复制',
    'copied': '已复制',
    'openDataDir': '打开数据目录',
    'openLog': '打开日志',
    'opened': '已打开',
    'openFailed': '打开失败',
    'unavailable': '无法读取版本信息',
    'shellState': '外壳状态',
    'readyPrefix': '新版本已下载完成：',
    'installNow': '重启并安装',
    'installing': '正在请求…',
    'note': '更新由桌面客户端执行下载与安装；这里只负责显示与检查。'
  },
  en: {
    'nav': 'DSH-PX',
    'loading': 'Reading version information…',
    'section.app': 'Desktop client',
    'section.dsh': 'Bundled dsh core',
    'section.update': 'Updates',
    'check': 'Check for updates',
    'checking': 'Checking…',
    'notChecked': 'Not checked yet',
    'upToDate': 'Up to date',
    'available': 'A new version is available',
    'current': 'Current',
    'latest': 'Latest',
    'releaseNotes': 'Release notes',
    'openRelease': 'Open release page',
    'paths': 'Locations',
    'dataDir': 'Data directory',
    'logFile': 'Log file',
    'copyHint': 'Copy a path, or open it directly with the buttons below.',
    'copy': 'Copy',
    'copied': 'Copied',
    'openDataDir': 'Open data folder',
    'openLog': 'Open log',
    'opened': 'Opened',
    'openFailed': 'Failed',
    'unavailable': 'Could not read version information',
    'shellState': 'Shell status',
    'readyPrefix': 'Update downloaded: ',
    'installNow': 'Restart and install',
    'installing': 'Requesting…',
    'note': 'The desktop client performs the download and install; this page only displays and checks.'
  }
}

/** `/status` 端点的响应（字段由宿主半边决定）。 */
interface StatusPayload {
  current: { app: string | null, dsh: string | null, platform: string | null }
  manifestPath: string | null
  repository: string
}

/** `/check` 端点的响应。 */
interface CheckPayload {
  current: { app: string, dsh: string, platform: string }
  latest: { app: string | null, dsh: string | null }
  updateAvailable: { app: boolean, dsh: boolean }
  releaseUrl: string | null
  releaseNotes: string | null
  errors: string[]
}

/**
 * `/shell-state` 端点的响应：**外壳**真实的更新进度。
 *
 * 为什么需要它：插件自己只能查"有没有新版"，而下载进度与"已就绪"只有外壳知道
 * （下载/安装必须由 Electron 侧的 electron-updater 做）。界面跑在浏览器里够不到
 * 外壳，因此状态经 `update-bridge` 文件 → 插件端点 → 这里。
 */
interface ShellStatePayload {
  phase: 'idle' | 'checking' | 'downloading' | 'ready' | 'error'
  status: string
  version: string | null
  percent: number | null
  error: string | null
  available?: boolean
}

/** 一次性取 JSON；失败抛出可读错误。 */
async function getJson<T> (path: string): Promise<T> {
  const res = await fetch(path, { headers: { accept: 'application/json' } })
  if (!res.ok) throw new Error(`HTTP ${String(res.status)}`)
  return await res.json() as T
}

/** 一行「标签 + 值」。 */
function Row ({ label, value }: { label: string, value: string }): unknown {
  return (
    <div style={{ display: 'flex', gap: 12, padding: '7px 0', alignItems: 'baseline' }}>
      <span style={{ flex: '0 0 132px', opacity: 0.62, fontSize: 13 }}>{label}</span>
      <span style={{ fontSize: 14, wordBreak: 'break-all' }}>{value}</span>
    </div>
  )
}

/** 小标题。 */
function Heading ({ children }: { children: string }): unknown {
  return (
    <div style={{ fontSize: 13, fontWeight: 600, opacity: 0.75, margin: '18px 0 4px', letterSpacing: '.02em' }}>
      {children}
    </div>
  )
}

/** 可复制的路径行。 */
function PathRow ({ label, value, copyLabel, copiedLabel }: {
  label: string
  value: string
  copyLabel: string
  copiedLabel: string
}): unknown {
  const [copied, setCopied] = useState(false)
  const copy = useCallback(() => {
    void navigator.clipboard?.writeText(value).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
    }).catch(() => { /* 剪贴板不可用：不打断用户 */ })
  }, [value])
  return (
    <div style={{ display: 'flex', gap: 12, padding: '7px 0', alignItems: 'baseline' }}>
      <span style={{ flex: '0 0 132px', opacity: 0.62, fontSize: 13 }}>{label}</span>
      <code style={{ fontSize: 12.5, wordBreak: 'break-all', flex: 1 }}>{value}</code>
      <button type="button" onClick={copy} style={{
        flex: 'none', cursor: 'pointer', fontSize: 12, padding: '2px 10px', borderRadius: 6,
        border: '1px solid currentColor', background: 'transparent', color: 'inherit', opacity: 0.7
      }}>{copied ? copiedLabel : copyLabel}</button>
    </div>
  )
}

/**
 * 非阻塞的更新就绪提示。
 *
 * 刻意不用模态对话框：更新是后台行为，弹窗会夺走焦点、挡住正在看的界面，
 * 而且在它被处理掉之前用户没法继续 —— 对一个"每天开着"的客户端这是明显的倒退。
 * 这里只是一条横幅：可以忽略，也可以点一下重启安装。
 */
function UpdateBanner ({ state, onInstall, installing, t }: {
  state: ShellStatePayload
  onInstall: () => void
  installing: boolean
  t: (key: string) => string
}): unknown {
  const tone = state.phase === 'error' ? '#c0392b' : '#2e7d32'
  return (
    <div style={{
      display: 'flex', gap: 12, alignItems: 'center', margin: '0 0 16px',
      padding: '10px 14px', borderRadius: 10,
      border: `1px solid ${tone}`, background: `${tone}1a`
    }}>
      <div style={{ flex: 1, fontSize: 13, lineHeight: 1.6 }}>
        <div>{state.phase === 'ready'
          ? `${t('readyPrefix')}${state.version ?? ''}`
          : state.status}</div>
        {state.phase === 'downloading' && state.percent !== null
          ? <div style={{ opacity: 0.75, fontSize: 12 }}>{state.percent}%</div>
          : null}
        {state.phase === 'error' && state.error !== null
          ? <div style={{ opacity: 0.75, fontSize: 12 }}>{state.error}</div>
          : null}
      </div>
      {state.phase === 'ready'
        ? <button type="button" onClick={onInstall} disabled={installing} style={{
          flex: 'none', cursor: installing ? 'default' : 'pointer', fontSize: 13,
          padding: '5px 14px', borderRadius: 8, border: '1px solid currentColor',
          background: 'transparent', color: 'inherit', opacity: installing ? 0.5 : 0.95
        }}>{installing ? t('installing') : t('installNow')}</button>
        : null}
    </div>
  )
}

/**
 * 设置页里的 DSH-PX 分区。
 * @param props - 宿主注入面（本站点用 `t` 翻译函数）。
 */
function DshPxSection ({ t }: SlotComponentProps): unknown {
  const tr = (key: string): string => (typeof t === 'function' ? t(key) : key)
  const [status, setStatus] = useState<StatusPayload | null>(null)
  const [statusError, setStatusError] = useState<string | null>(null)
  const [check, setCheck] = useState<CheckPayload | null>(null)
  const [checking, setChecking] = useState(false)
  const [checkError, setCheckError] = useState<string | null>(null)
  const [shell, setShell] = useState<ShellStatePayload | null>(null)
  const [installing, setInstalling] = useState(false)

  // 挂载时只读本地信息，**不联网** —— 打开设置页不该触发网络请求。
  useEffect(() => {
    let alive = true
    getJson<StatusPayload>(`${ROUTE_PREFIX}/status`)
      .then((v) => { if (alive) setStatus(v) })
      .catch((err: unknown) => { if (alive) setStatusError(err instanceof Error ? err.message : String(err)) })
    return () => { alive = false }
  }, [])

  // 轮询外壳状态。
  //
  // 为什么是轮询而不是推送：界面在外壳的**对等 HTTP 面**之外，外壳无法主动推给
  // 它；而要为此新建一条 WebSocket/SSE 通道，代价远大于收益。3 秒一次、
  // 且只在设置页打开时轮询（组件卸载即停），开销可忽略。
  useEffect(() => {
    let alive = true
    const tick = (): void => {
      getJson<ShellStatePayload>(`${ROUTE_PREFIX}/shell-state`)
        .then((v) => { if (alive) setShell(v) })
        .catch(() => { /* 外壳未提供状态：保持上一次的值 */ })
    }
    tick()
    const timer = setInterval(tick, 3000)
    return () => { alive = false; clearInterval(timer) }
  }, [])

  const doInstall = useCallback((): void => {
    setInstalling(true)
    fetch(`${ROUTE_PREFIX}/install`, { method: 'POST' })
      .then(() => { /* 外壳收到请求后会退出并安装，界面不必等待 */ })
      .catch(() => { setInstalling(false) })
  }, [])

  const doCheck = useCallback((): void => {
    setChecking(true)
    setCheckError(null)
    getJson<CheckPayload>(`${ROUTE_PREFIX}/check`)
      .then(setCheck)
      .catch((err: unknown) => setCheckError(err instanceof Error ? err.message : String(err)))
      .finally(() => setChecking(false))
  }, [])

  const updateLabel = ((): string => {
    if (checking) return tr('checking')
    if (!check) return tr('notChecked')
    return check.updateAvailable.app || check.updateAvailable.dsh ? tr('available') : tr('upToDate')
  })()

  return (
    <div style={{ padding: '4px 2px 24px', maxWidth: 620 }}>
      {/* 更新就绪/失败时，先给一条**非阻塞**横幅（见 UpdateBanner 的说明）。 */}
      {shell !== null && (shell.phase === 'ready' || shell.phase === 'error')
        ? <UpdateBanner state={shell} onInstall={doInstall} installing={installing} t={tr} />
        : null}

      <Heading>{tr('section.app')}</Heading>
      {statusError !== null
        ? <div style={{ fontSize: 13, opacity: 0.8 }}>{tr('unavailable')}（{statusError}）</div>
        : <Row label={tr('current')} value={status?.current.app ?? tr('loading')} />}

      <Heading>{tr('section.dsh')}</Heading>
      <Row label={tr('current')} value={status?.current.dsh ?? tr('loading')} />
      <Row label="platform" value={status?.current.platform ?? '—'} />

      <Heading>{tr('section.update')}</Heading>
      <Row label={tr('latest')} value={check?.latest.app ?? '—'} />
      {/* 外壳侧的进度：只有它能给出"正在下载 42%"/"已就绪"。 */}
      {shell?.available === true
        ? <Row label={tr('shellState')} value={
          shell.phase === 'downloading' && shell.percent !== null
            ? `${shell.status} (${shell.percent}%)`
            : shell.status
        } />
        : null}
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', padding: '6px 0' }}>
        <span style={{ flex: '0 0 132px', opacity: 0.62, fontSize: 13 }}>{tr('section.update')}</span>
        <span style={{ fontSize: 14 }}>{updateLabel}</span>
        <button type="button" onClick={doCheck} disabled={checking} style={{
          cursor: checking ? 'default' : 'pointer', fontSize: 13, padding: '4px 12px', borderRadius: 8,
          border: '1px solid currentColor', background: 'transparent', color: 'inherit', opacity: checking ? 0.5 : 0.85
        }}>{checking ? tr('checking') : tr('check')}</button>
      </div>
      {check?.releaseUrl !== null && check?.releaseUrl !== undefined
        ? <Row label={tr('openRelease')} value={check.releaseUrl} />
        : null}
      {checkError !== null ? <div style={{ fontSize: 12.5, opacity: 0.8 }}>{checkError}</div> : null}
      {check !== null && check.errors.length > 0
        ? <div style={{ fontSize: 12.5, opacity: 0.8 }}>{check.errors.join('；')}</div>
        : null}

      {/* 目录信息来自宿主端点；设置页在浏览器围栏内，不能自己打开文件系统。
          因此：路径可复制，另有按钮经宿主端点请外壳去打开。 */}
      <Heading>{tr('paths')}</Heading>
      <div style={{ fontSize: 12, opacity: 0.6, marginBottom: 2 }}>{tr('copyHint')}</div>

      <div style={{ display: 'flex', gap: 8, margin: '8px 0 4px' }}>
        <OpenButton what="open-data" label={tr('openDataDir')} t={tr} />
        <OpenButton what="open-log" label={tr('openLog')} t={tr} />
      </div>

      {status?.manifestPath !== null && status?.manifestPath !== undefined
        ? <PathRow label="manifest" value={status.manifestPath} copyLabel={tr('copy')} copiedLabel={tr('copied')} />
        : null}

      <div style={{ fontSize: 12, opacity: 0.55, marginTop: 18, lineHeight: 1.7 }}>{tr('note')}</div>
    </div>
  )
}

/**
 * "打开数据目录 / 日志"按钮。
 *
 * 为什么不能直接开：设置页跑在**浏览器围栏**里（harness 的 HTTP 服务），
 * 拿不到文件系统。它只能请插件宿主端点转达，外壳再执行 `shell.openPath` /
 * `showItemInFolder`。
 *
 * 目标用**白名单枚举**（`open-data` / `open-log`）而不是路径 ——
 * 页面无法命令外壳打开任意位置。
 */
function OpenButton ({ what, label, t }: {
  what: 'open-data' | 'open-log'
  label: string
  t: (key: string) => string
}): unknown {
  const [state, setState] = useState<'idle' | 'sent' | 'failed'>('idle')
  const open = useCallback((): void => {
    setState('idle')
    fetch(`${ROUTE_PREFIX}/open?what=${what}`, { method: 'POST' })
      .then((r) => { setState(r.ok ? 'sent' : 'failed') })
      .catch(() => { setState('failed') })
  }, [what])
  const text = state === 'sent' ? t('opened') : state === 'failed' ? t('openFailed') : label
  return (
    <button type="button" onClick={open} style={{
      cursor: 'pointer', fontSize: 13, padding: '4px 12px', borderRadius: 8,
      border: '1px solid currentColor', background: 'transparent', color: 'inherit',
      opacity: state === 'failed' ? 0.5 : 0.85
    }}>{text}</button>
  )
}

/**
 * 客户端插件入口。
 * @param ctx - 客户端 cordis 上下文。
 */
export function apply (ctx: ClientContext): void {
  // 注册本站点的中英文字典。用 ctx.effect 挂上，插件卸载时自动清理。
  ctx.effect?.(() => {
    const disposers = [
      ctx.locale.register(NS, 'zh', DICT.zh),
      ctx.locale.register(NS, 'en', DICT.en)
    ]
    return () => { for (const d of disposers) d() }
  }, 'dsh-px-updater: dictionaries')

  // 等 settings.section 插槽就绪再注册（见文件头说明：不能用 get）。
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'dsh-px',
    // 排在官方分区之后：它们是 dsh 自身的设置，我们这一块是外壳附加信息。
    order: 100,
    label: () => ctx.locale.bind(NS)('nav'),
    locale: NS
  }, DshPxSection))
}
