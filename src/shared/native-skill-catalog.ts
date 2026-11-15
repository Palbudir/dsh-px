import { createHash } from 'node:crypto'

export const NATIVE_SKILL_CATALOG_SHA256 = '17c306f8b166f12d6d12a9ccdf638930c37cc8c04c34a8ee8b6f50c6e4561d2c'

/** Refresh native user-skill reads without introducing a second catalog or changing invocation authority. */
export function patchNativeSkillCatalog(source: string): string {
  // Native CSS module names encode the build directory. Pin the entire behavior function,
  // which is identical in the official npm artifact and the pinned Desktop source build.
  const behaviorStart = source.indexOf('\t\tfunction apply(ctx) {'),
    behaviorEnd = source.indexOf('\t\t//#endregion\n\t\texports.apply = apply;', behaviorStart)
  if (
    !source.includes('id: "@deepseek-ai/dsh-client-ui-skill"') ||
    behaviorStart < 0 ||
    behaviorEnd <= behaviorStart ||
    createHash('sha256').update(source.slice(behaviorStart, behaviorEnd)).digest('hex') !==
      NATIVE_SKILL_CATALOG_SHA256
  )
    throw Error('Native skill client differs from pinned 0.2.1-rc.3')
  const replace = (from: string, to: string) => {
    if (source.split(from).length !== 2) throw Error('Native skill catalog anchor changed')
    source = source.replace(from, to)
  }
  const start = source.indexOf('\t\t\tconst fetchCatalog = (sessionId) => {'),
    end = source.indexOf('\t\t\tconst invalidate = (key) => {', start)
  if (start < 0 || end <= start) throw Error('Native skill catalog cache block changed')
  replace(
    source.slice(start, end),
    `\t\t\tconst fetchCatalog = (sessionId, fresh = false) => {
                const existing = fetches.get(sessionId);
                if (existing !== void 0 && (!fresh || existing.pending)) return existing;
                existing?.abort.abort();
                const abort = new AbortController();
                const promise = (async () => {
                    if (sessions.binding(sessionId) === void 0) throw new Error('skill catalog requires a retained session "' + sessionId + '"');
                    return sessions.using(sessionId, { source: "skillCatalog", signal: abort.signal }, async (reference) => {
                        abort.signal.throwIfAborted();
                        const state = reference.binding.session.getSnapshot();
                        if (state.openState !== "open") throw state.openError ?? new Error("session is not open");
                        const result = await skills.list({ sessionId }, abort.signal);
                        abort.signal.throwIfAborted();
                        if (!result.ok) throw new Error('skills/list failed: ' + result.error.code + ': ' + result.error.message);
                        return result.value.skills;
                    });
                })();
                const entry = { promise, abort, pending: true, settled: existing?.settled };
                fetches.set(sessionId, entry);
                promise.then((skills) => {
                    if (abort.signal.aborted || fetches.get(sessionId) !== entry) return;
                    const previous = entry.settled;
                    entry.pending = false;
                    entry.settled = skills;
                    // The lexicon contains names only. Re-querying an unchanged catalog must not
                    // cause notification -> candidates -> fetch loops or wake inactive sessions.
                    if (previous === void 0 || JSON.stringify(previous.map(skill => skill.name)) !== JSON.stringify(skills.map(skill => skill.name))) notifyLexicon(sessionId);
                }, () => {
                    if (fetches.get(sessionId) !== entry) return;
                    fetches.delete(sessionId);
                    if (entry.settled !== void 0) notifyLexicon(sessionId);
                });
                return entry;
            };
`
  )
  replace(
    'const skills = await fetchCatalog(session.sessionId).promise;',
    'const skills = await fetchCatalog(session.sessionId, true).promise;'
  )
  replace(
    'fetchCatalog(session.sessionId).promise.catch(() => {});',
    'fetchCatalog(session.sessionId, true).promise.catch(() => {});'
  )
  replace(
    'const settled = fetches.get(session.sessionId)?.settled;\n\t\t\t\t\tif (settled !== void 0) return open(settled);\n\t\t\t\t\tconst entry = fetchCatalog(session.sessionId);',
    'const entry = fetchCatalog(session.sessionId, true);'
  )
  return source
}
