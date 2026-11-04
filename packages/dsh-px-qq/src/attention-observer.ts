import { ChannelAttentionObserver } from '../../shared/channel-attention-observer'
import type { QqNotice } from './attention-inbox'
export type { AttentionDecision } from '../../shared/channel-attention-observer'
export class QqAttentionObserver extends ChannelAttentionObserver<QqNotice> {}
