import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

test('committed trusted-workflow digests match the files they approve', async () => {
  const { sourceDigest } = await import(pathToFileURL(resolve('scripts/review-core.mjs')).href)
  const policy = JSON.parse(readFileSync('docs/github/review-policy.json', 'utf8'))
  const stale: string[] = []
  for (const kind of ['trustedBuild', 'trustedQuality']) {
    const files: Record<string, string> = policy[kind].files
    assert.ok(Object.keys(files).length > 0, `${kind} lists no files`)
    assert.ok(Object.hasOwn(files, policy[kind].path), `${kind} must pin its own workflow`)
    for (const [file, digest] of Object.entries(files))
      if (sourceDigest(readFileSync(file)) !== digest) stale.push(`${kind}: ${file}`)
  }
  // The release gate refuses a trusted run whose controller files differ from these digests.
  assert.deepEqual(stale, [], 'recompute docs/github/review-policy.json digests with sourceDigest')
})
