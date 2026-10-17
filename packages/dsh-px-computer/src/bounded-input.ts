import { deniedKeys } from './policy'

const KEYS: Record<string, number> = {
  backspace: 8,
  tab: 9,
  enter: 13,
  return: 13,
  shift: 16,
  shift_l: 16,
  ctrl: 17,
  control: 17,
  control_l: 17,
  alt: 18,
  alt_l: 18,
  escape: 27,
  esc: 27,
  space: 32,
  pageup: 33,
  pagedown: 34,
  end: 35,
  home: 36,
  left: 37,
  up: 38,
  right: 39,
  down: 40,
  insert: 45,
  delete: 46
}

/** A short, finite input plan; never a script, indefinite key-down or implicit focus change. */
export function boundedInputPlan(args: Record<string, unknown>) {
  if (args.delivery_mode !== 'foreground') throw Error('有时长输入必须显式使用 foreground；不支持后台回退')
  const integer = (value: unknown, name: string, min: number, max: number): number => {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max)
      throw Error(`${name} 必须为 ${min}～${max} 的整数`)
    return value
  }
  const keyNames = args.keys ?? []
  const buttons = args.buttons ?? []
  if (!Array.isArray(keyNames) || keyNames.length > 6 || keyNames.some((key) => typeof key !== 'string'))
    throw Error('keys 最多包含 6 个按键名称')
  if (
    !Array.isArray(buttons) ||
    buttons.length > 2 ||
    buttons.some((button) => !['left', 'right', 'middle'].includes(button))
  )
    throw Error('buttons 最多包含两个不同鼠标按键')
  const denied = deniedKeys(keyNames)
  if (denied) throw Error(denied)
  const keys = keyNames.map((key: string) => {
    const normalized = key.trim().toLowerCase()
    const code = /^[a-z0-9]$/.test(normalized)
      ? normalized.toUpperCase().charCodeAt(0)
      : /^f([1-9]|1[0-2])$/.test(normalized)
        ? 111 + Number(normalized.slice(1))
        : KEYS[normalized]
    if (!code) throw Error(`不支持的持续按键：${key}`)
    return code
  })
  if (new Set(keys).size !== keys.length || new Set(buttons).size !== buttons.length)
    throw Error('不能重复指定同一个按键')
  const plan = {
    pid: integer(args.pid, 'pid', 1, 0xffffffff),
    window_id: integer(args.window_id, 'window_id', 1, Number.MAX_SAFE_INTEGER),
    keys,
    buttons: buttons as string[],
    duration_ms: integer(args.duration_ms, 'duration_ms', 10, 10000),
    dx: integer(args.dx ?? 0, 'dx', -2000, 2000),
    dy: integer(args.dy ?? 0, 'dy', -2000, 2000)
  }
  if (!keys.length && !buttons.length && !plan.dx && !plan.dy) throw Error('至少指定按键、鼠标按住或相对移动')
  return plan
}
