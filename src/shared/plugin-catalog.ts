import catalog from '../../config/plugins.json'

/** The same inventory drives builds, staging, migration and package assertions. */
export const MANAGED_PLUGIN_NAMES: readonly string[] = catalog.managed
export const COMMUNITY_VERSIONS: Readonly<Record<string, string>> = catalog.community
export const RUNTIME_VERSIONS = catalog.runtime
export const managedArtifacts = (prefix = 'packages'): string[] =>
  MANAGED_PLUGIN_NAMES.flatMap(name => ['index.js', 'client.js'].map(file => `${prefix}/${name}/lib/${file}`))
