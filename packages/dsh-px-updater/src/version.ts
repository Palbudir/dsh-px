// 构建时内联 semver；交付物无需用户安装依赖。
import valid from 'semver/functions/valid.js'
import gt from 'semver/functions/gt.js'

export function isValidVersion(value: unknown): value is string {
  return typeof value === 'string' && valid(value.trim()) !== null
}

export function isNewer(candidate: unknown, current: unknown): boolean {
  if (typeof candidate !== 'string' || typeof current !== 'string') return false
  const a = valid(candidate.trim())
  const b = valid(current.trim())
  return a !== null && b !== null && gt(a, b)
}
