import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { createUpdateJournal } from '../src/main/update-history'

test('ordinary update history is enabled but logging failure never prevents normal startup', () => {
  class Journal {
    constructor(
      readonly path: string,
      readonly version: string
    ) {}
  }
  assert.equal(
    createUpdateJournal(Journal, undefined, '/data', '0.3.3')?.path,
    join('/data', 'logs', 'updates')
  )
  const failed = class {
    constructor() {
      throw Error('disk unavailable')
    }
  }
  let warnings = 0
  assert.equal(
    createUpdateJournal(failed, undefined, '/data', '0.3.3', () => warnings++),
    undefined
  )
  assert.equal(warnings, 1)
  assert.throws(() => createUpdateJournal(failed, '/required', '/data', '0.3.3'), /disk unavailable/)
})
