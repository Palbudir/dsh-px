import { test } from 'node:test'
import assert from 'node:assert/strict'
import { harnessFetch } from '../src/main/harness-http'
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

test('desktop exchanges the owned launch token and sends cookies only to that Host', async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = []
  const request: typeof fetch = async (url, init) => {
    calls.push({ url: String(url), init })
    if (calls.length === 1)
      return new Response(null, {
        status: 302,
        headers: { location: '/', 'set-cookie': 'session=owned; HttpOnly; SameSite=Strict' }
      })
    assert.equal(new Headers(init?.headers).get('cookie'), 'session=owned')
    assert.equal(init?.redirect, 'manual')
    return Response.json({ known: true })
  }
  const result = await harnessFetch(
    'http://127.0.0.1:34984/',
    'http://127.0.0.1:34984/?token=test',
    '/dsh-px-workbench/activity',
    {},
    request
  )
  assert.equal(result.status, 200)
  assert.equal(calls.length, 2)
  await assert.rejects(
    harnessFetch('http://127.0.0.1:34984/', 'https://other.example/?token=test', '/', {}, request)
  )
  await assert.rejects(
    harnessFetch(
      'http://127.0.0.1:34984/',
      'http://127.0.0.1:34984/?token=test',
      'http://127.0.0.1:34985/',
      {},
      request
    )
  )
  assert.equal(calls.length, 2)
  let requests = 0
  await assert.rejects(
    harnessFetch('http://127.0.0.1:34984/', 'http://127.0.0.1:34984/?token=test', '/', {}, async () => {
      requests++
      return new Response(null, {
        status: 302,
        headers: { location: 'https://other.example/', 'set-cookie': 'session=owned' }
      })
    }),
    /不可信/
  )
  assert.equal(requests, 1)
})
