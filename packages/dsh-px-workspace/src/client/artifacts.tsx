import type { Panel, Client } from './contracts'
import type { Content } from './panel-types'
import { base, stamp, useData, errorText } from './data'
import { useState } from 'react'
import { panelAvailability, usePanelCapabilities } from './panel-availability'
export function ArtifactsPanel({ ctx, scope, visible }: Panel & { ctx: Client }): unknown {
  const filePanel = panelAvailability(usePanelCapabilities(ctx), 'editor')
  const [openError, setOpenError] = useState('')
  const [pages, setPages] = useState<Array<string | undefined>>([undefined])
  const before = pages[pages.length - 1]
  const { data, error, refresh, loading } = useData<Content>(
    `${base}/content?sessionId=${encodeURIComponent(scope.sessionId)}${before ? '&artifactBefore=' + encodeURIComponent(before) : ''}`,
    visible
  )
  return (
    <div className="px-ui px-panel">
      <h3>会话产物</h3>
      <p className="px-muted">
        汇总 Agent 使用 present 声明的交付。打开的是文件当前内容；原文件移动或删除后需要重新定位。
      </p>
      <button
        disabled={loading}
        onClick={() => {
          setPages([undefined])
          refresh()
        }}
      >
        刷新产物
      </button>
      <span className="px-load-status" role="status">
        {loading ? '正在读取产物…' : ''}
      </span>
      {error ? <p role="alert">{error}</p> : null}
      {!filePanel.enabled ? <p role="status">文件预览暂不可用：{filePanel.reason}</p> : null}
      {openError ? <p role="alert">{openError}</p> : null}
      {!data && !error ? <p>正在读取…</p> : null}
      {data?.artifacts.length === 0 ? (
        <p className="px-empty">此会话还没有交付文件。可以让 Agent 完成任务后展示产物。</p>
      ) : null}
      {data?.artifacts.map((a) => (
        <article className="px-card" key={a.path}>
          <strong>{a.path.split(/[\\/]/).pop()}</strong>
          <p>{a.description || '未填写说明'}</p>
          <p className="px-muted">
            {a.path}
            <br />
            {stamp(a.time)}
          </p>
          <button
            disabled={!filePanel.enabled}
            title={filePanel.enabled ? '打开产物' : filePanel.reason}
            onClick={() => {
              try {
                const live = ctx.capabilities.getSnapshot()
                const current = panelAvailability(live, 'editor')
                if (!current.enabled) throw new Error(current.reason)
                live.sidebar!.openFile(scope, a.path)
                setOpenError('')
              } catch (err) {
                setOpenError(errorText(err))
              }
            }}
          >
            打开产物
          </button>
        </article>
      ))}
      {data ? (
        <div className="px-actions">
          <small>
            共 {data.artifactTotal} 项 · 第 {pages.length} 页
          </small>
          {pages.length > 1 ? (
            <button onClick={() => setPages((old) => old.slice(0, -1))}>较新一页</button>
          ) : null}
          {data.nextArtifactBefore ? (
            <button onClick={() => setPages((old) => [...old, data.nextArtifactBefore!])}>更早产物</button>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
