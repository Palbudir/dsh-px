import { existsSync, writeFileSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'

/** Call inside the native Desktop profile lock, before its first createPluginProfile. */
export function prepareNativeProfileDefaults(profile: string, documentsDirectory: string): boolean {
  if (!isAbsolute(profile) || !isAbsolute(documentsDirectory))
    throw new Error('Native Desktop profile and documents directories must be absolute')
  const patch = join(profile, 'cordis.patch.yml')
  // A previously initialized profile owns its settings, including an intentionally absent patch.
  if (existsSync(join(profile, 'package.json')) || existsSync(patch)) return false
  // Cordis config patches replace whole config blocks. A port-only patch loses the required host.
  const content =
    '- id: webserver\n  config:\n    host: 127.0.0.1\n    port: 0\n' +
    '- id: workspace-controller\n  config:\n    documentsDirectory: ' +
    JSON.stringify(documentsDirectory) +
    '\n'
  try {
    writeFileSync(patch, content, { flag: 'wx' })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') return false
    throw error
  }
  return true
}
