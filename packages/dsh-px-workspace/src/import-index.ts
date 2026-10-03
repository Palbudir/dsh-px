import { existsSync, lstatSync, readFileSync, readdirSync } from 'node:fs'
import { basename, join } from 'node:path'
import { writeAtomic } from '../../../src/main/native-atomic'

interface IndexHost {
  sessionController: {
    inspect: (
      id: string,
      signal?: AbortSignal
    ) => Promise<{ meta: { id: string; cwd?: string; origin?: string } }>
    projections: (request: { sessionId: string }, signal: AbortSignal) => Promise<unknown>
  }
  workspaceRegistry: { create: (path: string) => Promise<{ attachSession: (id: string) => Promise<void> }> }
}
/** Finish only our additive import receipts through native read/registry APIs; never run an Agent. */
export async function indexImportedSessions(
  home: string,
  host: IndexHost,
  signal: AbortSignal
): Promise<void> {
  const root = join(home, 'backups')
  if (!existsSync(root) || lstatSync(root).isSymbolicLink()) return
  for (const name of readdirSync(root)) {
    if (!/^px-import-[a-f0-9-]{36}$/.test(name)) continue
    const dir = join(root, name),
      file = join(dir, 'import.json')
    if (lstatSync(dir).isSymbolicLink() || !existsSync(file) || lstatSync(file).isSymbolicLink()) continue
    const report = JSON.parse(readFileSync(file, 'utf8'))
    if (
      report.complete !== true ||
      (report.indexed === true && report.indexVersion === 1) ||
      !Array.isArray(report.sessions) ||
      report.sessions.length > 10000
    )
      continue
    const errors: string[] = [],
      skipped: string[] = []
    let indexed = 0
    for (const item of report.sessions) {
      signal.throwIfAborted()
      if (typeof item !== 'string') throw new Error('导入记录格式无效')
      const id = basename(item.replaceAll('\\', '/'))
      if (!/^[a-zA-Z0-9_-]{1,200}$/.test(id)) throw new Error('导入记录会话标识无效')
      try {
        const { meta } = await host.sessionController.inspect(id, signal)
        signal.throwIfAborted()
        if (!meta.cwd || meta.origin === 'subagent' || !existsSync(meta.cwd)) {
          skipped.push(id)
          continue
        }
        // A cold log's header alone has no title. Native observation folds and caches projections
        // without creating or running an Agent, so the imported list does not stay unnamed.
        await host.sessionController.projections({ sessionId: id }, signal)
        signal.throwIfAborted()
        const workspace = await host.workspaceRegistry.create(meta.cwd)
        signal.throwIfAborted()
        await workspace.attachSession(id)
        indexed++
      } catch (error) {
        signal.throwIfAborted()
        errors.push(id + ': ' + String(error))
      }
    }
    writeAtomic(
      file,
      JSON.stringify(
        {
          ...report,
          indexed: errors.length === 0,
          indexVersion: 1,
          indexedSessions: indexed,
          skippedSessions: skipped,
          indexErrors: errors
        },
        null,
        2
      )
    )
  }
}
