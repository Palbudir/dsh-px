import { z } from 'zod'
import { MemoryError } from './store'

/** DSH accepts a deliberate subset of JSON Schema. Keep bounds locally enforced. */
export function experienceOutput(schema: object) {
  const validator = z.fromJSONSchema(schema as Parameters<typeof z.fromJSONSchema>[0])
  const native = (source: any): any => {
    const { maxLength, maxItems, minimum, maximum, pattern, ...out } = source
    const bounds = { maxLength, maxItems, minimum, maximum, pattern }
    const hints = Object.entries(bounds).filter(([, value]) => value !== undefined)
    if (hints.length)
      out.description = [out.description, ...hints.map(([key, value]) => `${key}: ${value}`)]
        .filter(Boolean)
        .join('; ')
    if (out.properties)
      out.properties = Object.fromEntries(
        Object.entries(out.properties).map(([key, value]) => [key, native(value)])
      )
    if (out.items) out.items = native(out.items)
    if (out.oneOf) out.oneOf = out.oneOf.map(native)
    return out
  }
  return {
    schema: native(schema),
    parse(value: unknown) {
      const result = validator.safeParse(value)
      if (!result.success)
        throw new MemoryError(
          '经验结果不符合内容限制，未保存：' +
            result.error.issues
              .slice(0, 3)
              .map((issue) => issue.path.join('.') + ' ' + issue.code)
              .join('; '),
          422
        )
      return result.data
    }
  }
}
