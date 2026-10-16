import { isAbsolute } from 'node:path'
import { isMap, isSeq, parseDocument, type Document } from 'yaml'

/** Initial composition only. Existing Mnemon rows belong to the user, not to Pack defaults. */
export function projectKnowledgeDefaults(text: string, directory: string): string {
  if (!isAbsolute(directory)) throw Error('Project knowledge directory must be absolute')
  const doc: Document = parseDocument(text, {
    customTags: [{ tag: 'tag:yaml.org,2002:js', resolve: (value: string) => value }]
  })
  if (doc.errors.length || (doc.contents !== null && !isSeq(doc.contents)))
    throw Error('Invalid profile patch; community defaults were not written')
  if (
    isSeq(doc.contents) &&
    doc.contents.items.some(
      (row, index) =>
        isMap(row) &&
        typeof doc.getIn([index, 'id']) === 'string' &&
        String(doc.getIn([index, 'id'])).startsWith('mnemon')
    )
  )
    return text
  if (doc.contents === null) doc.contents = doc.createNode([])
  for (const row of [
    {
      id: 'mnemon',
      config: {
        storageScope: 'workspaces',
        dataDir: directory,
        runtimeUserScope: 'storage',
        lifecycleEnabled: false,
        recallMode: 'guided',
        writebackMode: 'guided',
        writeEnabled: true,
        remoteAccess: 'read-only',
        tabEnabled: true,
        embedding: { enabled: false },
        memoryView: { strategyTypeId: 'general' }
      }
    },
    { id: 'mnemon-source-runtime', disabled: true },
    { id: 'mnemon-source-memory-spaces', disabled: true },
    { id: 'mnemon-strategy-default-three-tier', disabled: true },
    { id: 'mnemon-strategy-general', disabled: false }
  ])
    doc.add(row)
  return String(doc)
}
