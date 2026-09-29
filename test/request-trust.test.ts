import { test } from 'node:test'
import assert from 'node:assert/strict'
import { rejectUnauthenticatedRequest } from '../packages/shared/request-trust'

test('plugin routes require native host authentication before accepting loopback requests', () => {
  for (const status of [401, 403, 503]) {
    let actual = 0
    assert.equal(
      rejectUnauthenticatedRequest(
        { headers: { host: '127.0.0.1' } },
        {
          writeHead: (code) => {
            actual = code
          },
          end: () => {}
        },
        status === 503 ? undefined : { requestRejection: () => status as 401 | 403 }
      ),
      true
    )
    assert.equal(actual, status)
  }
  assert.equal(
    rejectUnauthenticatedRequest(
      { headers: { host: '127.0.0.1' } },
      {
        writeHead: () => {
          throw new Error('unexpected rejection')
        },
        end: () => {}
      },
      { requestRejection: () => undefined }
    ),
    false
  )
})
