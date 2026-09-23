import { quoteDraft, type Annotation } from './model'
export interface InputContext {
  sessions: { scope: (id: string) => any }
  conversation: { input: { for: (ctx: any) => { state: { getSnapshot: () => { draft: string, draftRev: number, phase: string } }, notify: (level: 'info' | 'error', text: string) => void } } }
}
export function insertQuote (ctx: InputContext, target: string, note: Pick<Annotation, 'sessionId' | 'seq' | 'quote' | 'note'>): void {
  const actx = ctx.sessions.scope(target)
  if (!actx) throw new Error('请先打开目标会话')
  const input = ctx.conversation.input.for(actx), state = input.state.getSnapshot()
  if (state.phase !== 'plain') throw new Error('输入框正在提交或处于命令模式，请稍后引用')
  // Cordis filters listeners using the explicit dispatch context, NOT the receiver.
  // Omitting the first actx can mutate another session with the same draft revision.
  const accepted = actx.bail(actx, 'slash/input-insert-text', { text: (state.draft ? '\n\n' : '') + quoteDraft(note), span: { start: state.draft.length, end: state.draft.length, draftRev: state.draftRev } })
  if (accepted !== true) throw new Error('输入框尚未就绪或草稿发生变化，请重试')
  input.notify('info', '引用已加入草稿，请检查后发送。')
}
