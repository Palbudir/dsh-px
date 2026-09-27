import { repoRoot } from './paths'
import { maintenanceArgs } from './maintenance-args'
import { maintenancePaths, pendingInfo, preserveInterrupted } from '../src/maintenance/core'
import {
  applyQaArchive,
  archiveInfo,
  listQa,
  planQaArchive,
  recoverQaArchive,
  restoreQaArchive
} from '../src/maintenance/qa'

try {
  const args = maintenanceArgs(process.argv.slice(2))
  if (args.action === 'help')
    process.stdout.write(
      '用法：archive-qa <list|plan|apply|info|restore|status|recover|keep-current> --user-data <绝对目录>\nplan需逐项--session <ID> / --schedule <ID>；apply需--plan <ID> --confirm <确认值>；info/restore使用--id <归档ID>。只隐藏已确认QA会话，不删除日志；恢复定时任务默认暂停。\n'
    )
  else {
    const extra: Record<string, string[]> = {
      list: ['--offset', '--limit'],
      plan: ['--session', '--schedule'],
      apply: ['--plan', '--confirm'],
      info: ['--id'],
      restore: ['--id', '--confirm'],
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
      result = listQa(paths, Number(args.one('--offset', '0')), Number(args.one('--limit', '20')))
    else if (args.action === 'plan')
      result = await planQaArchive(paths, args.many('--session'), args.many('--schedule'))
    else if (args.action === 'apply')
      result = await applyQaArchive(paths, args.one('--plan'), args.one('--confirm'))
    else if (args.action === 'info') result = archiveInfo(paths, args.one('--id'))
    else if (args.action === 'restore')
      result = await restoreQaArchive(paths, args.one('--id'), args.one('--confirm'))
    else if (args.action === 'status') result = pendingInfo(paths)
    else if (args.action === 'recover') result = await recoverQaArchive(paths, args.one('--confirm'))
    else if (args.action === 'keep-current') result = await preserveInterrupted(paths, args.one('--confirm'))
    else throw new Error('未知维护操作')
    process.stdout.write(JSON.stringify(result, null, 2) + '\n')
  }
} catch (error) {
  process.stderr.write((error instanceof Error ? error.message : String(error)) + '\n')
  process.exitCode = 1
}
