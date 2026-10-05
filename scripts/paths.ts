/** Resolve the script workspace from the runner, an explicit path, or package.json. */
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** 声明由 `run.mjs` 注入的全局。 */
declare global {
  var __DSH_REPO__: string | undefined
}

/**
 * 仓库根目录。
 * @returns 绝对路径
 */
export function repoRoot(): string {
  const injected = globalThis.__DSH_REPO__
  if (typeof injected === 'string' && injected.length > 0) return injected

  const fromEnv = process.env.DSH_PX_REPO
  if (typeof fromEnv === 'string' && fromEnv.length > 0) return resolve(fromEnv)

  let dir = dirname(fileURLToPath(import.meta.url))
  for (let i = 0; i < 8; i += 1) {
    if (existsSync(join(dir, 'package.json'))) return dir
    const parent = resolve(dir, '..')
    if (parent === dir) break
    dir = parent
  }
  // 兜底：返回起点，让调用方在报错里带上自己的路径，便于定位。
  return dirname(fileURLToPath(import.meta.url))
}
