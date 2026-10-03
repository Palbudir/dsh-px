export const FOUNDATION_PLUGINS = ['dsh-px-updater', 'dsh-px-workbench', 'dsh-px-workspace'] as const
export const FEATURE_BUNDLES = [
  'dsh-px-files',
  'dsh-px-taskflow',
  'dsh-px-artifacts',
  'dsh-px-annotations',
  'dsh-px-schedules'
] as const
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
