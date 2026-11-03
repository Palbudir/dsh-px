import test from 'node:test'
import assert from 'node:assert/strict'
import { Context } from '@deepseek-ai/cordis'
import SessionStore from '@deepseek-ai/dsh-session'
import SessionProjections from '@deepseek-ai/dsh-session-projection'
import TokenMeter from '@deepseek-ai/dsh-token-meter'
import BasicCompactionEngine from '@deepseek-ai/dsh-compaction-basic'
import { z } from 'zod'
import { createAssistantMessage, createUserMessage } from '@deepseek-ai/dsh-llm'
import {
  captureSegment,
  createSegmentCommitter,
  segmentEvidence,
  registerSegmentBoundary
} from '../packages/dsh-px-memory/src/segment-context'

test('segment evidence distinguishes peer advice and job notices from human messages', () => {
  const messages = [
    {
      role: 'user',
      source: {
        kind: 'plugin:dsh-px-persona-mail',
        version: 1,
        mailId: 'm',
        senderPersonaId: 'a',
        recipientPersonaId: 'b',
        sourceSessionId: 's',
        sourceSeq: 1,
        conversationId: 'a'.repeat(64)
      },
      content: [{ type: 'text', text: 'Peer suggests a plan' }]
    },
    {
      role: 'user',
      source: { kind: 'tool-jobs', form: 'notice' },
      content: [{ type: 'text', text: 'Job finished' }]
    },
    { role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'User request' }] }
  ]
  const evidence: any = segmentEvidence({
    sessionId: 's',
    seqs: [1, 2, 3],
    messages,
    eventHashes: [],
    fingerprint: 'f',
    tokens: 100,
    capturedThrough: 4
  })
  assert.deepEqual(
    evidence.map((row: any) => row.authority),
    ['peer-advice-only', 'runtime-context-not-user-authorization', 'human-message']
  )
})

test(
  'isolated native segment transaction retains newer work, preserves checkpoints and rejects stale or canceled source',
  { timeout: 20000 },
  async () => {
    const app: any = new Context(),
      fibers: any[] = []
    const llm = app.provide('llm', {})
    for (const plugin of [SessionStore, SessionProjections, TokenMeter, BasicCompactionEngine]) {
      const fiber = app.plugin(
        plugin,
        plugin === BasicCompactionEngine ? { auto: false, maxTokens: 876 } : undefined
      )
      fibers.push(fiber)
      await fiber.await()
    }
    let resolve!: () => void, reject!: (error: unknown) => void
    const done = new Promise<void>((yes, no) => {
      resolve = yes
      reject = no
    })
    const feature = app.inject(
      ['sessions', 'tokenMeter', 'sessionProjections', 'compaction'],
      (host: any) => {
        registerSegmentBoundary(host)
        // This transaction fixture has no Agent loop. Supply its public boundary projection contract.
        host.sessionProjections.register({
          key: 'turnBoundary',
          stateVersion: 1,
          stateSchema: z.object({ openTurnStartSeq: z.number().nullable() }),
          init: () => ({ openTurnStartSeq: null }),
          apply: (state: any, event: any) =>
            event.type === 'turn/start'
              ? { openTurnStartSeq: event.seq }
              : event.type === 'turn/end'
                ? { openTurnStartSeq: null }
                : state
        })
        void (async () => {
          const committer = await createSegmentCommitter(app)
          try {
            assert.equal(
              host.compaction.config.maxTokens,
              876,
              'default pressure backend must remain installed'
            )
            const session = host.sessions.create('segmented-native-test'),
              agent = { session, options: { provider: 'fixture', model: 'fixture' } }
            const completedTurn = (turn: number, canary: string) => {
              session.append('turn/start', { turn })
              const first = session.append(
                'user/message',
                createUserMessage({
                  source: { kind: 'user' },
                  content: [{ type: 'text', text: canary + ' repeated factual source '.repeat(900) }]
                }),
                { surfaceOp: 'append' }
              )
              session.append('step/start', { turn, step: 1 })
              const last = session.append(
                'assistant/message',
                {
                  turn,
                  step: 1,
                  stream: [],
                  message: createAssistantMessage({
                    source: { provider: 'fixture', model: 'fixture' },
                    content: [
                      { type: 'reasoning', text: 'PRIVATE_REASONING_NOT_EVIDENCE' },
                      { type: 'text', text: 'Result with evidence. '.repeat(400) }
                    ]
                  })
                },
                { surfaceOp: 'append' }
              )
              session.append('step/end', { turn, step: 1 })
              session.append('turn/end', { turn, reason: { kind: 'completed' } })
              return { first, last }
            }
            const old = completedTurn(1, 'SOURCE_731')
            const second = completedTurn(2, 'SECOND_642')
            session.append('turn/start', { turn: 3 })
            const latest = session.append(
              'user/message',
              createUserMessage({
                source: { kind: 'user' },
                content: [{ type: 'text', text: 'NEW_REQUEST_926 ' + 'keep this '.repeat(500) }]
              }),
              { surfaceOp: 'append' }
            )
            const source = await captureSegment(host, agent, {
              minimumTokens: 5500,
              retainTokens: 1000,
              maximumCharacters: 100000
            })
            assert.ok(source)
            assert.ok(!JSON.stringify(segmentEvidence(source)).includes('PRIVATE_REASONING_NOT_EVIDENCE'))
            assert.deepEqual(source.seqs, [old.first.seq, old.last.seq])
            assert.equal(
              session.snapshotEvents().some((e: any) => e.type === 'compaction/start'),
              false
            )
            const extra = session.append(
              'user/message',
              createUserMessage({
                source: { kind: 'user' },
                content: [{ type: 'text', text: 'NEW_CORRECTION_853' }]
              }),
              { surfaceOp: 'append' }
            )
            const prepared = {
              id: 'segment-one',
              summary: 'SOURCE_731 stage ended. Check original evidence before reusing conclusions.',
              provider: 'fixture',
              model: 'fixture'
            }
            await committer.commit(agent, source, prepared, new AbortController().signal)
            assert.ok(session.surface.nodes.includes(latest.seq))
            assert.ok(session.surface.nodes.includes(extra.seq))
            assert.equal(session.eventAt(old.first.seq).data.content[0].text.startsWith('SOURCE_731'), true)
            const checkpoint = session.surface.nodes.find(
              (seq: number) => ![second.first.seq, second.last.seq, latest.seq, extra.seq].includes(seq)
            )
            assert.match(
              session
                .deriveEventMessage(session.eventAt(checkpoint))
                .content.map((block: any) => block.text ?? '')
                .join('\n'),
              /已压缩片段 segment-one/
            )
            await assert.rejects(
              committer.commit(agent, source, prepared, new AbortController().signal),
              /来源/
            )
            const next = await captureSegment(host, agent, {
              minimumTokens: 5500,
              retainTokens: 1000,
              maximumCharacters: 100000
            })
            assert.ok(next)
            assert.deepEqual(next.seqs, [second.first.seq, second.last.seq])
            const abort = new AbortController()
            abort.abort(new Error('stop-test'))
            await assert.rejects(
              committer.commit(agent, next, { ...prepared, id: 'segment-two' }, abort.signal),
              /stop-test/
            )
            assert.ok(session.surface.nodes.includes(second.first.seq))
            await committer.commit(
              agent,
              next,
              { ...prepared, id: 'segment-two' },
              new AbortController().signal
            )
            assert.ok(
              session.surface.nodes.includes(checkpoint),
              'earlier summary is not recompressed into the later one'
            )
            assert.equal(
              session.snapshotEvents().filter((e: any) => e.type === 'compaction/summary').length,
              2
            )
            const pending = host.sessions.create('unprocessed-inputs')
            pending.append('turn/start', { turn: 1 })
            pending.append(
              'user/message',
              createUserMessage({
                source: { kind: 'user' },
                content: [{ type: 'text', text: 'Short completed request' }]
              }),
              { surfaceOp: 'append' }
            )
            pending.append('step/start', { turn: 1, step: 1 })
            pending.append(
              'assistant/message',
              {
                turn: 1,
                step: 1,
                stream: [],
                message: createAssistantMessage({
                  source: { provider: 'fixture', model: 'fixture' },
                  content: [{ type: 'text', text: 'Done' }]
                })
              },
              { surfaceOp: 'append' }
            )
            pending.append('step/end', { turn: 1, step: 1 })
            pending.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
            pending.append('turn/start', { turn: 2 })
            for (const marker of ['UNPROCESSED_ONE', 'UNPROCESSED_TWO'])
              pending.append(
                'user/message',
                createUserMessage({
                  source: { kind: 'user' },
                  content: [{ type: 'text', text: marker + ' newly admitted request '.repeat(1000) }]
                }),
                { surfaceOp: 'append' }
              )
            pending.append('step/start', { turn: 2, step: 1 })
            assert.equal(
              await captureSegment(
                host,
                { session: pending },
                { minimumTokens: 2000, retainTokens: 1000, maximumCharacters: 100000 }
              ),
              undefined,
              'newly admitted input before step/start has not been processed and cannot become an old segment'
            )
            for (const opaque of ['image', 'large-text'] as const) {
              const withOpaque = host.sessions.create('opaque-' + opaque)
              withOpaque.append('turn/start', { turn: 1 })
              const kept = withOpaque.append(
                'user/message',
                createUserMessage({
                  source: { kind: 'user' },
                  content: [
                    opaque === 'image'
                      ? {
                          type: 'image',
                          attachment: {
                            attachmentId: 'a'.repeat(64) as any,
                            mediaType: 'image/png',
                            bytes: 70,
                            width: 1,
                            height: 1
                          }
                        }
                      : { type: 'text', text: 'oversized original '.repeat(10000) }
                  ]
                }),
                { surfaceOp: 'append' }
              )
              const later = withOpaque.append(
                'user/message',
                createUserMessage({
                  source: { kind: 'user' },
                  content: [{ type: 'text', text: 'LATER '.repeat(4000) }]
                }),
                { surfaceOp: 'append' }
              )
              withOpaque.append('step/start', { turn: 1, step: 1 })
              withOpaque.append(
                'assistant/message',
                {
                  turn: 1,
                  step: 1,
                  stream: [],
                  message: createAssistantMessage({
                    source: { provider: 'fixture', model: 'fixture' },
                    content: [{ type: 'text', text: 'DONE' }]
                  })
                },
                { surfaceOp: 'append' }
              )
              withOpaque.append('step/end', { turn: 1, step: 1 })
              withOpaque.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
              withOpaque.append('turn/start', { turn: 2 })
              withOpaque.append(
                'user/message',
                createUserMessage({
                  source: { kind: 'user' },
                  content: [{ type: 'text', text: 'TAIL '.repeat(2000) }]
                }),
                { surfaceOp: 'append' }
              )
              const opaqueAgent = { session: withOpaque, options: agent.options }
              const segment = await captureSegment(host, opaqueAgent, {
                minimumTokens: 2000,
                retainTokens: 1000,
                maximumCharacters: 100000
              })
              assert.ok(segment, 'later text remains eligible after ' + opaque)
              assert.equal(segment.seqs[0], later.seq)
              assert.ok(!segment.seqs.includes(kept.seq))
              await committer.commit(
                opaqueAgent,
                segment,
                { ...prepared, id: 'after-' + opaque },
                new AbortController().signal
              )
              assert.ok(
                withOpaque.surface.nodes.includes(kept.seq),
                'opaque source remains in native context'
              )
            }
          } finally {
            await committer.dispose()
          }
        })().then(resolve, reject)
      }
    )
    try {
      await feature.await()
      await done
    } finally {
      await feature.dispose()
      for (const fiber of fibers.reverse()) await fiber.dispose()
      await llm()
    }
  }
)
