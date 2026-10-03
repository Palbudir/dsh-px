import { test } from 'node:test'
import assert from 'node:assert/strict'
import { openDesktopInBrowser } from '../src/main/open-browser'

test('browser entry preserves native authentication and accepts the current Host after a restart', async () => {
  const opened: string[] = []
  const open = async (url: string) => {
    opened.push(url)
  }
  await openDesktopInBrowser('http://127.0.0.1:32100/?token=first', open)
  await openDesktopInBrowser('http://127.0.0.1:32101/?token=second', open)
  assert.deepEqual(opened, ['http://127.0.0.1:32100/?token=first', 'http://127.0.0.1:32101/?token=second'])
})

test('unavailable service and unexpected destinations never open the browser', async () => {
  for (const value of [
    undefined,
    'invalid',
    'http://127.0.0.1:32100/',
    'http://127.0.0.1:32100/?token=',
    'https://example.com/?token=secret',
    'file:///tmp/index.html',
    'http://user:pass@127.0.0.1:32100/?token=secret',
    'http://127.0.0.1:32100/other?token=secret',
    'http://127.0.0.1:32100/?token=secret#other',
    'http://127.0.0.1:32100/?token=secret&redirect=elsewhere',
    'http://127.0.0.1:32100/?token=first&token=second'
  ]) {
    await assert.rejects(openDesktopInBrowser(value, async () => assert.fail('unexpected browser launch')))
  }
})

test('browser launch errors do not expose the native authentication token', async () => {
  await assert.rejects(
    openDesktopInBrowser('http://127.0.0.1:32100/?token=private', async (url) => {
      throw new Error('OS failed opening ' + url)
    }),
    (error) => error instanceof Error && error.message === 'Could not open the default browser'
  )
})
