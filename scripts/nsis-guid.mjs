import { createHash } from 'node:crypto'

/** electron-builder's fixed namespace for NSIS application GUIDs (app-builder-lib NsisTarget). */
const NSIS_NAMESPACE = '50e065bc-3134-11e6-9bab-38c9862bdaf3'

/**
 * The GUID electron-builder derives from an appId (RFC 4122 v5) and uses for
 * `HKCU\Software\<GUID>` and the matching Uninstall entry of a per-user NSIS install.
 * @param {string} appId
 * @returns {string}
 */
export function nsisAppGuid(appId) {
  const namespace = Buffer.from(NSIS_NAMESPACE.replaceAll('-', ''), 'hex')
  const bytes = createHash('sha1').update(namespace).update(appId, 'utf8').digest().subarray(0, 16)
  bytes[6] = (bytes[6] & 0x0f) | 0x50
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = bytes.toString('hex')
  return [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20)].join('-')
}
