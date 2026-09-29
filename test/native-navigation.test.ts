import { test } from 'node:test'
import assert from 'node:assert/strict'
import { nativeFileAddress, selectedSession } from '../packages/shared/native-navigation'

test('native selection follows mainView, not background ownership, and permits closing the last tab', () => {
  const byId = {
    background: { id: 'background', retainedBy: { mainView: 0, job: 1 } },
    selected: { id: 'selected', retainedBy: { mainView: 1 } }
  }
  assert.equal(selectedSession({ byId }, null), 'selected')
  assert.equal(selectedSession({ byId }, 'px-session-home'), undefined)
  assert.equal(selectedSession({ byId }, null), 'selected')
  assert.equal(selectedSession({ byId: { background: byId.background } }, null), undefined)
  assert.equal(selectedSession({ byId, current: 'legacy' }, null), 'legacy')
})

test('file-resource addresses preserve absolute/relative ownership and escape special characters', () => {
  assert.equal(nativeFileAddress('s', 'C:\\a b\\x#?.md'), 'dsh-resource://file/session/s/C:/a%20b/x%23%3F.md')
  assert.equal(nativeFileAddress('s', '/tmp/a.txt'), 'dsh-resource://file/session/s//tmp/a.txt')
  assert.equal(nativeFileAddress('s', '././a.txt'), 'dsh-resource://file/session/s/a.txt')
  assert.equal(
    nativeFileAddress('s/a', '\\\\server\\share\\a.txt'),
    'dsh-resource://file/session/s%2Fa///server/share/a.txt'
  )
  assert.throws(() => nativeFileAddress('', 'a'))
  assert.throws(() => nativeFileAddress('s', 'a\0b'))
})
