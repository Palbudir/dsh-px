import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { qqAtomicText, qqReadMetadata } from '../src/shared/qq-atomic'

test('QQ atomic metadata survives transient sharing locks and keeps the last valid file on permanent failure', async () => {
  const root = await mkdtemp(join(tmpdir(), 'px-qq-atomic-')),
    file = join(root, 'mapping.json')
  try {
    await writeFile(file, '{"session":"old"}')
    let failures = 2
    await qqAtomicText(file, '{"session":"new"}', async (from, to) => {
      if (failures-- > 0) throw Object.assign(new Error('sharing lock'), { code: 'EPERM' })
      await rename(from, to)
    })
    assert.equal(await readFile(file, 'utf8'), '{"session":"new"}')
    await assert.rejects(
      qqAtomicText(file, '{"session":"incomplete"}', async () => {
        throw Object.assign(new Error('readonly'), { code: 'EROFS' })
      }),
      /readonly/
    )
    assert.equal(await readFile(file, 'utf8'), '{"session":"new"}')
    assert.deepEqual(await readdir(root), ['mapping.json'])
  } finally {
    assert.ok(resolve(root).startsWith(resolve(tmpdir()) + sep))
    await rm(root, { recursive: true, force: true })
  }
})

test('QQ metadata reads preserve legacy mappings and never treat damaged state as an empty map', async () => {
  const root = await mkdtemp(join(tmpdir(), 'px-qq-read-')),
    file = join(root, 'mapping.json')
  try {
    for (const value of [
      { 'private:12345': 'old-session' },
      { 'group:23456': { session: 'new-session', goal: 'continue', workspacePath: '' } }
    ]) {
      const text = JSON.stringify(value)
      await writeFile(file, text)
      assert.equal(await qqReadMetadata(file, 'mapping'), text)
    }
    for (const content of ['{partial', 'null', '[]', '{"private:12345":{}}', '{"private:12345":42}']) {
      await writeFile(file, content)
      await assert.rejects(qqReadMetadata(file, 'mapping'), /原文件已保留/)
      assert.equal(await readFile(file, 'utf8'), content)
    }
    await writeFile(file, '["old-session"]')
    await qqReadMetadata(file, 'retired')
    await writeFile(file, '{"private:12345":[{"id":"old-session","retiredAt":1}]}')
    await qqReadMetadata(file, 'switchable')
    await assert.rejects(qqReadMetadata(join(root, 'missing.json'), 'mapping'), { code: 'ENOENT' })
  } finally {
    assert.ok(resolve(root).startsWith(resolve(tmpdir()) + sep))
    await rm(root, { recursive: true, force: true })
  }
})
