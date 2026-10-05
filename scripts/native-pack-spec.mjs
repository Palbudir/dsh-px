import { isAbsolute, resolve } from 'node:path'

/**
 * Whether a profile's recorded `dsh-px-pack` dependency names the installed aggregate archive: a
 * relative `file:` path resolves against the profile, and Windows paths compare case-insensitively.
 * Any other spec form never names the archive.
 * @param {unknown} spec - the profile's recorded dsh-px-pack dependency.
 * @param {string} archive - absolute path of the archive that was installed.
 * @param {string} profile - absolute profile directory.
 * @param {string} [platform] - process platform, for tests.
 */
export function sameArchiveSpec(spec, archive, profile, platform = process.platform) {
  if (typeof spec !== 'string' || !spec.startsWith('file:')) return false
  const path = spec.slice('file:'.length)
  const left = isAbsolute(path) ? resolve(path) : resolve(profile, path)
  const right = resolve(archive)
  return platform === 'win32' ? left.toLowerCase() === right.toLowerCase() : left === right
}
