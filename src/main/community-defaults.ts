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

/** One-time 0.6 managed-composition transition; later user edits remain authoritative. */
export function scopedKnowledgeDefaults(text: string, directory: string): string {
  const initialized = projectKnowledgeDefaults(text, directory)
  const doc = parseDocument(initialized, {
    customTags: [{ tag: 'tag:yaml.org,2002:js', resolve: (value: string) => value }]
  })
  if (doc.errors.length || !isSeq(doc.contents))
    throw Error('Invalid profile patch for PX knowledge defaults')
  let index = doc.contents.items.findIndex((_row, i) => doc.getIn([i, 'id']) === 'mnemon')
  if (index < 0) {
    doc.add({ id: 'mnemon', config: { storageScope: 'workspaces', dataDir: directory } })
    index = doc.contents.items.length - 1
  }
  const set = (path: string[], value: unknown) => doc.setIn([index, 'config', ...path], value)
  set(['lifecycleEnabled'], true)
  set(['idleReview', 'enabled'], false)
  set(['routingGuidance'], true)
  set(['memoryView', 'strategyTypeId'], 'general')
  set(['memoryTopology', 'strategyId'], 'general')
  set(['memoryTopology', 'layers', 'documents', 'enabled'], true)
  for (const channel of ['recall', 'write', 'projection', 'maintenance'])
    set(['memoryTopology', 'layers', 'documents', 'participation', channel], 'manual')
  set(['memoryTopology', 'layers', 'px-knowledge', 'enabled'], true)
  for (const channel of ['recall', 'write', 'projection'])
    set(['memoryTopology', 'layers', 'px-knowledge', 'participation', channel], 'automatic')
  set(['memoryTopology', 'layers', 'px-knowledge', 'participation', 'maintenance'], 'manual')
  for (const [id, disabled] of [
    ['mnemon-strategy-default-three-tier', true],
    ['mnemon-strategy-general', false]
  ] as const) {
    const at = doc.contents.items.findIndex((_row, i) => doc.getIn([i, 'id']) === id)
    if (at < 0) doc.add({ id, disabled })
    else doc.setIn([at, 'disabled'], disabled)
  }
  return String(doc)
}
