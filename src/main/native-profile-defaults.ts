import { existsSync, readFileSync } from 'node:fs'
import { isMap, isSeq, parseDocument, type Document } from 'yaml'
import { isAbsolute, join } from 'node:path'
import { writeAtomic } from './native-atomic'

// Same comment-preserving YAML representation and !!js tag as native plugin management (plugin-manager patch.ts).
const yamlOptions = { customTags: [{ tag: 'tag:yaml.org,2002:js', resolve: (value: string) => value }] }

function readPatch(patch: string): Document {
  const text = existsSync(patch) ? readFileSync(patch, 'utf8') : '[]\n'
  const document: Document = parseDocument(text, yamlOptions)
  if (document.errors.length) throw document.errors[0]
  // A comment-only file (native template without the `[]`) is an empty sequence; comments stay attached.
  if (document.contents === null) {
    document.contents = document.createNode([])
  }
  if (!isSeq(document.contents)) throw new Error('Desktop profile patch must be a YAML sequence')
  // Native templates write `[]`; appended rows read better as a block sequence.
  if (document.contents.items.length === 0) document.contents.flow = false
  return document
}

/** Index of the row the native composer applies last for `id` (last non-insert row), or -1. */
function lastRow(document: Document, id: string): number {
  const items = isSeq(document.contents) ? document.contents.items : []
  for (let index = items.length - 1; index >= 0; index--) {
    const item = items[index]
    if (isMap(item) && document.getIn([index, 'id']) === id && !item.has('insert')) return index
  }
  return -1
}

/**
 * Isolated defaults for the native Desktop profile: loopback webserver on a free port and a PX-owned documents path.
 * Each default is added only when no user row configures it, so a profile whose patch was moved away by native
 * "disable all plugins" recovery regains them while user-set values stay untouched.
 * Call inside the native Desktop profile lock, before createPluginProfile.
 * @param profile - absolute native Desktop profile directory.
 * @param documentsDirectory - absolute documents directory for the workspace controller.
 * @returns whether the patch file changed.
 */
export function prepareNativeProfileDefaults(profile: string, documentsDirectory: string): boolean {
  if (!isAbsolute(profile) || !isAbsolute(documentsDirectory))
    throw new Error('Native Desktop profile and documents directories must be absolute')
  const patch = join(profile, 'cordis.patch.yml')
  const document = readPatch(patch)
  // Cordis config patches replace whole config blocks, so a row with any `config` owns that plugin's settings.
  // A port-only patch would lose the required host; our default therefore always carries both.
  // Patch rows merge key by key (cordis-plugin-include applyEntryPatches: `target[key] = value` for each key a
  // row sets), so an appended config-only row never clears an earlier `disabled: true`: a user's disable stays.
  const defaults = [
    { id: 'webserver', config: { host: '127.0.0.1', port: 0 } },
    { id: 'workspace-controller', config: { documentsDirectory } }
  ]
  let changed = false
  for (const row of defaults) {
    const index = lastRow(document, row.id)
    if (index >= 0 && document.hasIn([index, 'config'])) continue
    document.add(row)
    changed = true
  }
  if (changed) writeAtomic(patch, String(document))
  return changed
}

// Ids and module names from the pinned upstream bundles (web-app and base cordis.patch.yml).
// session-telemetry-otel exports Session logs over OTLP to the official collector.
const telemetryRows = [
  { id: 'desktop-product-telemetry', name: '@deepseek-ai/dsh-host-product-telemetry-otel' },
  { id: 'product-analytics', name: '@deepseek-ai/dsh-client-product-analytics' },
  { id: 'session-telemetry-otel', name: '@deepseek-ai/dsh-session-telemetry-otel' }
]

/**
 * Disable official telemetry services on every Desktop start. The PX distribution never enables official
 * telemetry, so a user or import that re-enables one of these rows is reverted at the next start.
 * Uses the native last-wins rule: the last non-insert row for an id decides. That row is set to
 * `disabled: true` in place (keeping its position, other keys and comments); a row is appended only when
 * none exists. Already-disabled ids are left alone, so repeated starts and native toggles do not grow the file.
 * Apply after creating/importing a profile while holding its native Desktop lock.
 * @param profile - native Desktop profile directory.
 * @returns whether the patch file changed.
 */
export function applyNativeDesktopPolicy(profile: string): boolean {
  const patch = join(profile, 'cordis.patch.yml')
  const document = readPatch(patch)
  let changed = false
  for (const { id, name } of telemetryRows) {
    const index = lastRow(document, id)
    // A mismatched name makes the native composer skip the row, so it cannot keep the service disabled.
    const effective = index >= 0 && [undefined, name].includes(document.getIn([index, 'name']) as string)
    if (effective && document.getIn([index, 'disabled']) === true) continue
    if (effective) document.setIn([index, 'disabled'], true)
    else document.add({ id, disabled: true })
    changed = true
  }
  if (changed) writeAtomic(patch, String(document))
  return changed
}
