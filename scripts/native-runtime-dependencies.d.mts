export interface RuntimeFile {
  path: string
  bytes: number
  sha256: string
  executable: boolean
}
export interface RuntimeInventory {
  files: RuntimeFile[]
}
export const FIXED_ZOD_VERSION: '4.6.7'
export const ZOD_SOURCE: string
export function applyRuntimeDependencyOverrides(
  runtime: string,
  inventory: RuntimeInventory
): { version: string; directory: string; files: number }
export function verifyPackagedDependencyOverrides(
  paths: readonly string[],
  read: (path: string) => Buffer,
  inventory: RuntimeInventory
): void
