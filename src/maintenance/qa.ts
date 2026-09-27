import { existsSync, lstatSync, readdirSync, realpathSync, unlinkSync } from 'node:fs'
import { isAbsolute, join, relative, sep } from 'node:path'
import { randomUUID } from 'node:crypto'
import { validateWorkspaceState } from '../../packages/dsh-px-workspace/src/store'
import type { Schedule, WorkspaceState } from '../../packages/dsh-px-workspace/src/model'
import { readSessionHeader } from './session-header'
import {
  atomicJson,
  confirm,
  hash,
  inside,
  jsonText,
  localPath,
  maintenanceJournal,
  noLinks,
  offlineLease,
  planDigest,
  privateFile,
  readJournal,
  readJson,
  readPlan,
  readSnapshot,
  record,
  revision,
  uuid,
  type MaintenancePaths
} from './core'

interface SessionCheck {
  id: string
  log: string
  headerRevision: string
  logRevision: string
  cwd: string
  hide?: boolean
  wasArchived?: boolean
}
const identifier = (id: unknown): id is string => typeof id === 'string' && /^[a-zA-Z0-9_-]{1,200}$/.test(id)
const keys = {
  workspace: 'storages/workspace.json',
  business: 'storages/dsh-px-workspace/workspace.json'
} as const
function nativeWorkspace(value: any): void {
  const strings = (items: unknown): items is string[] =>
    Array.isArray(items) &&
    items.every((id) => typeof id === 'string') &&
    new Set(items).size === items.length
  if (
    !record(value) ||
    value.unit?.name !== 'workspace' ||
    value.unit.version !== 2 ||
    !record(value.global) ||
    value.global.initialized !== true ||
    value.global.pendingMutation !== undefined ||
    !strings(value.global.workspaceIds) ||
    (value.global.archivedSessionIds !== undefined && !strings(value.global.archivedSessionIds)) ||
    !record(value.tables?.workspaces)
  )
    throw new Error('原生工作区版本或状态不受支持，未更改数据')
  for (const id of value.global.workspaceIds) {
    const workspace = value.tables.workspaces[id]
    if (!record(workspace) || typeof workspace.path !== 'string' || !strings(workspace.sessionIds))
      throw new Error('原生工作区归属记录无效')
  }
}
function units(paths: MaintenancePaths) {
  const workspace = readSnapshot(localPath(paths.home, keys.workspace))
  nativeWorkspace(workspace.value)
  const businessPath = localPath(paths.home, keys.business)
  const business = existsSync(businessPath)
    ? readSnapshot(businessPath)
    : { value: { version: 1, annotations: [], schedules: [] } as WorkspaceState, revision: 'missing' }
  if (
    business.revision === 'missing' &&
    (existsSync(businessPath + '.last-good.json') || existsSync(businessPath + '.previous.json'))
  )
    throw new Error('业务存储缺失但有恢复快照，请先在应用恢复')
  validateWorkspaceState(business.value)
  return { workspace, business: business as { value: WorkspaceState; revision: string } }
}
function verifiedHeader(paths: MaintenancePaths, log: string, requireDirectory = true): SessionCheck {
  const path = localPath(paths.home, log),
    sessionRoot = localPath(paths.home, 'sessions')
  if (!inside(path, sessionRoot) || !log.replaceAll('\\', '/').endsWith('/session.v3.jsonl.zstd'))
    throw new Error('只支持独立首帧的 v3 会话日志')
  const header = readSessionHeader(path)
  if (!isAbsolute(header.cwd) || !inside(header.cwd, paths.qaRoot))
    throw new Error('会话不属于当前仓库的隔离测试目录')
  noLinks(header.cwd)
  if (
    requireDirectory &&
    (!lstatSync(header.cwd).isDirectory() || !inside(realpathSync(header.cwd), realpathSync(paths.qaRoot)))
  )
    throw new Error('无法确认测试工作目录的真实归属')
  const stat = lstatSync(path, { bigint: true })
  return {
    id: header.id,
    log: relative(paths.home, path).split(sep).join('/'),
    headerRevision: header.revision,
    logRevision: hash(`${stat.size}:${stat.mtimeNs}:${stat.ino}`),
    cwd: relative(paths.qaRoot, header.cwd).split(sep).join('/') || '.'
  }
}
function sessions(paths: MaintenancePaths): { candidates: SessionCheck[]; skipped: number } {
  const root = localPath(paths.home, 'sessions'),
    candidates: SessionCheck[] = []
  let skipped = 0
  const seen = new Set<string>(),
    ambiguous = new Set<string>()
  if (!existsSync(root)) return { candidates, skipped }
  for (const project of readdirSync(root, { withFileTypes: true })) {
    if (!project.isDirectory() || project.isSymbolicLink()) {
      skipped++
      continue
    }
    const directory = localPath(paths.home, `sessions/${project.name}`)
    for (const session of readdirSync(directory, { withFileTypes: true })) {
      if (seen.has(session.name)) ambiguous.add(session.name)
      seen.add(session.name)
      if (!session.isDirectory() || session.isSymbolicLink()) {
        skipped++
        continue
      }
      try {
        const logDir = localPath(paths.home, `sessions/${project.name}/${session.name}`)
        const generations = readdirSync(logDir).filter((name) =>
          /^session(?:\.v\d+)?\.jsonl(?:\.zstd)?$/.test(name)
        )
        if (generations.some((name) => name !== 'session.v3.jsonl.zstd'))
          throw new Error('多代或不支持的日志格式')
        const header = verifiedHeader(paths, `sessions/${project.name}/${session.name}/session.v3.jsonl.zstd`)
        if (header.id !== session.name) throw new Error('会话目录与头标识不一致')
        if (candidates.some((item) => item.id === header.id)) throw new Error('会话 ID 存在重复来源')
        candidates.push(header)
      } catch {
        skipped++
      }
    }
  }
  return {
    candidates: candidates.filter((item) => !ambiguous.has(item.id)),
    skipped: skipped + ambiguous.size
  }
}
export function listQa(paths: MaintenancePaths, offset = 0, limit = 20) {
  if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 50)
    throw new Error('分页范围无效')
  const found = sessions(paths),
    state = units(paths),
    archived = new Set(state.workspace.value.global.archivedSessionIds ?? [])
  const candidates = found.candidates.sort((a, b) => a.id.localeCompare(b.id))
  return {
    total: candidates.length,
    skipped: found.skipped,
    sessions: candidates
      .slice(offset, offset + limit)
      .map((item) => ({ id: item.id, cwd: item.cwd, archived: archived.has(item.id) })),
    schedules: state.business.value.schedules
      .filter((s) => candidates.some((item) => item.id === s.sessionId) && !s.enabled)
      .map((s) => ({
        id: s.id,
        sessionId: s.sessionId,
        title: s.title,
        pending: s.history.some((h) => ['dispatching', 'queued', 'running', 'uncertain'].includes(h.status))
      }))
  }
}
export async function planQaArchive(paths: MaintenancePaths, sessionIds: string[], scheduleIds: string[]) {
  return offlineLease(paths, () => {
    if (
      (!sessionIds.length && !scheduleIds.length) ||
      sessionIds.length > 200 ||
      scheduleIds.length > 100 ||
      [...sessionIds, ...scheduleIds].some((id) => !identifier(id)) ||
      new Set(sessionIds).size !== sessionIds.length ||
      new Set(scheduleIds).size !== scheduleIds.length
    )
      throw new Error('必须显式选择不重复的 QA 会话或暂停任务 ID')
    const found = sessions(paths),
      state = units(paths),
      hidden = new Set(state.workspace.value.global.archivedSessionIds ?? [])
    const selectedSchedules = scheduleIds.map((id) => {
      const schedule = state.business.value.schedules.find((item) => item.id === id)
      if (
        !schedule ||
        schedule.enabled ||
        schedule.nextAt !== null ||
        schedule.history.some((h) => ['dispatching', 'queued', 'running', 'uncertain'].includes(h.status))
      )
        throw new Error('所选任务不存在、未暂停或仍有未结算投递，请先在应用核对')
      return schedule
    })
    const checks = [...new Set([...sessionIds, ...selectedSchedules.map((s) => s.sessionId)])].map((id) => {
      const session = found.candidates.find((item) => item.id === id)
      if (!session) throw new Error('所选记录不能确认属于当前仓库 build-test 内的测试会话')
      return { ...session, hide: sessionIds.includes(id), wasArchived: hidden.has(id) }
    })
    const plan: any = {
      schemaVersion: 1,
      id: randomUUID(),
      scope: paths.scope,
      kind: 'qa-archive',
      createdAt: new Date().toISOString(),
      workspaceRevision: state.workspace.revision,
      businessRevision: state.business.revision,
      sessions: checks,
      schedules: selectedSchedules.map((s) => ({
        id: s.id,
        sessionId: s.sessionId,
        title: s.title,
        revision: hash(JSON.stringify(s))
      }))
    }
    plan.digest = planDigest(plan)
    plan.confirmation = `archive-qa:${plan.id}:${plan.digest.slice(0, 12)}`
    atomicJson(privateFile(paths, 'plans', plan.id), plan)
    return plan
  })
}
function assertUniqueLogs(paths: MaintenancePaths, checks: SessionCheck[]): void {
  const expected = new Map(checks.map((check) => [check.id, check.log]))
  const found = new Map<string, string[]>()
  const root = localPath(paths.home, 'sessions')
  for (const project of readdirSync(root, { withFileTypes: true })) {
    if (project.isSymbolicLink()) throw new Error('会话存储含链接，无法确认 ID 唯一性')
    if (!project.isDirectory()) continue
    const directory = localPath(paths.home, `sessions/${project.name}`)
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) throw new Error('会话存储含链接，无法确认 ID 唯一性')
      if (!entry.isDirectory()) continue
      const log = `sessions/${project.name}/${entry.name}/session.v3.jsonl.zstd`
      try {
        const header = readSessionHeader(localPath(paths.home, log))
        if (expected.has(header.id)) found.set(header.id, [...(found.get(header.id) ?? []), log])
      } catch {
        if (expected.has(entry.name)) throw new Error('同 ID 日志存在不支持或损坏的来源，拒绝恢复')
      }
    }
  }
  for (const [id, log] of expected)
    if (found.get(id)?.length !== 1 || found.get(id)![0] !== log)
      throw new Error('同 ID 会话出现新的或重复日志来源，拒绝更改全局归档标志')
}
function archiveBody(archive: any) {
  const { status: _status, restoredAt: _restoredAt, digest: _digest, ...body } = archive
  return body
}
function readArchive(paths: MaintenancePaths, id: string): any {
  const archive = readJson(privateFile(paths, 'archives', id))
  if (
    !record(archive) ||
    archive.schemaVersion !== 1 ||
    archive.id !== id ||
    archive.scope !== paths.scope ||
    archive.kind !== 'qa-archive' ||
    !Array.isArray(archive.sessions) ||
    !Array.isArray(archive.schedules) ||
    !['prepared', 'archived', 'restored', 'interrupted'].includes(archive.status) ||
    archive.digest !== hash(JSON.stringify(archiveBody(archive)))
  )
    throw new Error('QA 归档版本或摘要不匹配')
  validateWorkspaceState({ version: 1, annotations: [], schedules: archive.schedules })
  if (archive.schedules.some((s: Schedule) => s.enabled || s.nextAt !== null))
    throw new Error('归档任务不是暂停状态')
  assertUniqueLogs(paths, archive.sessions)
  for (const check of archive.sessions) {
    if (
      !identifier(check.id) ||
      typeof check.log !== 'string' ||
      typeof check.hide !== 'boolean' ||
      typeof check.wasArchived !== 'boolean'
    )
      throw new Error('归档会话记录无效')
    const current = verifiedHeader(paths, check.log, false)
    if (current.id !== check.id || current.headerRevision !== check.headerRevision)
      throw new Error('同 ID 会话已变化或不可确认，拒绝恢复覆盖')
  }
  if (
    archive.schedules.some(
      (s: Schedule) => !archive.sessions.some((check: SessionCheck) => check.id === s.sessionId)
    )
  )
    throw new Error('归档任务的目标不属于所确认的测试会话')
  return archive
}
function transformed(state: ReturnType<typeof units>, archive: any, kind: string, at: number) {
  const workspace = {
    ...state.workspace.value,
    global: {
      ...state.workspace.value.global,
      archivedSessionIds: [...(state.workspace.value.global.archivedSessionIds ?? [])]
    }
  }
  const hidden = new Set<string>(workspace.global.archivedSessionIds)
  for (const session of archive.sessions)
    if (session.hide) {
      if (kind === 'qa-archive') hidden.add(session.id)
      else if (!session.wasArchived) hidden.delete(session.id)
    }
  workspace.global.archivedSessionIds = [...hidden]
  let schedules = state.business.value.schedules
  if (kind === 'qa-archive') {
    for (const original of archive.schedules) {
      const current = schedules.find((s) => s.id === original.id)
      if (!current || hash(JSON.stringify(current)) !== hash(JSON.stringify(original)))
        throw new Error('待归档任务已变化，原记录保留')
    }
    schedules = schedules.filter((s) => !archive.schedules.some((item: Schedule) => item.id === s.id))
  } else {
    const missing: Schedule[] = []
    for (const original of archive.schedules as Schedule[]) {
      const current = schedules.find((s) => s.id === original.id)
      if (current) {
        const earlierRestore = {
          ...original,
          enabled: false,
          nextAt: null,
          updatedAt: Date.parse(archive.restoredAt ?? '')
        }
        if (
          hash(JSON.stringify(current)) !== hash(JSON.stringify(original)) &&
          hash(JSON.stringify(current)) !== hash(JSON.stringify(earlierRestore))
        )
          throw new Error('同 ID 任务已存在，拒绝覆盖新增或修改的用户记录')
      } else missing.push({ ...original, enabled: false, nextAt: null, updatedAt: at })
    }
    schedules = [...schedules, ...missing]
  }
  const business = { ...state.business.value, schedules }
  nativeWorkspace(workspace)
  validateWorkspaceState(business)
  return { workspace, business }
}
function makeJournal(
  paths: MaintenancePaths,
  archive: any,
  kind: 'qa-archive' | 'qa-restore',
  state: ReturnType<typeof units>,
  at: number
) {
  const next = transformed(state, archive, kind, at)
  const targets = (['workspace', 'business'] as const)
    .filter((key) =>
      key === 'workspace'
        ? archive.sessions.some((s: SessionCheck) => s.hide && !s.wasArchived)
        : archive.schedules.length > 0
    )
    .map((key) => ({ key, before: state[key].revision, after: hash(jsonText(next[key])) }))
  const journal: any = {
    schemaVersion: 1,
    id: kind === 'qa-archive' ? archive.id : randomUUID(),
    scope: paths.scope,
    kind,
    archiveId: archive.id,
    archiveDigest: archive.digest,
    phase: 'prepared',
    at,
    targets
  }
  journal.digest = planDigest(journal)
  return journal
}
function finish(paths: MaintenancePaths, journal: any, afterWrite?: (key: string) => void) {
  if (
    !['qa-archive', 'qa-restore'].includes(journal.kind) ||
    !uuid(journal.archiveId) ||
    !Array.isArray(journal.targets) ||
    !Number.isFinite(journal.at)
  )
    throw new Error('QA 维护事务不受支持')
  const archive = readArchive(paths, journal.archiveId)
  if (archive.digest !== journal.archiveDigest) throw new Error('维护事务引用的归档已变化')
  if (journal.kind === 'qa-archive')
    for (const check of archive.sessions) {
      if (verifiedHeader(paths, check.log).logRevision !== check.logRevision)
        throw new Error('会话在计划或中断之后新增了数据，拒绝继续归档')
    }
  for (const target of journal.targets) {
    if (!['workspace', 'business'].includes(target.key)) throw new Error('维护目标无效')
    const key = target.key as keyof typeof keys,
      path = localPath(paths.home, keys[key]),
      current = revision(path)
    if (current === target.after) continue
    if (current !== target.before)
      throw new Error('数据在事务中断后发生变化；保留当前数据，可核对后使用 keep-current 结束事务')
    const state = units(paths)
    // Completed sibling writes must not be replayed when calculating this target.
    let next: any
    if (key === 'workspace') {
      const copy = { ...archive, schedules: [] }
      next = transformed(state, copy, journal.kind, journal.at).workspace
    } else {
      const copy = { ...archive, sessions: [] }
      next = transformed(state, copy, journal.kind, journal.at).business
    }
    if (hash(jsonText(next)) !== target.after) throw new Error('恢复结果与事务摘要不符，未覆盖原文件')
    atomicJson(path, next, target.before)
    afterWrite?.(key)
  }
  for (const target of journal.targets)
    if (revision(localPath(paths.home, keys[target.key as keyof typeof keys])) !== target.after)
      throw new Error('数据在提交期间再次变化，保留当前记录并等待核对')
  archive.status = journal.kind === 'qa-archive' ? 'archived' : 'restored'
  if (archive.status === 'restored') archive.restoredAt = new Date(journal.at).toISOString()
  atomicJson(privateFile(paths, 'archives', archive.id), archive)
  const receipt = {
    schemaVersion: 1,
    id: journal.id,
    scope: paths.scope,
    kind: journal.kind,
    archiveId: archive.id,
    state: 'completed',
    sessionIds: archive.sessions
      .filter((s: SessionCheck) => s.hide && !s.wasArchived)
      .map((s: SessionCheck) => s.id),
    scheduleIds: archive.schedules.map((s: Schedule) => s.id),
    finishedAt: new Date().toISOString()
  }
  atomicJson(privateFile(paths, 'receipts', journal.id), receipt)
  unlinkSync(localPath(paths.home, maintenanceJournal))
  return receipt
}
export async function applyQaArchive(
  paths: MaintenancePaths,
  id: string,
  confirmation: string,
  afterWrite?: (key: string) => void
) {
  return offlineLease(paths, () => {
    const plan = readPlan(paths, id, 'qa-archive')
    confirm(confirmation, 'archive-qa', id, plan.digest)
    const state = units(paths)
    if (
      state.workspace.revision !== plan.workspaceRevision ||
      state.business.revision !== plan.businessRevision
    )
      throw new Error('数据已变化，归档计划过期；未覆盖用户记录')
    if (!Array.isArray(plan.sessions) || !Array.isArray(plan.schedules)) throw new Error('归档计划结构无效')
    for (const check of plan.sessions) {
      const current = verifiedHeader(paths, check.log)
      if (
        current.id !== check.id ||
        current.headerRevision !== check.headerRevision ||
        current.logRevision !== check.logRevision
      )
        throw new Error('会话在计划后已变化，请重新核对 QA 归档对象')
    }
    const archive: any = {
      schemaVersion: 1,
      id,
      scope: paths.scope,
      kind: 'qa-archive',
      createdAt: plan.createdAt,
      sessions: plan.sessions,
      schedules: plan.schedules.map((item: any) => {
        const schedule = state.business.value.schedules.find((s) => s.id === item.id)
        if (!schedule || hash(JSON.stringify(schedule)) !== item.revision) throw new Error('待归档任务已变化')
        return schedule
      }),
      status: 'prepared'
    }
    archive.digest = hash(JSON.stringify(archiveBody(archive)))
    const file = privateFile(paths, 'archives', id)
    if (existsSync(file)) {
      const existing = readArchive(paths, id)
      if (existing.digest !== archive.digest || existing.status !== 'prepared')
        throw new Error('该计划已使用或归档已变化')
    } else atomicJson(file, archive, 'missing')
    readArchive(paths, id)
    const journal = makeJournal(paths, archive, 'qa-archive', state, Date.now())
    atomicJson(localPath(paths.home, maintenanceJournal), journal, 'missing')
    return finish(paths, journal, afterWrite)
  })
}
export function archiveInfo(paths: MaintenancePaths, id: string) {
  const archive = readArchive(paths, id)
  return {
    id,
    state: archive.status,
    sessionIds: archive.sessions.filter((s: SessionCheck) => s.hide).map((s: SessionCheck) => s.id),
    scheduleIds: archive.schedules.map((s: Schedule) => s.id),
    confirmation: `restore-qa:${id}:${archive.digest.slice(0, 12)}`
  }
}
export async function restoreQaArchive(
  paths: MaintenancePaths,
  id: string,
  confirmation: string,
  afterWrite?: (key: string) => void
) {
  return offlineLease(paths, () => {
    const archive = readArchive(paths, id)
    confirm(confirmation, 'restore-qa', id, archive.digest)
    if (!['archived', 'interrupted'].includes(archive.status))
      throw new Error('仅恢复已归档记录；未结束的事务请先 recover')
    const journal = makeJournal(paths, archive, 'qa-restore', units(paths), Date.now())
    atomicJson(localPath(paths.home, maintenanceJournal), journal, 'missing')
    return finish(paths, journal, afterWrite)
  })
}
export async function recoverQaArchive(paths: MaintenancePaths, confirmation: string) {
  return offlineLease(
    paths,
    () => {
      const journal = readJournal(paths)
      confirm(confirmation, 'recover', journal.id, journal.digest)
      return finish(paths, journal)
    },
    true
  )
}
