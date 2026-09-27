import { repoRoot } from './paths'
import { maintenanceArgs } from './maintenance-args'
import { maintenancePaths, pendingInfo, preserveInterrupted } from '../src/maintenance/core'
import {
  applyBackupCleanup,
  listBackups,
  planBackupCleanup,
  recoverBackupCleanup
} from '../src/maintenance/backups'

try {
  const args = maintenanceArgs(process.argv.slice(2))
  if (args.action === 'help')
    process.stdout.write(
      '用法：manage-backups <list|plan|apply|status|recover|keep-current> --user-data <绝对目录> [--profile web]\nplan需逐项--id <备份ID>；apply需--plan <计划ID>及--confirm <计划确认值>。始终保留最近两份。恢复确认值由status提供。\n'
    )
  else {
    const extra: Record<string, string[]> = {
      list: ['--offset', '--limit'],
      plan: ['--id'],
      apply: ['--plan', '--confirm'],
      status: [],
      recover: ['--confirm'],
      'keep-current': ['--confirm']
    }
    if (!extra[args.action]) throw new Error('未知维护操作')
    args.allow(['--user-data', '--profile', ...extra[args.action]])
    const paths = maintenancePaths({
      userData: args.one('--user-data'),
      repoRoot: repoRoot(),
      profileName: args.one('--profile', 'web')
    })
    let result: unknown
    if (args.action === 'list')
      result = listBackups(paths, Number(args.one('--offset', '0')), Number(args.one('--limit', '20')))
    else if (args.action === 'plan') result = await planBackupCleanup(paths, args.many('--id'))
    else if (args.action === 'apply')
      result = await applyBackupCleanup(paths, args.one('--plan'), args.one('--confirm'))
    else if (args.action === 'status') result = pendingInfo(paths)
    else if (args.action === 'recover') result = await recoverBackupCleanup(paths, args.one('--confirm'))
    else if (args.action === 'keep-current') result = await preserveInterrupted(paths, args.one('--confirm'))
    else throw new Error('未知维护操作')
    process.stdout.write(JSON.stringify(result, null, 2) + '\n')
  }
} catch (error) {
  process.stderr.write((error instanceof Error ? error.message : String(error)) + '\n')
  process.exitCode = 1
}
