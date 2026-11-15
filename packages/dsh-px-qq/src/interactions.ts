import {
  ChannelInteractions,
  questionAnswer as answer,
  type Question
} from '../../shared/channel-interactions'
import { QqError } from './policy'
export { approvalText } from '../../shared/channel-interactions'
export type { Question, PendingInteraction } from '../../shared/channel-interactions'
export const questionAnswer = (question: Question, text: string) =>
  answer(question, text, (message, status) => new QqError(message, status))
export class QqInteractions extends ChannelInteractions {
  constructor(send: (chat: string, text: string) => Promise<unknown>, lifetimeMs = 10 * 60_000) {
    super(send, lifetimeMs, {
      label: 'QQ',
      settingsPath: '设置 → QQ 账号 → 待处理请求',
      error: (message, status) => new QqError(message, status)
    })
  }
}
