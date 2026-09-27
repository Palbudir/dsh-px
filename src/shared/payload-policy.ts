/** Release payload paths are evaluated independently of package existence checks. */
export function forbiddenPayloadPaths(paths: readonly string[]): string[] {
  const failures: string[] = []
  for (const raw of paths) {
    const path = raw
      .replaceAll('\\', '/')
      .toLowerCase()
      .replace(/^resources\//, '')
      .replace(/\/+$/, '')
    if (path.split('/').some((part) => part === '..') || path.startsWith('/') || /^[a-z]:/.test(path)) {
      failures.push(raw)
      continue
    }
    if (!path.startsWith('runtime/')) continue
    if (/^runtime\/(?:_dsh-install|build-test|backups)(?:\/|$)/.test(path)) {
      failures.push(raw)
      continue
    }
    if (
      /(?:^|\/)\.git(?:\/|$)/.test(path) ||
      (/(?:^|\/)\.env(?:\.[^/]+)?$/.test(path) && !path.endsWith('.env.example'))
    ) {
      failures.push(raw)
      continue
    }
    const home = path.startsWith('runtime/dsh-home/') ? path.slice('runtime/dsh-home/'.length) : null
    if (home === null) continue
    if (
      /^(?:sessions|storages|backups|logs|workspaces|build-test|update-bridge|\.dsh-px-staging|\.dsh-px-migration-lock|\.dsh-px-maintenance-trash)(?:\/|$)/.test(
        home
      ) ||
      /^(?:\.?credentials\.ya?ml|settings\.ya?ml|service-state\.json|\.dsh-px-managed-plugins\.json|\.dsh-px-profile-transaction\.json|\.dsh-px-maintenance-transaction\.json|\.dsh-px-materialized|\.dsh-px-seed-claimed)$/.test(
        home
      ) ||
      /^profiles\/[^/]+\/(?:\.dsh-market|\.dsh-module-fallback|\.npmrc|sessions|storages|logs)(?:\/|$)/.test(
        home
      ) ||
      /^profiles\/node_modules(?:\/|$)/.test(home) ||
      (/(?:^|\/)(?:credentials|settings)\.ya?ml$/.test(home) && !home.includes('/node_modules/'))
    )
      failures.push(raw)
  }
  return failures
}
