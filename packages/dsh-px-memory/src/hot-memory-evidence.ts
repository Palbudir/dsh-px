import { nativeReader, service } from './history'
import { conversationalSource } from '../../shared/channel-source'

/** Best-effort association with this turn's actual user input; absence remains explicitly unverified. */
export async function currentMemoryEvidence(
  host: any,
  agent: any,
  signal: AbortSignal
): Promise<Array<{ sessionId: string; seq: number }>> {
  const start = service(host, 'sessionProjections')?.stateOf(agent.session, 'turnBoundary')?.openTurnStartSeq
  if (!Number.isSafeInteger(start) || start < 0) return []
  let reader: any
  try {
    reader = await nativeReader(host, agent.session.id, signal)
    const events = (await reader.read(start, 128, { signal })).events
    return events
      .filter(
        (event: any) =>
          event.type === 'user/message' &&
          conversationalSource(event.data?.source) &&
          event.data.content?.some((block: any) => block.type === 'text' && block.text.trim())
      )
      .slice(0, 6)
      .map((event: any) => ({ sessionId: agent.session.id, seq: event.seq }))
  } catch {
    signal.throwIfAborted()
    return []
  } finally {
    await reader?.close()
  }
}
