class FileEditError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message)
  }
}
/** Authenticated user editor operations retain their existing file authority, but never silently overwrite a changed base. */
export async function saveObservedFile(
  fs: any,
  cwd: string,
  path: string,
  content: unknown,
  expectedContent: unknown,
  limit = 2 * 1024 * 1024
): Promise<{ ok: true }> {
  if (typeof content !== 'string' || Buffer.byteLength(content, 'utf8') > limit)
    throw new FileEditError('保存内容无效或超过编辑大小限制', 400)
  if (
    expectedContent !== undefined &&
    (typeof expectedContent !== 'string' || Buffer.byteLength(expectedContent, 'utf8') > limit)
  )
    throw new FileEditError('文件读取基线无效', 400)
  const target = await fs.resolve(path, { cwd }),
    before = await fs.stat(target)
  let guard: { kind: 'createIfAbsent' } | { kind: 'replaceIfVersion'; version: string }
  if (before) {
    if (before.type !== 'file' || typeof before.version !== 'string' || (before.size ?? 0) > limit)
      throw new FileEditError('此文件暂不能在侧栏安全编辑', 400)
    if (typeof expectedContent !== 'string' || (await fs.readText(target)) !== expectedContent)
      throw new FileEditError(
        '文件已被其他操作修改。你的草稿仍保留；请先复制需要的改动，再重新读取并合并后保存。',
        409
      )
    guard = { kind: 'replaceIfVersion', version: before.version }
  } else {
    if (expectedContent !== undefined)
      throw new FileEditError('原文件已被删除或移动，未重新创建。你的草稿仍保留。', 409)
    guard = { kind: 'createIfAbsent' }
  }
  try {
    // This is the human-operated file editor, not an Agent tool or permission escalation.
    await fs.writeText(target, content, guard, undefined, { mode: 'danger-full-access', workspaceRoot: cwd })
  } catch (e: any) {
    if (['FS_STALE_VERSION', 'FS_NOT_OBSERVED'].includes(e?.code))
      throw new FileEditError('文件在保存前再次变化，未覆盖；请重新读取并合并改动。', 409)
    throw e
  }
  return { ok: true }
}
export function installFileEditing(ctx: any): void {
  ctx.inject(['fs'], (host: any) =>
    host.provide('pxFileEditing', {
      save: (cwd: string, path: string, content: unknown, expected: unknown, limit: number) =>
        saveObservedFile(host.fs, cwd, path, content, expected, limit)
    })
  )
}
