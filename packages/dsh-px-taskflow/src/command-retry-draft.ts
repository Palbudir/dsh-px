import type { CommandRetryRequest } from './command-guidance'
export function commandRetryDraft(request: CommandRetryRequest): string {
  const parameters = JSON.stringify(
    {
      ...request,
      description: '按原命令核对本次执行结果',
      sandbox_permissions: 'danger-full-access',
      justification:
        '原命令返回 spawn EPERM，可能涉及 Windows 受限环境的子进程输出限制；申请仅本次命令的一次性批准，不改变会话默认权限。'
    },
    null,
    2
  ).replace(/`/g, '\\u0060')
  return (
    '我希望申请以下原命令的一次性授权重试。先展示并等待 DSH 原生审批，只有我选择允许一次后才能执行；拒绝、取消或审批不可用就停止。保持默认权限，不改命令、工作目录或测试参数，不改用其他命令绕过限制。完成后核对实际输出，不把准备请求或收到批准当作命令已经成功。\n\n```json\n' +
    parameters +
    '\n```'
  )
}
