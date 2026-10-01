import { test } from 'node:test'
import assert from 'node:assert/strict'
import { closeLastSession, nativeFileAddress, selectedSession } from '../packages/shared/native-navigation'

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

test('closing the last tab selects the PX home panel only where the selection can be read back', () => {
  const calls: string[] = []
  const layout = { selectPanel: (id: string) => calls.push('select:' + id) }
  const sessions = { clear: () => calls.push('clear') }
  // 0.2: layout.panelInfo exists, so PX can tell the home panel is selected.
  closeLastSession({
    layout: { ...layout, panelInfo: { getSnapshot: () => ({ activePanelId: null }) } },
    sessions
  })
  // 0.1.5: layout without panelInfo; selecting the panel would leave the closed Session current.
  closeLastSession({ layout, sessions })
  // No layout service at all.
  closeLastSession({ sessions })
  // 0.2 has no sessions.clear; nothing is called when neither path exists.
  closeLastSession({ layout, sessions: {} })
  assert.deepEqual(calls, ['select:px-session-home', 'clear', 'clear'])
})
