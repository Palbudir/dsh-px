import { join } from 'node:path'

/** Ordinary installs retain the native journal too; a logging failure must not prevent startup. */
export function createUpdateJournal<T>(
  Journal: new (directory: string, version: string) => T,
  requested: string | undefined,
  userData: string,
  version: string,
  warn: (message: string) => void = console.warn
): T | undefined {
  try {
    return new Journal(requested ?? join(userData, 'logs', 'updates'), version)
  } catch (error) {
    // An explicitly requested qualification journal remains mandatory for that run.
    if (requested !== undefined) throw error
    warn('DSH-PX update journal could not be created; application startup continues')
    return undefined
  }
}
