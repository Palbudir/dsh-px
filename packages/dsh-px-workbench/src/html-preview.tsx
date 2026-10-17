import { useEffect, useMemo, useState } from 'react'
import { prepareHtmlPreview, type ReadPreviewFile } from './html-assets'
import { nativeFileAddress } from '../../shared/native-navigation'

function HtmlPreview({
  scope,
  path,
  content,
  truncated,
  className,
  read,
  dirty
}: {
  scope: { sessionId: string }
  path: string
  content?: string
  truncated?: boolean
  className?: string
  read: ReadPreviewFile
  dirty?: boolean
}): unknown {
  const key = scope.sessionId + '\0' + path + '\0' + content
  const [state, setState] = useState<{ key: string; url?: string; error?: string } | undefined>(undefined)
  useEffect(() => {
    const ac = new AbortController()
    let url: string | undefined
    void (async () => {
      try {
        if (truncated) throw Error('文件未完整读取，请用外部浏览器打开')
        if (content === undefined) throw Error('文件内容尚未就绪')
        const html = await prepareHtmlPreview(content, path, read, ac.signal)
        ac.signal.throwIfAborted()
        url = URL.createObjectURL(new Blob([html], { type: 'text/html' }))
        setState({ key, url })
      } catch (e: any) {
        if (!ac.signal.aborted) setState({ key, error: e.message ?? String(e) })
      }
    })()
    return () => {
      ac.abort()
      if (url) URL.revokeObjectURL(url)
    }
  }, [key, path, content, truncated, read])
  return (
    <div className={className} style={{ display: 'flex', flexDirection: 'column', minHeight: 0, flex: 1 }}>
      <div style={{ fontSize: 12, padding: '6px 10px', color: 'var(--dsw-alias-label-secondary)' }}>
        {dirty ? '未保存的预览' : '沙箱预览'} · 动态本地请求请通过开发服务器打开
      </div>
      {state?.key !== key ? (
        <p role="status">正在准备 HTML 与本地资源…</p>
      ) : state.error ? (
        <p role="alert">无法预览：{state.error}</p>
      ) : (
        <iframe
          title={path}
          src={state.url}
          sandbox="allow-scripts allow-popups allow-downloads allow-modals"
          referrerPolicy="no-referrer"
          style={{ width: '100%', flex: 1, border: 0, minHeight: 0 }}
        />
      )}
    </div>
  )
}

/** Public native byte reads stay in the parent; the sandbox receives a finite document snapshot only. */
export function installHtmlPreview(ctx: any): void {
  ctx.inject(['sidebarRight'], (host: any) =>
    host.provide('pxFilePreviewLinks', {
      open: (scope: { sessionId: string }, path: string) =>
        host.sidebarRight.openResourceIn(scope.sessionId, nativeFileAddress(scope.sessionId, path))
    })
  )
  ctx.inject(['remote', 'remote.workspaceFiles'], (host: any) => {
    const component = (props: any) => {
      // A stable reader is required: rendering state must not restart resource loading.
      const read = useMemo<ReadPreviewFile>(
        () => async (reference, baseFile, signal) => {
          const result = await host.remote.workspaceFiles.readBytes(
            props.scope.sessionId,
            reference,
            { baseFile },
            signal
          )
          if (!result.ok) throw Error(result.error.message)
          if (!(result.value.data instanceof Uint8Array)) throw Error('原生文件服务返回了不支持的字节格式')
          return result.value
        },
        [props.scope.sessionId]
      )
      return <HtmlPreview {...props} read={read} />
    }
    host.provide('pxHtmlPreview', { component })
  })
}
