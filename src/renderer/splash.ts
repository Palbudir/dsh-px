/** 阶段文案元素。 */
const phase = document.getElementById('phase')
/** 进度明细元素。 */
const detail = document.getElementById('detail')

/**
 * 更新进度显示。由主进程经 `executeJavaScript` 调用。
 *
 * 挂到 `window` 上是因为跨进程只能在页面全局作用域里找入口；
 * 这是本页面**唯一**对外开放的能力，且只写两个文本节点。
 */
declare global {
  interface Window {
    __dshPxProgress?: (phaseText: string, detailText: string) => void
  }
}

window.__dshPxProgress = (phaseText: string, detailText: string): void => {
  if (phase !== null) phase.textContent = phaseText
  if (detail !== null) detail.textContent = detailText
}

export {}
