export interface DraftInputContext {
  sessions: { scope: (id: string) => any }
  conversation: {
    input: {
      for: (ctx: any) => {
        state: { getSnapshot: () => { draft: string; draftRev: number; phase: string } }
        notify: (level: 'info' | 'error', text: string) => void
      }
    }
  }
}
/** Insert into the explicit session and current draft revision; never submit or execute. */
export function appendToDraft(ctx: DraftInputContext, sessionId: string, text: string, notice: string): void {
  const scope = ctx.sessions.scope(sessionId)
  if (!scope) throw new Error('请先打开目标会话')
  const input = ctx.conversation.input.for(scope),
    state = input.state.getSnapshot()
  if (state.phase !== 'plain') throw new Error('输入框正在提交或处于命令模式，请稍后准备请求')
  const accepted = scope.bail(scope, 'slash/input-insert-text', {
    text: (state.draft ? '\n\n' : '') + text,
    span: { start: state.draft.length, end: state.draft.length, draftRev: state.draftRev }
  })
  if (accepted !== true) throw new Error('输入框尚未就绪或草稿已变化，请重试')
  input.notify('info', notice)
}
