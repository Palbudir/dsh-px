/** Strict CLI arguments: no wildcard targets, inferred directories, or offline bypass flag. */
export function maintenanceArgs(argv: string[]) {
  const action = argv[0] ?? 'help'
  const values = new Map<string, string[]>()
  for (let i = 1; i < argv.length; i += 2) {
    const key = argv[i],
      value = argv[i + 1]
    if (!/^--[a-z-]+$/.test(key) || !value || value.startsWith('--'))
      throw new Error('参数必须使用 --名称 值')
    values.set(key, [...(values.get(key) ?? []), value])
  }
  return {
    action,
    allow(keys: string[]) {
      for (const key of values.keys()) if (!keys.includes(key)) throw new Error(`不支持的参数：${key}`)
    },
    one(key: string, fallback?: string): string {
      const list = values.get(key)
      if (list && list.length !== 1) throw new Error(`参数重复：${key}`)
      const value = list?.[0] ?? fallback
      if (value === undefined) throw new Error(`缺少参数：${key}`)
      return value
    },
    many: (key: string): string[] => values.get(key) ?? []
  }
}
