export const FOUNDATION_PLUGINS = ['dsh-px-updater', 'dsh-px-workbench', 'dsh-px-workspace'] as const
export const FEATURE_BUNDLES = [
  'dsh-px-files',
  'dsh-px-taskflow',
  'dsh-px-artifacts',
  'dsh-px-annotations',
  'dsh-px-schedules',
  'dsh-px-memory',
  'dsh-px-computer'
] as const
/** Legacy receipts did not record the names a user had already been offered. */
export const LEGACY_FEATURE_BUNDLES = [
  'dsh-px-files',
  'dsh-px-taskflow',
  'dsh-px-artifacts',
  'dsh-px-annotations',
  'dsh-px-schedules'
]
export function isFeatureName(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^dsh-px-[a-z][a-z0-9-]{0,60}$/.test(value) &&
    value !== 'dsh-px-core' &&
    !(FOUNDATION_PLUGINS as readonly string[]).includes(value)
  )
}
/** Signed Pack manifests own their optional feature list, not the Desktop binary's build-time list. */
export function validFeatureList(value: unknown): value is DistributionFile[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.length <= 32 &&
    value.every((f) => f && isFeatureName(f.name)) &&
    new Set(value.map((f) => f.name)).size === value.length
  )
}
export interface DistributionFile {
  name: string
  version: string
  file: string
  sha256: string
}
export interface PackDistribution {
  schemaVersion: 1
  version: string
  foundation: DistributionFile
  features: DistributionFile[]
}
