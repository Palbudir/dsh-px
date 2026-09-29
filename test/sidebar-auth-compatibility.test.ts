import { test } from 'node:test'
import assert from 'node:assert/strict'
import { patchSidebarAuthentication } from '../src/shared/sidebar-auth-compatibility'

test('authentication patch refuses an unknown or modified third-party payload', () => {
  assert.throws(() => patchSidebarAuthentication('const inject = [];'), /来源/)
})
