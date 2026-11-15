import type { SessionChannel } from './subject-context'

export interface AudiencePolicy {
  /** Native preset contribution required before a public audience can reach prompt assembly. */
  section: string
  check(exec: any, binding: { channel: SessionChannel }): string | undefined
}
/** Trusted same-Host producers register execution rules. Data scope remains owned by the identity store. */
export class AudiencePolicies {
  readonly version = 1
  private readonly providers = new Map<string, AudiencePolicy>()
  register(provider: string, policy: AudiencePolicy): () => void {
    if (
      !/^[a-z][a-z0-9.-]{0,79}$/.test(provider) ||
      !/^[a-z0-9-]{1,100}$/.test(policy?.section) ||
      typeof policy.check !== 'function'
    )
      throw Error('公共受众执行策略无效')
    if (this.providers.has(provider)) throw Error('公共受众执行策略已被注册：' + provider)
    const owned = Object.freeze({ section: policy.section, check: policy.check })
    this.providers.set(provider, owned)
    return () => {
      if (this.providers.get(provider) === owned) this.providers.delete(provider)
    }
  }
  section(provider: string): string | undefined {
    return this.providers.get(provider)?.section
  }
  check(exec: any, binding: { channel: SessionChannel }): string | undefined {
    const policy = this.providers.get(binding.channel.provider)
    if (!policy) return '该公共会话的执行策略未就绪，未授予工具权限'
    try {
      // Native Jobs deliberately exposes unowned jobs to every caller. A public audience
      // must not list or consume those host-level records or another audience's output.
      if (exec.name === 'job_list')
        return '公共会话不能列出宿主作业；用 task_state 查看自己的 Job，并按原生编号读取'
      if (['job_output', 'job_kill'].includes(exec.name)) {
        const owner = exec.agent?.session?.id,
          ctx = exec.agent?.ctx,
          jobs = ctx?.get ? ctx.get('jobs') : ctx?.jobs,
          id = exec.arguments?.job_id
        if (!owner || typeof id !== 'string' || !jobs?.get || jobs.get(id, owner).owner !== owner)
          return '只能读取或停止当前公共会话自己拥有的作业'
      }
      return policy.check(exec, binding)
    } catch (error) {
      return error instanceof Error ? error.message : '无法核对公共会话执行权限'
    }
  }
}
