import { createHash } from 'node:crypto'

export const NATIVE_MODEL_CONTROLLER_SHA256 =
  'fb0f7b96130f595db20809eeb77a195b05f4a039f931d1e67692f1f74a4dd269'
/** One pre-mutation hook under DSH's own admission serialization; no replacement of its RPC or selection logic. */
export function patchNativeModelGuard(source: string): string {
  if (createHash('sha256').update(source).digest('hex') !== NATIVE_MODEL_CONTROLLER_SHA256)
    throw Error('Native model controller differs from pinned 0.2.0-rc.2')
  const replace = (from: string, to: string) => {
    if (source.split(from).length !== 2) throw Error('Native model guard anchor changed')
    source = source.replace(from, to)
  }
  replace(
    'this.agents.selectForNextRequest(agent, selected);',
    'await this.ctx.get("pxContextPolicy")?.select(agent, selected);\n\t\t\t\tthis.agents.selectForNextRequest(agent, selected);'
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
    throw Error('Native compaction differs from pinned 0.2.0-rc.2')
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
  return source
}
