import { test } from 'node:test'
import assert from 'node:assert/strict'
import { installOwnedStyle } from '../packages/shared/owned-style'

test('native materialization cannot adopt PX effect-owned styles; the last owner releases them', () => {
  const old = globalThis.document
  const styles: any[] = []
  const cleanups: Array<() => void> = []
  globalThis.document = {
    querySelector: (selector: string) =>
      styles.find((s) => selector === `style[data-dsh-px-style="${s.dataset.dshPxStyle}"]`),
    createElement: () => ({
      dataset: {},
      isConnected: false,
      attrs: {} as Record<string, string>,
      setAttribute(key: string, value: string) {
        this.attrs[key] = value
      },
      remove() {
        styles.splice(styles.indexOf(this), 1)
        this.isConnected = false
      }
    }),
    head: {
      appendChild: (style: any) => {
        style.isConnected = true
        styles.push(style)
      }
    }
  } as any
  try {
    const owner = { effect: (f: () => () => void) => cleanups.push(f()) }
    installOwnedStyle(owner, 'workspace', '.px-bar{top:40px}')
    installOwnedStyle(owner, 'workspace', '.px-bar{top:40px}')
    assert.equal(styles.length, 1)
    // The pinned native claim/remove pair used when an unrelated plugin is hot-loaded.
    for (const style of styles) if (!style.attrs['data-plugin']) style.attrs['data-plugin'] = 'unrelated-team'
    for (const style of [...styles]) if (style.attrs['data-plugin'] === 'unrelated-team') style.remove()
    assert.equal(styles.length, 1)
    cleanups[0]()
    cleanups[0]()
    assert.equal(styles.length, 1, 'one disposal cannot release another feature owner')
    cleanups[1]()
    assert.equal(styles.length, 0)
  } finally {
    globalThis.document = old
  }
})
