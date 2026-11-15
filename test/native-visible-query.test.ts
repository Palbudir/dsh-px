import test from 'node:test'
import assert from 'node:assert/strict'
import { NativeVisibleQuery } from '../packages/dsh-px-memory/src/native-visible-query'

test('visible query verification preserves native unicode61 phrase matching and returns source offsets', () => {
  const matcher = new NativeVisibleQuery('resume')
  try {
    const text = 'x'.repeat(220) + ' Current résumé procedure'
    const hit = matcher.excerpt(text)!
    assert.ok(hit)
    assert.equal(hit.snippet, text.slice(hit.readOffset, hit.readOffset + 700))
    assert.match(hit.snippet, /résumé/)
    assert.equal(
      matcher.excerpt('unrelated visible text'),
      undefined,
      'previous document cannot remain searchable'
    )
  } finally {
    matcher.close()
  }
})

test('visible query syntax remains literal and cannot accept separated phrase tokens', () => {
  const phrase = new NativeVisibleQuery('alpha beta'),
    quoted = new NativeVisibleQuery('" OR private')
  try {
    assert.equal(phrase.excerpt('alpha unrelated beta'), undefined)
    assert.ok(phrase.excerpt('alpha-beta'))
    assert.equal(quoted.excerpt('private'), undefined)
  } finally {
    phrase.close()
    quoted.close()
  }
  assert.throws(() => new NativeVisibleQuery('   '), /无效/)
})
