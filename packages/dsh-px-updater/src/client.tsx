/** Pack version and signed update notice in the native DSH settings slot. */
import { installUiStyles } from '../../shared/ui'

import { useCallback, useEffect, useState } from 'react'
import type { ClientContext } from '@deepseek-ai/cordis'
import type { SlotComponentProps } from '@deepseek-ai/dsh-client-ui-slots'
import { requestJson, checkLabel, safeReleaseUrl } from './client-data'

/** 本插件的客户端模块 id；必须与 package.json 的包名一致（宿主用它索引模块）。 */
const NS = 'dsh-px-updater'

/** 宿主半边注册的 HTTP 端点前缀；必须与 lib/index.js 的 `routePrefix` 默认值一致。 */
const ROUTE_PREFIX = '/dsh-px-updater'

export const inject = ['slots', 'locale']

const DICT: Record<string, Record<string, string>> = {
  zh: {
    nav: 'DSH-PX 版本',
    loading: '正在读取版本信息…',
    'section.app': 'DSH-PX Pack',
    'section.update': 'Pack 更新',
    pack: '插件整合包',
    host: '适配宿主',
    candidate: '候选构建（未经发布门禁）',
    unknown: '未知',
    check: '检查更新',
    checking: '正在检查…',
    checkFailed: '检查失败，可重试',
    lastChecked: '上次检查',
    notChecked: '尚未检查',
    upToDate: '已是最新版本',
    available: '有新版本可用',
    latest: '已签名的最新版本',
    openRelease: '打开发布页',
    unavailable: '无法读取版本信息',
    note: 'Pack 更新只做提示：在官方插件管理器中安装新版本后按提示重启服务。桌面客户端的更新由客户端自身负责，这里不控制窗口、重启或安装。'
  },
  en: {
    nav: 'DSH-PX version',
    loading: 'Reading version information…',
    'section.app': 'DSH-PX Pack',
    'section.update': 'Pack updates',
    pack: 'Plugin pack',
    host: 'Target host',
    candidate: 'Candidate build (not release-gated)',
    unknown: 'Unknown',
    check: 'Check for updates',
    checking: 'Checking…',
    checkFailed: 'Check failed; retry',
    lastChecked: 'Last checked',
    notChecked: 'Not checked yet',
    upToDate: 'Up to date',
    available: 'A new version is available',
    latest: 'Latest signed version',
    openRelease: 'Open release page',
    unavailable: 'Could not read version information',
    note: 'Pack updates are announced only: install the new version with the native plugin manager and restart the service when prompted. Desktop client updates belong to the client; this page does not control windows, restarts or installation.'
  }
}

interface StatusPayload {
  version: string
  pack: { version: string | null; hostVersion: string | null; candidate: boolean | null }
  repository: string
}

interface CheckPayload {
  checkedAt: string
  current: { pack: string }
  latest: { pack: string | null; hostVersion: string | null; issuedAt: string | null }
  updateAvailable: boolean
  releaseUrl: string | null
  error: string | null
}

function Row({ label, value }: { label: string; value: string }): unknown {
  return (
    <div style={{ display: 'flex', gap: 12, padding: '7px 0', alignItems: 'baseline' }}>
      <span style={{ flex: '0 0 132px', opacity: 0.62, fontSize: 13 }}>{label}</span>
      <span style={{ fontSize: 14, wordBreak: 'break-all' }}>{value}</span>
    </div>
  )
}

function Heading({ children }: { children: string }): unknown {
  return (
    <div
      style={{ fontSize: 13, fontWeight: 600, opacity: 0.75, margin: '18px 0 4px', letterSpacing: '.02em' }}
    >
      {children}
    </div>
  )
}

function DshPxSection({ t }: SlotComponentProps): unknown {
  const tr = (key: string): string => (typeof t === 'function' ? t(key) : key)
  const [status, setStatus] = useState<StatusPayload | null>(null)
  const [statusError, setStatusError] = useState<string | null>(null)
  const [check, setCheck] = useState<CheckPayload | null>(null)
  const [checking, setChecking] = useState(false)
  const [checkError, setCheckError] = useState<string | null>(null)

  // Opening settings reads only local information; network checks require an explicit click.
  useEffect(() => {
    let alive = true
    requestJson<StatusPayload>(`${ROUTE_PREFIX}/status`)
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

  const doCheck = useCallback((): void => {
    setChecking(true)
    setCheck(null)
    setCheckError(null)
    // A failed feed check arrives as 200 with `error` set; only transport failures throw here.
    requestJson<CheckPayload>(`${ROUTE_PREFIX}/check`)
      .then(setCheck)
      .catch((err: unknown) => setCheckError(err instanceof Error ? err.message : String(err)))
      .finally(() => setChecking(false))
  }, [])

  const label = checking ? tr('checking') : tr(checkLabel(check, checkError !== null))
  const packVersion = status?.pack.version ?? status?.version

  return (
    <div className="px-ui" style={{ padding: '4px 2px 24px', maxWidth: 620 }}>
      <h2 style={{ margin: '0 0 8px' }}>{tr('section.app')}</h2>
      {statusError !== null ? (
        <div role="alert" style={{ fontSize: 13, opacity: 0.8 }}>
          {tr('unavailable')}（{statusError}）
        </div>
      ) : (
        <>
          <Row label={tr('pack')} value={packVersion ?? tr('loading')} />
          <Row
            label={tr('host')}
            value={status ? (status.pack.hostVersion ?? tr('unknown')) : tr('loading')}
          />
          {status?.pack.candidate ? <div role="status">{tr('candidate')}</div> : null}
        </>
      )}

      <Heading>{tr('section.update')}</Heading>
      <Row label={tr('latest')} value={check?.latest.pack ?? '—'} />
      <Row
        label={tr('lastChecked')}
        value={check ? new Date(check.checkedAt).toLocaleString() : tr('notChecked')}
      />
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center', padding: '6px 0' }}>
        <span role="status" style={{ fontSize: 14 }}>
          {label}
        </span>
        <button
          type="button"
          onClick={doCheck}
          disabled={checking}
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
      {checkError !== null || check?.error ? (
        <div role="alert" style={{ fontSize: 12.5, opacity: 0.8, overflowWrap: 'anywhere' }}>
          {check?.error ?? checkError}
        </div>
      ) : null}
      <div style={{ fontSize: 12, opacity: 0.55, marginTop: 18, lineHeight: 1.7 }}>{tr('note')}</div>
    </div>
  )
}

export function apply(ctx: ClientContext): void {
  installUiStyles(ctx)
  ctx.effect?.(() => {
    const disposers = [ctx.locale.register(NS, 'zh', DICT.zh), ctx.locale.register(NS, 'en', DICT.en)]
    return () => {
      for (const d of disposers) d()
    }
  }, 'dsh-px-updater: dictionaries')

  // Wait for the slot declaration; `get()` would silently miss a slot declared later.
  ctx.slots.inject('settings.section', () =>
    ctx.slots.register(
      {
        name: 'settings.section',
        id: 'dsh-px',
        order: 100,
        label: () => ctx.locale.bind(NS)('nav'),
        locale: NS
      },
      DshPxSection
    )
  )
}
