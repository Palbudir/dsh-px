import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  parseMailRelations,
  selectMailRelation,
  mailConversation,
  type PersonaMailSender
} from '../packages/shared/persona-mail-policy'
import { PersonaMailJournal, type MailEnvelope } from '../packages/shared/persona-mail-journal'
import { conversationalSource } from '../packages/shared/channel-source'

const personal: PersonaMailSender = { personaId: 'a', sessionId: 'source', project: 'project' }
const group = (id: string): PersonaMailSender => ({
  ...personal,
  channel: {
    provider: 'qq',
    accountId: '11001',
    conversationId: id,
    access: 'public',
    publicInstructions: ''
  }
})

test('persona relations are directional, expire and bind exact source audience; text cannot grant authority', () => {
  const relations = parseMailRelations([
    { id: 'a-to-b', from: 'a', to: 'b', audience: { kind: 'personal' }, expiresAt: '2030-01-01T00:00:00Z' }
  ])
  assert.equal(selectMailRelation(relations, personal, 'b', 0).id, 'a-to-b')
  assert.throws(() => selectMailRelation(relations, personal, 'b', Date.parse('2030-01-01T00:00:00Z')))
  assert.throws(() => selectMailRelation(relations, { ...personal, personaId: 'b' }, 'a', 0))
  assert.throws(() => selectMailRelation(relations, group('group:33003'), 'b', 0))
  assert.throws(() =>
    selectMailRelation(
      relations,
      { ...group('private:22002'), channel: { ...group('private:22002').channel!, access: 'owner' } },
      'b',
      0
    )
  )
  assert.throws(() =>
    selectMailRelation([...relations, { ...relations[0], id: 'duplicate' }], personal, 'b', 0)
  )
  assert.throws(() => parseMailRelations([{ ...relations[0], to: 'a' }]))
  assert.equal(
    new Set(
      [personal, group('group:33003'), group('group:44004'), { ...personal, project: 'other' }].map((s) =>
        mailConversation(s, 'b')
      )
    ).size,
    4
  )
})

test('mail receipts survive reopen, never replay, reject another reply, and peer text is not human feedback', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'px-mail-'))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  const path = join(directory, 'mail.sqlite')
  let journal = new PersonaMailJournal(path)
  const envelope: MailEnvelope = {
    id: 'mail1',
    requestId: 'request1',
    sender: personal,
    target: 'b',
    relationDigest: 'digest',
    receiverSessionId: 'receiver',
    text: 'Explicit shared text',
    source: {
      kind: 'plugin:dsh-px-persona-mail',
      version: 1,
      mailId: 'mail1',
      senderPersonaId: 'a',
      recipientPersonaId: 'b',
      sourceSessionId: 'source',
      sourceSeq: 7,
      conversationId: 'pair'
    }
  }
  journal.insert(envelope, 'native-job1')
  assert.throws(() => journal.insert({ ...envelope, id: 'other' }, 'other-job'))
  journal.close()
  journal = new PersonaMailJournal(path)
  assert.equal(journal.request('source', 'request1')?.delivery, 'prepared')
  assert.equal(journal.request('other-session', 'request1'), undefined)
  journal.reply('mail1', 'Advisory reply')
  journal.admitted('mail1', 'native-message1')
  journal.reply('mail1', 'Advisory reply')
  assert.throws(() => journal.reply('mail1', 'Changed reply'))
  journal.finish('mail1', 'owner stopped after reply committed')
  assert.equal(journal.get('mail1')?.reply, 'Advisory reply')
  assert.equal(journal.get('mail1')?.delivery, 'replied')
  assert.equal(conversationalSource(envelope.source), false)
  journal.close()
})
