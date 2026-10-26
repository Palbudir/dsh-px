import { createHash } from 'node:crypto'

export const NATIVE_MODEL_CONTROLLER_SHA256 =
  'a9801acb577b03053c5d5a3191ff555c5f1d791d0acddec113bea4511e33b386'
/** One pre-mutation hook under DSH's own admission serialization; no replacement of its RPC or selection logic. */
export function patchNativeModelGuard(source: string): string {
  if (createHash('sha256').update(source).digest('hex') !== NATIVE_MODEL_CONTROLLER_SHA256)
    throw Error('Native model controller differs from pinned 0.2.1-rc.3')
  const replace = (from: string, to: string) => {
    if (source.split(from).length !== 2) throw Error('Native model guard anchor changed')
    source = source.replace(from, to)
  }
  replace(
    'this.agents.selectForNextRequest(agent, selected);',
    'await this.ctx.get("pxContextPolicy")?.select(agent, selected);\n\t\t\t\tthis.agents.selectForNextRequest(agent, selected);'
  )
  // The existing UI/RPC method keeps its default-saving behavior. IM plugins use
  // the local-only companion method; it shares validation and native admission.
  replace('async selectModel(request) {', 'async selectModel(request, rememberDefault = true) {')
  replace(
    'this.ctx.agentDefaultModel.saveSelection(selected).catch((error) => {',
    'if (rememberDefault) this.ctx.agentDefaultModel.saveSelection(selected).catch((error) => {'
  )
  replace(
    'selectModel(request) {\n\t\t\treturn this.commands.selectModel(request);\n\t\t}',
    'selectModel(request) {\n\t\t\treturn this.commands.selectModel(request);\n\t\t}\n\t\tselectModelForSession(request) {\n\t\t\treturn this.commands.selectModel(request, false);\n\t\t}'
  )
  replace(
    'super(ctx, "sessionController", { namespace: "session" });',
    'super(ctx, "sessionController", { namespace: "session" });\n\t\t\tthis.pxModelSelectionGuardVersion = 1;'
  )
  return source
}
export function patchNativeCompactionBudget(source: string): string {
  if (
    createHash('sha256').update(source).digest('hex') !==
    'b7ac52f20a36430cf01a66b3a36f23a48ffdb22708d714dbe1fff541b5df4ec5'
  )
    throw Error('Native compaction differs from pinned 0.2.1-rc.3')
  const replace = (from: string, to: string) => {
    if (source.split(from).length !== 2) throw Error('Native compaction policy anchor changed')
    source = source.replace(from, to)
  }
  replace(
    'return summarizeWithLlm(this.ctx, config, input, agent, signal);',
    'return summarizeWithLlm(this.ctx, target && this.ctx.get("pxContextPolicy") ? await this.ctx.get("pxContextPolicy").compaction(config, agent, target, signal, true) : config, input, agent, signal);'
  )
  replace(
    'const policy = resolveTargetPolicy(this.config, target);\n\t\tconst meter = this.ctx.tokenMeter;',
    'const originalPolicy = resolveTargetPolicy(this.config, target);\n\t\tconst policy = this.ctx.get("pxContextPolicy") ? await this.ctx.get("pxContextPolicy").compaction(originalPolicy, agent, target, signal) : originalPolicy;\n\t\tconst meter = this.ctx.tokenMeter;'
  )
  replace(
    'result = await this.compactRegion(range.start, range.end, agent, signal);',
    'if (this.ctx.get("pxContextPolicy")?.skipPressureCompaction?.(agent, range, measurement, spec)) return result;\n\t\t\tresult = await this.compactRegion(range.start, range.end, agent, signal);'
  )
  return source
}
