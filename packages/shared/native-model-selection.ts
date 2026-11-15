/** Reuse native pending selection and request headers; never overwrite the global default on resume. */
export function nativeModelSelection(host: any, sessionId: string, fallback: any): any {
  const get = (name: string) => (host.get ? host.get(name) : host[name])
  return {
    assembled: undefined,
    get current() {
      const session = get('sessions')?.get(sessionId),
        pending = session && get('sessionProjections')?.stateOf(session, 'modelSelection')?.pending
      if (pending) return { ...pending }
      const header = session?.requestHeader?.()
      if (header)
        return {
          provider: header.config.provider,
          model: header.config.model,
          ...(header.config.reasoningEffort !== undefined && header.adapterDefaults?.reasoningEffort !== true
            ? { reasoningEffort: header.config.reasoningEffort }
            : {})
        }
      return fallback
    },
    set current(value: any) {
      fallback = value
    }
  }
}
