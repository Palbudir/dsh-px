import { useEffect, useRef, useState } from 'react'
import { RequestError, requestJson } from '../../../shared/client-http'
import { parseTabs, type ServiceLayout, type TabState } from '../../../shared/session-layout'

const route = '/dsh-px-workbench/layout'
const legacyKey = 'dsh-px.session-tabs.v1'
export function useSessionLayout() {
  const [tabs, setTabs] = useState<TabState>(() => parseTabs(null))
  const [ready, setReady] = useState(false)
  const [warning, setWarning] = useState('')
  const [conflict, setConflict] = useState(false)
  const metadata = useRef<ServiceLayout | null>(null)
  const latest = useRef(tabs)
  latest.current = tabs
  const pending = useRef(false),
    blocked = useRef(false),
    active = useRef(true)
  const saved = useRef('')
  const backup = (value: TabState): void => {
    try {
      localStorage.setItem(
        metadata.current ? `dsh-px.session-tabs.v2.${metadata.current.serviceId}` : legacyKey,
        JSON.stringify(value)
      )
    } catch {
      /* The server remains the durable source; failures are shown by save(). */
    }
  }
  async function save(): Promise<void> {
    if (!metadata.current || pending.current || blocked.current) return
    pending.current = true
    try {
      while (JSON.stringify(latest.current) !== saved.current && !blocked.current) {
        const layout = latest.current
        const result: ServiceLayout = await requestJson<ServiceLayout>(route, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...metadata.current, layout })
        })
        metadata.current = result
        saved.current = JSON.stringify(layout)
        if (active.current) {
          setWarning('')
          setConflict(false)
        }
      }
    } catch (err) {
      blocked.current = true
      if (active.current) {
        setConflict(err instanceof RequestError && err.status === 409)
        setWarning(
          (err instanceof Error ? err.message : String(err)) +
            (err instanceof RequestError && err.status === 409 ? '' : ' 当前窗口标签仍然保留。')
        )
      }
    } finally {
      pending.current = false
    }
  }
  async function reload(useCurrent = false): Promise<void> {
    try {
      const result = await requestJson<ServiceLayout>(route)
      if (!active.current) return
      metadata.current = result
      saved.current = JSON.stringify(result.layout)
      blocked.current = false
      setWarning('')
      setConflict(false)
      if (useCurrent) await save()
      else setTabs(result.layout)
    } catch (err) {
      if (active.current) setWarning(err instanceof Error ? err.message : String(err))
    }
  }
  useEffect(() => {
    active.current = true
    const controller = new AbortController()
    void requestJson<ServiceLayout>(route, { signal: controller.signal })
      .then((result) => {
        if (!active.current) return
        metadata.current = result
        saved.current = JSON.stringify(result.layout)
        let restored = result.layout
        if (result.revision === 0) {
          try {
            restored = parseTabs(localStorage.getItem(legacyKey))
          } catch {
            /* no prior origin layout */
          }
        }
        setTabs(restored)
        setReady(true)
      })
      .catch((err) => {
        if (!active.current || controller.signal.aborted) return
        try {
          setTabs(parseTabs(localStorage.getItem(legacyKey)))
        } catch {
          /* unavailable */
        }
        setWarning(
          `无法读取服务布局：${err instanceof Error ? err.message : String(err)}。当前标签仅保留在此浏览器地址。`
        )
        setReady(true)
      })
    return () => {
      active.current = false
      controller.abort()
    }
  }, [])
  useEffect(() => {
    if (!ready) return
    backup(tabs)
    void save()
  }, [tabs, ready])
  return {
    tabs,
    setTabs,
    ready,
    warning,
    conflict,
    restore: () => reload(false),
    keepCurrent: () => reload(true)
  }
}
