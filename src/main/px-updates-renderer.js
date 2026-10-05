const labels = {
  idle: '尚未检查',
  checking: '正在检查…',
  current: '已是最新版本',
  available: '有新版本可用',
  downloading: '正在下载',
  verifying: '正在校验下载…',
  preparing: '正在校验并准备插件包…',
  ready: '下载完成，可以安装',
  installing: '请在主窗口的确认框中选择；确认后客户端会退出并更新…',
  error: '更新失败'
}
const mb = (value) => (value / 1048576).toFixed(1) + ' MB'
function render(value) {
  for (const name of ['pack', 'desktop']) {
    const root = document.getElementById(name),
      state = value[name]
    root.querySelector('.version').textContent =
      '当前 ' +
      state.current +
      (state.version && state.version !== state.current ? '　→　' + state.version : '')
    const status = root.querySelector('.status')
    status.textContent = state.message || labels[state.phase] || state.phase
    status.classList.toggle('error', state.phase === 'error')
    const notice = root.querySelector('.notice')
    notice.textContent = state.notice || ''
    notice.hidden = !state.notice
    if (state.phase === 'downloading')
      status.textContent +=
        ' ' +
        Math.round(state.percent || 0) +
        '%' +
        (state.total
          ? ' · ' +
            mb(state.transferred) +
            ' / ' +
            mb(state.total) +
            ' · ' +
            mb(state.bytesPerSecond || 0) +
            '/s'
          : '')
    const progress = root.querySelector('progress')
    progress.hidden = state.phase !== 'downloading'
    progress.value = state.percent || 0
    for (const button of root.querySelectorAll('button')) {
      const action = button.dataset.action
      button.hidden = action.startsWith('download')
        ? state.phase !== 'available'
        : action.startsWith('install')
          ? state.phase !== 'ready'
          : false
      button.disabled = value.busy || ['downloading', 'installing', 'preparing'].includes(state.phase)
    }
  }
  document.getElementById('recovery').textContent = value.pack.recovery || ''
}
let polling = false
async function refresh() {
  if (polling) return
  polling = true
  try {
    render(await window.pxUpdates.call('status'))
  } catch (error) {
    document.getElementById('recovery').textContent = String(error.message || error)
  } finally {
    polling = false
  }
}
document.addEventListener('click', async (event) => {
  const button = event.target.closest('button[data-action]')
  if (!button || button.disabled) return
  button.disabled = true
  try {
    render(await window.pxUpdates.call(button.dataset.action))
  } catch (error) {
    document.getElementById('recovery').textContent = String(error.message || error)
  }
})
void refresh()
setInterval(refresh, 500)
