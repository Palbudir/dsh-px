import { mkdirSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { renameWithRetry } from '../../src/main/native-atomic.ts'

/** Replace an artifact atomically; never write through QA/runtime hard links. */
export function writeArtifact(destination, content) {
  mkdirSync(dirname(destination), { recursive: true })
  const temporary = `${destination}.${process.pid}.tmp`
  try {
    writeFileSync(temporary, content, 'utf8')
    renameWithRetry(temporary, destination)
  } finally {
    try {
      unlinkSync(temporary)
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
    }
  }
}
