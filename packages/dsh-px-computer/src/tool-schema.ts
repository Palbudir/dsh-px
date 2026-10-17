/** DSH's PTC renderer accepts a smaller JSON Schema subset than the upstream MCP servers. */
const BOUNDS = ['minimum', 'maximum', 'minItems', 'maxItems', 'minLength', 'maxLength'] as const
type Schema = Record<string, any>

/** Preserve parameter structure; publish unsupported bounds as annotations and enforce them separately. */
export function nativeToolParameters(schema: Schema): Schema {
  const result = { ...schema }
  delete result.$schema
  const limits: string[] = []
  for (const name of BOUNDS) {
    if (schema[name] === undefined) continue
    limits.push(`${name}=${schema[name]}`)
    delete result[name]
  }
  if (limits.length)
    result.description = [schema.description, `限制：${limits.join(', ')}`].filter(Boolean).join('；')
  if (schema.properties)
    result.properties = Object.fromEntries(
      Object.entries(schema.properties).map(([key, value]) => [key, nativeToolParameters(value as Schema)])
    )
  if (schema.items) result.items = nativeToolParameters(schema.items)
  return result
}

/** Bounds omitted from the model-facing schema remain mandatory before approvals or driver calls. */
export function enforceToolBounds(schema: Schema, value: unknown, path = 'arguments'): void {
  if (value === undefined) return // Required arguments and their types remain the tool/backend's contract.
  for (const name of BOUNDS) {
    const bound = schema[name]
    if (bound === undefined) continue
    const measured =
      name === 'minimum' || name === 'maximum'
        ? typeof value === 'number' && Number.isFinite(value)
          ? value
          : undefined
        : name === 'minItems' || name === 'maxItems'
          ? Array.isArray(value)
            ? value.length
            : undefined
          : typeof value === 'string'
            ? Array.from(value).length
            : undefined
    const lower = name === 'minimum' || name === 'minItems' || name === 'minLength'
    if (measured === undefined || (lower ? measured < bound : measured > bound))
      throw Error(`${path} 不满足 ${name}=${bound}`)
  }
  if (schema.properties && value && typeof value === 'object' && !Array.isArray(value))
    for (const [key, child] of Object.entries(schema.properties))
      enforceToolBounds(child as Schema, (value as Record<string, unknown>)[key], `${path}.${key}`)
  if (schema.items && Array.isArray(value))
    value.forEach((item, index) => enforceToolBounds(schema.items, item, `${path}[${index}]`))
}
