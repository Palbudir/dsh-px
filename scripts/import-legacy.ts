import { importLegacyData, planLegacyImport, restoreLegacyTitleCaches } from '../src/main/import-legacy'
const args = process.argv.slice(2)
const option = (key: string) => args.find((x) => x.startsWith(key + '='))?.slice(key.length + 1)
const source = option('--source'),
  target = option('--target')
if (!source || !target)
  throw new Error(
    '用法：import-legacy --source=<旧 DSH_HOME> --target=<新 DSH_HOME> [--restore-title-cache] [--apply]；默认只预览'
  )
if (args.includes('--apply'))
  console.log(
    JSON.stringify(
      args.includes('--restore-title-cache')
        ? restoreLegacyTitleCaches(source, target)
        : importLegacyData(source, target),
      null,
      2
    )
  )
else {
  const plan = planLegacyImport(source, target)
  console.log(
    JSON.stringify(
      {
        sessions: plan.sessionDirectories.length,
        conflicts: args.includes('--restore-title-cache') ? undefined : plan.conflicts.length,
        existingSessions: args.includes('--restore-title-cache') ? plan.conflicts.length : undefined,
        attachments: plan.attachments.length,
        mode: args.includes('--restore-title-cache') ? 'preview-title-cache' : 'preview'
      },
      null,
      2
    )
  )
}
