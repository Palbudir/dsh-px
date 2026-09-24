/** User-facing update state and actions in the native DSH settings slot. */
import { installUiStyles } from '../../shared/ui'

import { useCallback, useEffect, useState } from 'react'
import type { ClientContext } from '@deepseek-ai/cordis'
import type { SlotComponentProps } from '@deepseek-ai/dsh-client-ui-slots'
import { requestJson, checkLabel, desktopCheckLabel, safeReleaseUrl } from './client-data'

/** 本插件的客户端模块 id；必须与 package.json 的包名一致（宿主用它索引模块）。 */
const NS = 'dsh-px-updater'

/** 宿主半边注册的 HTTP 端点前缀；必须与 lib/index.js 的 `routePrefix` 默认值一致。 */
const ROUTE_PREFIX = '/dsh-px-updater'

/** 客户端必需的服务。只声明真正用到的：插槽与本地化。 */
export const inject = ['slots', 'locale']

/** 站点文案。字典是扁平的 key → 模板串。 */
const DICT: Record<string, Record<string, string>> = {
  zh: {
    nav: '版本与更新',
    loading: '正在读取版本信息…',
    'section.app': 'DSH-PX',
    'section.dsh': '随附 dsh 核心',
    'section.update': '更新',
    check: '检查更新',
    checking: '正在检查…',
    checkFailed: '检查失败，可重试',
    checkIncomplete: '部分信息未能确认',
    lastChecked: '上次检查',
    latestCore: '上游 DSH（供参考）',
    platform: '平台',
    requested: '已发送请求',
    shellDisconnected: '暂时无法连接桌面客户端',
    notChecked: '尚未检查',
    checkedReadOnly: '查询完成（此环境不支持安装）',
    upToDate: '已是最新版本',
    available: '有新版本可用',
    current: '当前',
    latest: '最新',
    releaseNotes: '发布说明',
    openRelease: '打开发布页',
    paths: '目录',
    dataDir: '数据目录',
    logFile: '日志文件',
    copyHint: '路径可复制，也可以直接用下面的按钮打开。',
    copy: '复制',
    copied: '已复制',
    openDataDir: '打开数据目录',
    openLog: '打开日志',
    opened: '已打开',
    openFailed: '打开失败',
    unavailable: '无法读取版本信息',
    shellState: '外壳状态',
    readyPrefix: '新版本已下载完成：',
    installNow: '重启并安装',
    installing: '正在请求…',
    note: '更新会在后台下载。点击安装后，有任务运行时会等待任务结束，也可以取消等待。已有会话、配置与自行添加的插件会保留。'
  },
  en: {
    nav: 'Versions & updates',
    loading: 'Reading version information…',
    'section.app': 'DSH-PX',
    'section.dsh': 'Bundled dsh core',
    'section.update': 'Updates',
    check: 'Check for updates',
    checking: 'Checking…',
    checkFailed: 'Check failed; retry',
    checkIncomplete: 'Some versions could not be verified',
    lastChecked: 'Last checked',
    latestCore: 'Upstream DSH (reference)',
    platform: 'Platform',
    requested: 'Request sent',
    shellDisconnected: 'Desktop client is unreachable',
    notChecked: 'Not checked yet',
    checkedReadOnly: 'Checked (installation unavailable here)',
    upToDate: 'Up to date',
    available: 'A new version is available',
    current: 'Current',
    latest: 'Latest',
    releaseNotes: 'Release notes',
    openRelease: 'Open release page',
    paths: 'Locations',
    dataDir: 'Data directory',
    logFile: 'Log file',
    copyHint: 'Copy a path, or open it directly with the buttons below.',
    copy: 'Copy',
    copied: 'Copied',
    openDataDir: 'Open data folder',
    openLog: 'Open log',
    opened: 'Opened',
    openFailed: 'Failed',
    unavailable: 'Could not read version information',
    shellState: 'Shell status',
    readyPrefix: 'Update downloaded: ',
    installNow: 'Restart and install',
    installing: 'Requesting…',
    note: 'Updates download in the background. Installation waits for active work to finish and can be cancelled while waiting. Existing conversations, settings, and added plugins are preserved.'
  }
}

/** `/status` 端点的响应（字段由宿主半边决定）。 */
interface StatusPayload {
  current: { app: string | null; dsh: string | null; platform: string | null }
  manifestPath: string | null
  repository: string
}

/** `/check` 端点的响应。 */
interface CheckPayload {
  checkedAt: string
  current: { app: string; dsh: string; platform: string }
  latest: { app: string | null; dsh: string | null }
  updateAvailable: { app: boolean; dsh: boolean }
  releaseUrl: string | null
  releaseNotes: string | null
  errors: string[]
}

interface ShellStatePayload {
  instanceId?: string
  lastAction?: { id: string; status: string; message: string }
  pendingOperation?: { action: string; message: string; canCancel?: boolean }
  supported?: boolean
  phase: 'idle' | 'checking' | 'downloading' | 'ready' | 'installing' | 'error'
  status: string
  version: string | null
  percent: number | null
  error: string | null
  available?: boolean
  lastCheckedAt?: string | null
}

/** 一次性取 JSON；失败抛出可读错误。 */
async function getJson<T>(path: string): Promise<T> {
  return requestJson<T>(path)
}

/** 一行「标签 + 值」。 */
function Row({ label, value }: { label: string; value: string }): unknown {
  return (
    <div style={{ display: 'flex', gap: 12, padding: '7px 0', alignItems: 'baseline' }}>
      <span style={{ flex: '0 0 132px', opacity: 0.62, fontSize: 13 }}>{label}</span>
      <span style={{ fontSize: 14, wordBreak: 'break-all' }}>{value}</span>
    </div>
  )
}

/** 小标题。 */
function Heading({ children }: { children: string }): unknown {
  return (
    <div
      style={{ fontSize: 13, fontWeight: 600, opacity: 0.75, margin: '18px 0 4px', letterSpacing: '.02em' }}
    >
      {children}
    </div>
  )
}

/** 可复制的路径行。 */
function PathRow({
  label,
  value,
  copyLabel,
  copiedLabel
}: {
  label: string
  value: string
  copyLabel: string
  copiedLabel: string
}): unknown {
  const [copied, setCopied] = useState(false)
  const copy = useCallback(() => {
    void navigator.clipboard
      ?.writeText(value)
      .then(() => {
        setCopied(true)
        setTimeout(() => setCopied(false), 1600)
      })
      .catch(() => {
        /* 剪贴板不可用：不打断用户 */
      })
  }, [value])
  return (
    <div style={{ display: 'flex', gap: 12, padding: '7px 0', alignItems: 'baseline' }}>
      <span style={{ flex: '0 0 132px', opacity: 0.62, fontSize: 13 }}>{label}</span>
      <code style={{ fontSize: 12.5, wordBreak: 'break-all', flex: 1 }}>{value}</code>
      <button
        type="button"
        onClick={copy}
        style={{
          flex: 'none',
          cursor: 'pointer',
          fontSize: 12,
          padding: '2px 10px',
          borderRadius: 6,
          border: '1px solid currentColor',
          background: 'transparent',
          color: 'inherit',
          opacity: 0.7
        }}
      >
        {copied ? copiedLabel : copyLabel}
      </button>
    </div>
  )
}

/** Update availability stays in a nonmodal banner so active work keeps keyboard focus. */
function UpdateBanner({
  state,
  onInstall,
  installing,
  t
}: {
  state: ShellStatePayload
  onInstall: () => void
  installing: boolean
  t: (key: string) => string
}): unknown {
  const tone =
    state.phase === 'error'
      ? 'var(--dsw-alias-state-error-primary,#bc3946)'
      : 'var(--dsw-alias-state-success-primary,#23835d)'
  return (
    <div
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: 12,
        alignItems: 'center',
        margin: '0 0 16px',
        padding: '10px 14px',
        borderRadius: 10,
        border: `1px solid ${tone}`,
        background: `color-mix(in srgb, ${tone} 10%, transparent)`
      }}
    >
      <div
        role="status"
        style={{ flex: '1 1 220px', minWidth: 0, overflowWrap: 'anywhere', fontSize: 13, lineHeight: 1.6 }}
      >
        <div>{state.phase === 'ready' ? `${t('readyPrefix')}${state.version ?? ''}` : state.status}</div>
        {state.phase === 'downloading' && state.percent !== null ? (
          <div style={{ opacity: 0.75, fontSize: 12 }}>{state.percent}%</div>
        ) : null}
        {state.phase === 'error' && state.error !== null ? (
          <div style={{ opacity: 0.75, fontSize: 12 }}>{state.error}</div>
        ) : null}
      </div>
      {state.phase === 'ready' ? (
        <button
          type="button"
          onClick={onInstall}
          disabled={installing}
          style={{
            flex: 'none',
            cursor: installing ? 'default' : 'pointer',
            fontSize: 13,
            padding: '5px 14px',
            borderRadius: 8,
            border: '1px solid currentColor',
            background: 'transparent',
            color: 'inherit',
            opacity: installing ? 0.5 : 0.95
          }}
        >
          {installing ? t('installing') : t('installNow')}
        </button>
      ) : null}
    </div>
  )
}

/**
 * 设置页里的 DSH-PX 分区。
 * @param props - 宿主注入面（本站点用 `t` 翻译函数）。
 */
function DshPxSection({ t }: SlotComponentProps): unknown {
  const tr = (key: string): string => (typeof t === 'function' ? t(key) : key)
  const [status, setStatus] = useState<StatusPayload | null>(null)
  const [statusError, setStatusError] = useState<string | null>(null)
  const [check, setCheck] = useState<CheckPayload | null>(null)
  const [checking, setChecking] = useState(false)
  const [checkError, setCheckError] = useState<string | null>(null)
  const [checkedAt, setCheckedAt] = useState<string | null>(null)
  const [shell, setShell] = useState<ShellStatePayload | null>(null)
  const [installing, setInstalling] = useState(false)
  const [installError, setInstallError] = useState<string | null>(null)
  const [shellError, setShellError] = useState(false)

  // 挂载时只读本地信息，**不联网** —— 打开设置页不该触发网络请求。
  useEffect(() => {
    let alive = true
    getJson<StatusPayload>(`${ROUTE_PREFIX}/status`)
      .then((v) => {
        if (alive) setStatus(v)
      })
      .catch((err: unknown) => {
        if (alive) setStatusError(err instanceof Error ? err.message : String(err))
      })
    return () => {
      alive = false
    }
  }, [])

  // 轮询外壳状态。
  //
  // 为什么是轮询而不是推送：界面在外壳的**对等 HTTP 面**之外，外壳无法主动推给
  // 它；而要为此新建一条 WebSocket/SSE 通道，代价远大于收益。3 秒一次、
  // 且只在设置页打开时轮询（组件卸载即停），开销可忽略。
  useEffect(() => {
    let alive = true
    let timer: ReturnType<typeof setTimeout>
    const tick = (): void => {
      getJson<ShellStatePayload>(`${ROUTE_PREFIX}/shell-state`)
        .then((v) => {
          if (alive) {
            setShell(v)
            setShellError(false)
          }
        })
        .catch(() => {
          if (alive) setShellError(true)
        })
        .finally(() => {
          if (alive) timer = setTimeout(tick, 3000)
        })
    }
    tick()
    return () => {
      alive = false
      clearTimeout(timer)
    }
  }, [])

  const doInstall = useCallback((): void => {
    setInstalling(true)
    setInstallError(null)
    requestJson(`${ROUTE_PREFIX}/install`, { method: 'POST' })
      .then(() => getJson<ShellStatePayload>(`${ROUTE_PREFIX}/shell-state`))
      .then(setShell)
      .catch((err: unknown) => setInstallError(err instanceof Error ? err.message : String(err)))
      .finally(() => setInstalling(false))
  }, [])

  const doCheck = useCallback((): void => {
    setChecking(true)
    setCheck(null)
    setCheckError(null)
    const versions = requestJson<CheckPayload>(`${ROUTE_PREFIX}/check`, {}, true).then(setCheck)
    const desktop =
      shell?.available === true && shell.supported !== false
        ? requestJson(`${ROUTE_PREFIX}/check-shell`, { method: 'POST' })
        : Promise.resolve()
    Promise.allSettled([versions, desktop])
      .then((results) => {
        const errors = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected')
        if (errors.length)
          setCheckError(
            [
              ...new Set(errors.map((r) => (r.reason instanceof Error ? r.reason.message : String(r.reason))))
            ].join('；')
          )
      })
      .finally(() => {
        setChecking(false)
        setCheckedAt(new Date().toISOString())
      })
  }, [shell?.available, shell?.supported])

  const updateLabel = ((): string => {
    if (checking) return tr('checking')
    if (shell?.supported === false && check && check.errors.length === 0) return tr('checkedReadOnly')
    if (shell?.available && shell.supported !== false) return tr(desktopCheckLabel(shell, shellError))
    return tr(checkLabel(check, checkError !== null))
  })()
  const lastChecked = [checkedAt, shell?.lastCheckedAt]
    .filter((value): value is string => typeof value === 'string' && Number.isFinite(Date.parse(value)))
    .sort((a, b) => Date.parse(b) - Date.parse(a))[0]

  return (
    <div className="px-ui" style={{ padding: '4px 2px 24px', maxWidth: 620 }}>
      {/* 更新就绪/失败时，先给一条**非阻塞**横幅（见 UpdateBanner 的说明）。 */}
      {shell !== null && ['ready', 'error', 'downloading', 'installing'].includes(shell.phase) ? (
        <UpdateBanner
          state={shell}
          onInstall={doInstall}
          installing={installing || shellError || !!shell.pendingOperation}
          t={tr}
        />
      ) : null}
      {shell?.pendingOperation ? (
        <div role="status" style={{ marginBottom: 12 }}>
          <p>{shell.pendingOperation.message}</p>
          <button
            disabled={shell.pendingOperation.canCancel === false}
            onClick={() => {
              void requestJson(`${ROUTE_PREFIX}/open?what=cancel-pending`, { method: 'POST' }).catch(
                (error: unknown) => setInstallError(error instanceof Error ? error.message : String(error))
              )
            }}
          >
            取消等待
          </button>
        </div>
      ) : null}
      {shell?.lastAction && ['failed', 'rejected'].includes(shell.lastAction.status) ? (
        <p role="alert">{shell.lastAction.message}</p>
      ) : null}
      {installError !== null ? (
        <div role="alert" style={{ overflowWrap: 'anywhere' }}>
          {installError}
        </div>
      ) : null}
      {shellError ? <div role="status">{tr('shellDisconnected')}</div> : null}

      <h2 style={{ margin: '0 0 8px' }}>{tr('section.app')}</h2>
      {statusError !== null ? (
        <div style={{ fontSize: 13, opacity: 0.8 }}>
          {tr('unavailable')}（{statusError}）
        </div>
      ) : (
        <Row label={tr('current')} value={status?.current.app ?? tr('loading')} />
      )}

      <Heading>{tr('section.update')}</Heading>
      <Row
        label={tr('latest')}
        value={
          shell?.available && shell.supported !== false && !shellError
            ? (shell.version ?? '—')
            : (check?.latest.app ?? '—')
        }
      />
      <Row
        label={tr('lastChecked')}
        value={lastChecked ? new Date(lastChecked).toLocaleString() : tr('notChecked')}
      />
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center', padding: '6px 0' }}>
        <span style={{ flex: '0 0 132px', opacity: 0.62, fontSize: 13 }}>{tr('section.update')}</span>
        <span style={{ fontSize: 14 }}>{updateLabel}</span>
        <button
          type="button"
          onClick={doCheck}
          disabled={checking || shell?.phase === 'installing'}
          style={{
            cursor: checking ? 'default' : 'pointer',
            fontSize: 13,
            padding: '4px 12px',
            borderRadius: 8,
            border: '1px solid currentColor',
            background: 'transparent',
            color: 'inherit',
            opacity: checking ? 0.5 : 0.85
          }}
        >
          {checking ? tr('checking') : tr('check')}
        </button>
      </div>
      {check?.releaseUrl && safeReleaseUrl(check.releaseUrl, status?.repository) ? (
        <p>
          <a href={check.releaseUrl} target="_blank" rel="noreferrer">
            {tr('openRelease')}
          </a>
        </p>
      ) : null}
      {checkError !== null ? (
        <div role="alert" style={{ fontSize: 12.5, opacity: 0.8, overflowWrap: 'anywhere' }}>
          {checkError}
        </div>
      ) : null}
      {check !== null && check.errors.length > 0 ? (
        <div role="status" style={{ fontSize: 12.5, opacity: 0.8, overflowWrap: 'anywhere' }}>
          {check.errors.join('；')}
        </div>
      ) : null}

      {/* 目录信息来自宿主端点；设置页在浏览器围栏内，不能自己打开文件系统。
          因此：路径可复制，另有按钮经宿主端点请外壳去打开。 */}
      <details style={{ marginTop: 24, borderTop: '1px solid #8883', paddingTop: 16 }}>
        <summary style={{ cursor: 'pointer' }}>{tr('paths')}</summary>
        <Heading>{tr('section.dsh')}</Heading>
        <Row label={tr('current')} value={status?.current.dsh ?? tr('loading')} />
        <Row label={tr('latestCore')} value={check?.latest.dsh ?? '—'} />
        <Row label={tr('platform')} value={status?.current.platform ?? '—'} />
        {shell?.available ? <Row label={tr('shellState')} value={shell.status} /> : null}
        <div style={{ fontSize: 12, opacity: 0.6, marginBottom: 2 }}>{tr('copyHint')}</div>

        <div style={{ display: 'flex', gap: 8, margin: '8px 0 4px' }}>
          <OpenButton what="open-data" label={tr('openDataDir')} t={tr} />
          <OpenButton what="open-log" label={tr('openLog')} t={tr} />
        </div>

        {status?.manifestPath !== null && status?.manifestPath !== undefined ? (
          <PathRow
            label="manifest"
            value={status.manifestPath}
            copyLabel={tr('copy')}
            copiedLabel={tr('copied')}
          />
        ) : null}
      </details>
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
function OpenButton({
  what,
  label,
  t
}: {
  what: 'open-data' | 'open-log'
  label: string
  t: (key: string) => string
}): unknown {
  const [state, setState] = useState<'idle' | 'sent' | 'failed'>('idle')
  const open = useCallback((): void => {
    setState('idle')
    fetch(`${ROUTE_PREFIX}/open?what=${what}`, { method: 'POST' })
      .then((r) => {
        setState(r.ok ? 'sent' : 'failed')
      })
      .catch(() => {
        setState('failed')
      })
  }, [what])
  const text = state === 'sent' ? t('requested') : state === 'failed' ? t('openFailed') : label
  return (
    <button
      type="button"
      onClick={open}
      style={{
        cursor: 'pointer',
        fontSize: 13,
        padding: '4px 12px',
        borderRadius: 8,
        border: '1px solid currentColor',
        background: 'transparent',
        color: 'inherit',
        opacity: state === 'failed' ? 0.5 : 0.85
      }}
    >
      {text}
    </button>
  )
}

/**
 * 客户端插件入口。
 * @param ctx - 客户端 cordis 上下文。
 */
export function apply(ctx: ClientContext): void {
  installUiStyles(ctx)
  // 注册本站点的中英文字典。用 ctx.effect 挂上，插件卸载时自动清理。
  ctx.effect?.(() => {
    const disposers = [ctx.locale.register(NS, 'zh', DICT.zh), ctx.locale.register(NS, 'en', DICT.en)]
    return () => {
      for (const d of disposers) d()
    }
  }, 'dsh-px-updater: dictionaries')

  // 等 settings.section 插槽就绪再注册（见文件头说明：不能用 get）。
  ctx.slots.inject('settings.section', () =>
    ctx.slots.register(
      {
        name: 'settings.section',
        id: 'dsh-px',
        // 排在官方分区之后：它们是 dsh 自身的设置，我们这一块是外壳附加信息。
        order: 100,
        label: () => ctx.locale.bind(NS)('nav'),
        locale: NS
      },
      DshPxSection
    )
  )
}
