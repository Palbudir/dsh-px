import { cpSync, lstatSync, mkdirSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

/** Preserve dependencies bundled inside dsh, then fill missing packages from npm's hoisted tree.
 * Node resolves those nested packages first. Merging files from a second version changes that
 * resolution and can also replace a bundled executable with a hoisted directory symlink.
 */
export function copyHoistedDependencies (source: string, destination: string): void {
  mkdirSync(destination, { recursive: true })
  function copyMissing (from: string, to: string): void {
    try { lstatSync(to); return } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    cpSync(from, to, { recursive: true, dereference: true, force: false, errorOnExist: true })
  }
  for (const entry of readdirSync(source, { withFileTypes: true })) {
    const from = join(source, entry.name), to = join(destination, entry.name)
    if ((entry.name.startsWith('@') || entry.name === '.bin') && statSync(from).isDirectory()) {
      mkdirSync(to, { recursive: true })
      for (const child of readdirSync(from)) copyMissing(join(from, child), join(to, child))
    } else copyMissing(from, to)
  }
}
