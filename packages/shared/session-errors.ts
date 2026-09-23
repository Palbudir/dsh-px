export function readFailure(error: unknown): {
  status: number
  code: string
  error: string
  retryable: boolean
} {
  const e = error as { name?: string; code?: string; message?: string }
  if (e?.name === 'SessionPersistenceNotFoundError' || e?.code === 'ENOENT')
    return {
      status: 404,
      code: 'SESSION_NOT_FOUND',
      error: '此会话记录不存在，请重新选择会话。',
      retryable: false
    }
  if (
    e?.name === 'SessionPersistenceCorruptionError' ||
    e instanceof SyntaxError ||
    /^(?:corrupt (?:Zstandard )?session log(?::| ")|empty or header-less (?:Zstandard )?session log$)/.test(
      e?.message ?? ''
    )
  )
    return {
      status: 422,
      code: 'SESSION_CORRUPT',
      error: '会话记录损坏，无法可靠读取。请保留日志并检查备份。',
      retryable: false
    }
  if (e?.name === 'SessionFormatUnsupportedError')
    return {
      status: 409,
      code: 'SESSION_FORMAT_UNSUPPORTED',
      error: '当前版本无法读取此会话格式，请使用兼容版本。',
      retryable: false
    }
  if (['EACCES', 'EPERM'].includes(e?.code ?? ''))
    return {
      status: 403,
      code: 'SESSION_ACCESS_DENIED',
      error: '没有读取会话记录的权限，请检查数据目录权限。',
      retryable: false
    }
  if (['EBUSY', 'EAGAIN', 'ETIMEDOUT'].includes(e?.code ?? '') || e?.name === 'SessionAlreadyOwnedError')
    return { status: 503, code: 'SESSION_BUSY', error: '会话记录暂时不可读，请稍后重试。', retryable: true }
  return {
    status: 500,
    code: 'SESSION_READ_FAILED',
    error: '读取会话失败，请重试或检查服务日志。',
    retryable: true
  }
}
