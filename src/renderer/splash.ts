/**
 * 首启进度页的脚本。
 *
 * ## 为什么这个页面存在
 *
 * 首启在**跨卷**场景下要逐文件复制上万个文件（分钟级），旧实现是同步复制、
 * 界面完全冻结，用户只能看到一个白窗口；同卷时靠硬链接只要几秒，
 * 但**不能因此就不给反馈** —— 没人能区分"在干活"和"卡死了"。
 *
 * 这里刻意不用模态框：用户在更新交互上已明确要求"不要打断式弹窗"，
 * 启动进度同理，画在应用自己的窗口里即可。
 *
 * ## 这个文件为什么是 renderer 入口
 *
 * 进度页原本是主进程里的一整段 HTML 模板字符串（`splashHtml()`），
 * 靠 `data:` URL 加载。那带来两个问题：
 *   1. HTML/CSS 埋在 .ts 里，改样式没有高亮、没有检查；
 *   2. electron-vite 只配了 main，每次构建都报
 *      `(!) renderer and preload config is missing` —— 而那条警告**无法在配置
 *      文件里关掉**（`ignoreConfigWarning` 只能从 CLI 传入，且判据是
 *      `['main','renderer','preload'].filter(f => !config[f])`，`null` 也是 falsy）。
 *      与其压制警告，不如把进度页做成真正的 renderer 入口：警告自然消失，
 *      页面也变得可维护。
 *
 * 页面与主进程之间不加 preload：主进程用 `webContents.executeJavaScript`
 * 直接更新 DOM。这条通道是**单向的**（主进程 → 页面），页面不需要任何特权，
 * 也就不需要暴露任何 IPC 面。
 */

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
