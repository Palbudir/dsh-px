import { createHash } from 'node:crypto'
export function patchNativeHistoryAuthorization(input: string): string {
  let source = input
  const baseHash = createHash('sha256').update(source).digest('hex')
  if (baseHash !== 'b2feaf3164d81080c667d4a391316a3a9549b1bd380a4bf23dedddce5707df11')
    throw Error('Native history authorization requires pinned source')
  const replace = (a: string, b: string) => {
    if (source.split(a).length !== 2) throw Error('Native history authorization anchor changed')
    source = source.replace(a, b)
  }
  replace(
    'if (agent === void 0) throw new HarnessError("session query tools require an agent-bound caller", "SESSION_QUERY_TOOL_MISSING_AGENT");\n\treturn {',
    'if (agent === void 0) throw new HarnessError("session query tools require an agent-bound caller", "SESSION_QUERY_TOOL_MISSING_AGENT");\n\tconst subject = ctx.get("pxNativeHistorySubjects")?.scope(agent, exec.name);\n\tif (!subject) throw new HarnessError("PX persona history authorization is unavailable", "SESSION_QUERY_TOOL_UNAUTHORIZED");\n\treturn {\n\t\tsubject,'
  )
  replace(
    'async function authorizeTarget(ctx, caller, target, signal) {',
    'async function authorizeTarget(ctx, caller, target, signal) {\n\tif (!caller.subject.allows(target)) throw serviceBoundary.unauthorizedTarget();'
  )
  replace(
    'function headerAuthorized(header, caller) {',
    'function headerAuthorized(header, caller) {\n\tif (!caller.subject.allows(header.id)) return false;'
  )
  replace(
    'const sessionFilters = toolInput.buildSessionFilters(args);',
    'const sessionFilters = toolInput.buildSessionFilters(args);\n\tsessionFilters.push({ kind: "id", values: [...caller.subject.ids] });'
  )
  replace(
    'const observations = await serviceBoundary.call(ctx, signal, "title observation", () => ctx.sessionQuery.readTitleSnapshots(ids, signal));',
    'const observations = await serviceBoundary.call(ctx, signal, "title observation", () => ctx.sessionQuery.readTitleSnapshots(ids, signal));\n\tif (!caller.subject.allows(caller.id) || ids.some(id => !caller.subject.allows(id))) throw serviceBoundary.unauthorizedTarget();'
  )
  replace(
    '\tawait workspaceAccess.authorizeTarget(ctx, caller, sessionId, exec.signal);\n\tconst window = await serviceBoundary.call',
    '\tif (caller.subject.bounded?.(sessionId)) {\n\t\tconst policy = ctx.get("pxNativeHistorySubjects");\n\t\tif (!policy?.readBounded) throw serviceBoundary.unauthorizedTarget();\n\t\treturn await policy.readBounded(caller.subject, caller.id, args, exec.signal);\n\t}\n\tawait workspaceAccess.authorizeTarget(ctx, caller, sessionId, exec.signal);\n\tconst window = await serviceBoundary.call'
  )
  replace(
    'async function executeEventSearch(ctx, args, exec, maxResults) {\n\tconst caller = workspaceAccess.callerOf(exec, ctx);\n\tconst sessionId = workspaceAccess.targetId(args, caller);',
    'async function executeEventSearch(ctx, args, exec, maxResults) {\n\tconst caller = workspaceAccess.callerOf(exec, ctx);\n\tconst sessionId = workspaceAccess.targetId(args, caller);\n\tif (caller.subject.bounded?.(sessionId)) {\n\t\tconst policy = ctx.get("pxNativeHistorySubjects");\n\t\tif (!policy?.searchBounded) throw serviceBoundary.unauthorizedTarget();\n\t\treturn await policy.searchBounded(caller.subject, caller.id, sessionId, toolInput.normalizeQuery(args.query), toolInput.buildEventFilters({seqFrom: args.seq_from, seqTo: args.seq_to, timeFrom: args.time_from, timeTo: args.time_to, eventTypes: args.event_types, surfaces: args.surfaces}), maxResults, exec.signal);\n\t}'
  )
  replace(
    'Read one full unabridged event and optional neighboring raw-event summaries from an authorized session.',
    'Read one native event in the current persona. Explicit handoffs return only shared visible evidence up to the authorized cutoff, with at most 10 neighbors per side; private instructions are excluded and long text provides continuation offsets.'
  )
  for (const [operation, seq] of [
    ['session lineage trace', 'undefined'],
    ['event trace', 'seq']
  ]) {
    const anchor =
      '\tawait workspaceAccess.authorizeTarget(ctx, caller, sessionId, exec.signal);\n\tconst trace = await serviceBoundary.call(ctx, exec.signal, "' +
      operation +
      '"'
    replace(
      anchor,
      '\tif (caller.subject.bounded?.(sessionId)) {\n\t\tconst policy = ctx.get("pxNativeHistorySubjects");\n\t\tif (!policy?.traceBounded) throw serviceBoundary.unauthorizedTarget();\n\t\treturn await policy.traceBounded(caller.subject, caller.id, sessionId, ' +
        seq +
        ', exec.signal);\n\t}\n' +
        anchor
    )
  }
  replace(
    'Read the authorized session lineage around one session, including complete visible ancestor and descendant relationships.',
    'Read session lineage within the current persona. A bounded handoff identifies its granted source and cutoff but does not grant the source parent or child sessions.'
  )
  replace(
    'Read every direct replacement and relationship to a cited source event for one event in an authorized session.',
    'Read event replacement and citation relationships within the authorized view. Bounded handoffs return only visible events before the cutoff, with an explicit inspection budget; omitted relations are not proof of absence.'
  )
  replace(
    '\treturn presentation.formatSessionSearch(collected, titles, authorizedParents);',
    '\tconst own = presentation.formatSessionSearch(collected, titles, authorizedParents);\n\tif (!caller.subject.boundedIds?.length) return own;\n\tconst policy = ctx.get("pxNativeHistorySubjects");\n\tif (!policy?.appendHandoffs) throw serviceBoundary.unauthorizedTarget();\n\treturn await policy.appendHandoffs(caller.subject, caller.id, args, query, toolInput.buildSessionFilters(args), eventFilters, own, maxResults, exec.signal);'
  )
  replace(
    'if (parentValues.length === 0) return presentation.formatEmptySessionSearch();',
    'if (parentValues.length === 0) {\n\t\t\tconst own = presentation.formatEmptySessionSearch();\n\t\t\tif (!caller.subject.boundedIds?.length) return own;\n\t\t\tconst policy = ctx.get("pxNativeHistorySubjects");\n\t\t\tif (!policy?.appendHandoffs) throw serviceBoundary.unauthorizedTarget();\n\t\t\treturn await policy.appendHandoffs(caller.subject, caller.id, args, query, toolInput.buildSessionFilters(args), eventFilters, own, maxResults, exec.signal);\n\t\t}'
  )
  const begin = source.indexOf('function apply(ctx, config) {'),
    end = source.indexOf('function resolveConfig(config)', begin),
    apply = source.slice(begin, end)
  if (apply.split('ctx.tools.register(defineTool({').length !== 6 || apply.split('\n\t}));').length !== 6)
    throw Error('Native tool registration shape changed')
  source =
    source.slice(0, begin) +
    'const pxSubjectTool = (definition) => ({ ...definition, pxSubjectPolicyVersion: 1 });\n' +
    apply
      .replaceAll('ctx.tools.register(defineTool({', 'ctx.tools.register(pxSubjectTool(defineTool({')
      .replaceAll('\n\t}));', '\n\t})));') +
    source.slice(end)
  return source
}
