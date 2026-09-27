import { useEffect, useState } from 'react'
import type { Client, PanelCapabilities } from './contracts'
import { useSnapshot } from './data'

export interface PanelAvailability {
  enabled: boolean
  state: 'ready' | 'missing' | 'disabled' | 'unknown'
  reason: string
}
const unavailable = (
  state: Exclude<PanelAvailability['state'], 'ready'>,
  reason: string
): PanelAvailability => ({ enabled: false, state, reason })

/** Preferences do not prove registration. Use each provider's public registry. */
export function panelAvailability(capabilities: PanelCapabilities, type: string): PanelAvailability {
  const { sidebar, terminal, nativeTabs } = capabilities
  try {
    if (type === 'terminal') {
      if (sidebar) {
        if (typeof sidebar.isTabEnabled !== 'function')
          return unavailable('unknown', '无法确认终端设置，请检查侧边卡片版本。')
        const preference = sidebar.isTabEnabled(type)
        if (preference === false) return unavailable('disabled', '已在“侧边卡片”设置中禁用。')
        if (preference !== true) return unavailable('unknown', '暂时无法确认终端设置。')
      }
      if (typeof terminal?.openTabIn !== 'function') return unavailable('missing', '原生终端入口尚未加载。')
      if (typeof nativeTabs?.get !== 'function' || typeof nativeTabs.subscribe !== 'function')
        return unavailable('missing', '原生终端面板状态尚未就绪。')
      if (!nativeTabs.get(type)) return unavailable('missing', '终端插件尚未加载。')
    } else {
      if (!sidebar) return unavailable('missing', '侧边卡片服务尚未加载。')
      if (
        typeof sidebar.getTab !== 'function' ||
        typeof sidebar.subscribe !== 'function' ||
        typeof sidebar.subscribeState !== 'function' ||
        typeof sidebar.isTabEnabled !== 'function'
      )
        return unavailable('unknown', '侧边卡片版本未提供完整面板状态，请检查插件版本。')
      if (!sidebar.getTab(type)) return unavailable('missing', '提供此面板的插件尚未加载。')
      const preference = sidebar.isTabEnabled(type)
      if (preference === false) return unavailable('disabled', '已在“侧边卡片”设置中禁用。')
      if (preference !== true) return unavailable('unknown', '暂时无法确认面板设置。')
    }
    return { enabled: true, state: 'ready', reason: '' }
  } catch {
    return unavailable('unknown', '面板状态暂时无法读取，请到“运行与帮助”检查。')
  }
}

/** Registry events and preference/state events are separate in the pinned sidebar API. */
export function usePanelCapabilities(ctx: Client): PanelCapabilities {
  const capabilities = useSnapshot(ctx.capabilities)
  const [, refresh] = useState(0)
  useEffect(() => {
    const changed = (): void => refresh((value) => value + 1)
    const offRegistry =
      typeof capabilities.sidebar?.subscribe === 'function'
        ? capabilities.sidebar.subscribe(changed)
        : undefined
    const offState =
      typeof capabilities.sidebar?.subscribeState === 'function'
        ? capabilities.sidebar.subscribeState(changed)
        : undefined
    const offNative =
      typeof capabilities.nativeTabs?.subscribe === 'function'
        ? capabilities.nativeTabs.subscribe(changed)
        : undefined
    changed() // Recheck registrations that appeared between render and subscription.
    return () => {
      offRegistry?.()
      offState?.()
      offNative?.()
    }
  }, [capabilities.sidebar, capabilities.nativeTabs])
  return capabilities
}
