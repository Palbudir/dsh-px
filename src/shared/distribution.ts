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
  schemaVersion: 1 | 2
  version: string
  foundation: DistributionFile
  features: DistributionFile[]
  community?: CommunityBundle[]
}

export interface CommunityBundle extends DistributionFile {
  integrity: string
  defaults?: 'project-documents-v1' | 'px-knowledge-v2'
}
export const bundleFileStem = (name: string): string => encodeURIComponent(name)
export function isCommunityName(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^(?:@[a-z0-9][a-z0-9._-]{0,60}\/)?[a-z0-9][a-z0-9._-]{0,80}$/.test(value) &&
    !value.startsWith('dsh-px-')
  )
}
export const isCompositionName = (value: unknown): value is string =>
  isFeatureName(value) || isCommunityName(value)
export function validCommunityList(value: unknown): value is CommunityBundle[] {
  return (
    Array.isArray(value) &&
    value.length <= 16 &&
    value.every(
      (item) =>
        item &&
        isCommunityName(item.name) &&
        /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(item.version) &&
        /^sha512-[A-Za-z0-9+/]{86}==$/.test(item.integrity) &&
        (item.defaults === undefined ||
          (item.name === 'dsh-mnemon' && ['project-documents-v1', 'px-knowledge-v2'].includes(item.defaults)))
    ) &&
    new Set(value.map((item) => item.name)).size === value.length
  )
}
export function validDistribution(value: PackDistribution): boolean {
  return (
    value?.foundation?.name === 'dsh-px-core' &&
    validFeatureList(value.features) &&
    (value.schemaVersion === 1
      ? value.community === undefined
      : value.schemaVersion === 2 && validCommunityList(value.community))
  )
}
export const compositionMembers = (value: PackDistribution): DistributionFile[] => [
  ...value.features,
  ...(value.community ?? [])
]
export const componentFile = (value: Pick<DistributionFile, 'name' | 'version'>): string =>
  `distribution/${bundleFileStem(value.name)}-${value.version}.tgz`
