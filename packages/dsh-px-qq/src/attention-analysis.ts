import { analyzeChannelNotices } from '../../shared/channel-attention-analysis'
import type { QqNotice } from './attention-inbox'
import type { AttentionDecision } from './attention-observer'
import { QqError, type QqSettings } from './policy'
export async function analyzeQqNotices(
  host: any,
  settings: QqSettings,
  rows: QqNotice[],
  signal: AbortSignal,
  started: (jobId: string) => void
): Promise<AttentionDecision> {
  try {
    return await analyzeChannelNotices(
      host,
      { ...settings, provider: 'qq', label: 'QQ' },
      rows,
      signal,
      started
    )
  } catch (error) {
    if (signal.aborted) throw signal.reason
    throw error instanceof QqError
      ? error
      : new QqError(error instanceof Error ? error.message : String(error), 503)
  }
}
