import { createHash } from 'node:crypto'

const digest = (source: string) => createHash('sha256').update(source).digest('hex')
function editor(input: string) {
  let source = input
  return {
    replace(from: string, to: string, count = 1) {
      if (source.split(from).length !== count + 1) throw Error('Native persona navigation anchor changed')
      source = source.replaceAll(from, to)
    },
    result: () => source
  }
}

/** Local companion only: native placement, preset resolution, writer admission and creation remain authoritative. */
export function patchNativePersonaController(source: string): string {
  // Accept the original pinned artifact or exactly the existing PX model-selection overlay.
  if (
    ![
      'a9801acb577b03053c5d5a3191ff555c5f1d791d0acddec113bea4511e33b386',
      'a2044acb4c0c9862b89372fbc1bbc6582bac7f8423446d0eae0c6c9b01ce9924'
    ].includes(digest(source))
  )
    throw Error('Native persona controller differs from pinned 0.2.1-rc.3')
  const patch = editor(source),
    replace = patch.replace
  replace('async create(request) {', 'async create(request, personaHooks) {')
  replace(
    'reusable: (sessionId) => !this.ctx.workspaceRegistry.archivedSessionIds.includes(sessionId)',
    'personaHooks,\n\t\t\t\treusable: (sessionId) => (personaHooks?.reusable(sessionId) ?? true) && !this.ctx.workspaceRegistry.archivedSessionIds.includes(sessionId)'
  )
  replace(
    'const sessionId = created.agent.id;',
    'const sessionId = created.agent.id;\n\t\tawait personaHooks?.resolved({ sessionId, cwd, agentPreset: created.agentPreset });'
  )
  replace(
    'create(request) {\n\t\t\treturn this.commands.create(request);\n\t\t}',
    `create(request) {\n\t\t\treturn this.commands.create(request);\n\t\t}
        async createForPersona(request, hooks) {
            try { return { ok: true, value: await this.commands.create(request, hooks) }; }
            catch (error) {
                const failure = remoteErrorOf(error);
                return { ok: false, error: { code: failure?.code ?? "gateway/internal", message: failure?.message ?? String(error), details: failure?.details ?? {} } };
            }
        }`
  )
  replace(
    'super(ctx, "sessionController", { namespace: "session" });',
    'super(ctx, "sessionController", { namespace: "session" });\n\t\t\tthis.pxPersonaCreationVersion = 1;'
  )
  replace(
    'this.createMinted(request.cwd, await this.composeAgent(request.agentPreset))',
    'this.createMinted(request.cwd, await this.composeAgent(request.agentPreset), request.personaHooks)'
  )
  replace(
    'this.createMinted(request.cwd, composition)',
    'this.createMinted(request.cwd, composition, request.personaHooks)',
    4
  )
  replace(
    'this.createAgent(sessionId, request.cwd, await this.composeAgent(request.agentPreset))',
    'this.createAgent(sessionId, request.cwd, await this.composeAgent(request.agentPreset), request.personaHooks)'
  )
  replace('setup: this.reuseSetup(composition)', 'setup: this.reuseSetup(composition, request.personaHooks)')
  replace(
    'this.assertPresetApplicable(live.id, request.agentPreset);',
    `this.assertPresetApplicable(live.id, request.agentPreset);
        if (request.personaHooks && !await request.personaHooks.beforeReuse({ sessionId: live.id, cwd: request.cwd, agentPreset: composition.agentPreset })) return;
        if (!request.reusable(live.id) || !this.isBlank(live.session)) return;`
  )
  replace('reuseSetup(composition) {', 'reuseSetup(composition, personaHooks) {')
  replace(
    'if (!this.isBlank(agent.session)) throw new ApiSessionStartedSinceObserved();',
    `if (!this.isBlank(agent.session)) throw new ApiSessionStartedSinceObserved();
            if (personaHooks && !await personaHooks.beforeReuse({ sessionId: agent.id, cwd: agent.session.header.cwd, agentPreset: composition.agentPreset })) throw new ApiSessionStartedSinceObserved();
            if (!this.isBlank(agent.session)) throw new ApiSessionStartedSinceObserved();`
  )
  replace(
    'createMinted(cwd, composition) {\n\t\treturn this.createAgent(brandString(`session-${randomUUID()}`), cwd, composition);',
    'createMinted(cwd, composition, personaHooks) {\n\t\treturn this.createAgent(brandString(`session-${randomUUID()}`), cwd, composition, personaHooks);'
  )
  replace(
    'async createAgent(sessionId, cwd, composition) {',
    'async createAgent(sessionId, cwd, composition, personaHooks) {'
  )
  replace(
    'return (await this.ctx.agents.create({',
    'await personaHooks?.beforeCreate({ sessionId, cwd, agentPreset: composition.agentPreset });\n\t\treturn (await this.ctx.agents.create({'
  )
  return patch.result()
}

/** Optional transport still passes through native placeholder, error and draft-address bookkeeping. */
export function patchNativePersonaSessionClient(source: string): string {
  if (digest(source) !== '82f2301c18f0e51340c1eedf8ecdfb939e873b3770a80632e438b86e82887d0e')
    throw Error('Native session client differs from pinned 0.2.1-rc.3')
  const patch = editor(source)
  patch.replace('async create(opts = {}) {', 'async create(opts = {}, transport) {', 2)
  patch.replace(
    'const result = await this.remote.session.create(payload);',
    'const result = await (transport ? transport(payload) : this.remote.session.create(payload));'
  )
  patch.replace(
    'const result = await this.manager.create(opts);',
    'const result = await this.manager.create(opts, transport);'
  )
  patch.replace(
    'rootCtx.reflect.provide("sessions", this, void 0);',
    'this.pxPersonaTransportVersion = 1;\n\t\t\t\trootCtx.reflect.provide("sessions", this, void 0);'
  )
  return patch.result()
}

/** New/workspace connection captures one window selection. Restoring a saved blank deliberately uses native create. */
export function patchNativePersonaWorkspaceClient(source: string): string {
  const start = source.indexOf('\t\tvar UiWorkspaceService = class'),
    end = source.indexOf('\t\t/**\n\t\t* `error` as the Session', start)
  if (
    !source.includes('id: "@deepseek-ai/dsh-client-ui-workspace"') ||
    start < 0 ||
    end < start ||
    digest(source.slice(start, end)) !== 'b93a06b3aeeafa92c6e1b5727bff020efacbe85c04a7bd44091dfb4d3ff10083'
  )
    throw Error('Native workspace navigation differs from pinned 0.2.1-rc.3')
  const patch = editor(source)
  patch.replace(
    'super(ctx, "uiWorkspace");',
    'super(ctx, "uiWorkspace");\n\t\t\t\tthis.pxPersonaNavigationVersion = 1;'
  )
  patch.replace(
    'const inflight = this.connecting.get(workspaceId);',
    'const persona = this.ctx.get("pxPersonaNavigation")?.capture();\n\t\t\t\tconst inflight = this.connecting.get(workspaceId);'
  )
  patch.replace(
    'inflight.agentPreset === reuse.agentPreset)',
    'inflight.agentPreset === reuse.agentPreset && inflight.personaKey === persona?.key)'
  )
  patch.replace(
    'this.createInWorkspace(workspace, reuse)',
    'this.createInWorkspace(workspace, reuse, persona)'
  )
  patch.replace(
    'agentPreset: reuse.agentPreset,\n\t\t\t\t\tattempt',
    'agentPreset: reuse.agentPreset,\n\t\t\t\t\tpersonaKey: persona?.key,\n\t\t\t\t\tattempt'
  )
  patch.replace('createInWorkspace(workspace, options) {', 'createInWorkspace(workspace, options, persona) {')
  patch.replace(
    '...options.agentPreset === void 0 ? {} : { agentPreset: options.agentPreset }\n\t\t\t\t});',
    '...options.agentPreset === void 0 ? {} : { agentPreset: options.agentPreset }\n\t\t\t\t}, persona?.transport);'
  )
  patch.replace(
    'async createNamed(request) {\n\t\t\t\tconst sessionId = await this.sessions.create(request);',
    'async createNamed(request, transport) {\n\t\t\t\tconst sessionId = await this.sessions.create(request, transport);'
  )
  return patch.result()
}
