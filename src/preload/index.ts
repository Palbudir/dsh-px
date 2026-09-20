/**
 * 进度页的 preload。
 *
 * ## 它做什么
 *
 * 把**窗口标题的看守逻辑**放一层到渲染进程侧，并给页面最小的只读身份信息。
 *
 * ## 为什么值得存在（而不是留空或干脆不要）
 *
 * 进度页本身不需要任何特权 API —— 主进程用 `webContents.executeJavaScript`
 * 单向更新两个文本节点就够了。但：
 *
 *   - 一个**空的** preload 入口会让构建产出 "Generated an empty chunk" 警告，
 *     而且那个文件在交付物里是纯冗余；
 *   - 把 preload 从配置里去掉，electron-vite 又会回到
 *     `(!) renderer and preload config is missing` 警告（判据是
 *     `['main','renderer','preload'].filter(f => !config[f])`，`null` 也是 falsy，
 *     且该警告无法在配置文件里关掉）。
 *
 * 更实际的理由：`page-title-updated` 的拦截只做在**主进程**侧。dsh 的 Web UI
 * 会把窗口标题设成当前会话名（用户实测看到的就是会话名），主进程已经
 * `preventDefault()` 挡住了。这里再加一层渲染进程侧的看守，是让"窗口标题属于
 * 应用、不属于文档"这个约束在两个进程里都成立 —— 单点依赖一旦被将来某次重构
 * 去掉，症状（标题变成会话名）很难立刻归因，而这条约束是本项目已经修过一次的
 * 真实缺陷。
 *
 * 暴露给页面的只有两个只读字符串，没有函数、没有句柄，不构成能力面。
 *
 * @module dsh-px/preload
 */
import { contextBridge } from 'electron'

/** 窗口标题（与主进程保持一致的取值）。 */
const APP_TITLE = 'DSH-PX'

// 渲染进程侧看守：页面改标题就立刻改回来。
//
// 用 MutationObserver 而不是监听某个事件，是因为标题可能由框架在任意时刻改写，
// 没有稳定事件可依赖；观察 <title> 节点最直接。
window.addEventListener('DOMContentLoaded', () => {
  const guard = (): void => { document.title = APP_TITLE }
  guard()
  const titleNode = document.querySelector('title')
  if (titleNode !== null) {
    new MutationObserver(guard).observe(titleNode, { childList: true, characterData: true, subtree: true })
  }
})

// 只读身份信息；页面不依赖它渲染，仅供诊断时查看。
contextBridge.exposeInMainWorld('dshPxShell', {
  app: APP_TITLE,
  electron: process.versions.electron
})
