/**
 * 脚本的公共小工具。
 *
 * 存在的唯一理由：脚本源码是 `scripts/*.ts`，但**运行**的是编译产物
 * `build-scripts/*.js`（原因见 `scripts/run.mjs` 头部）。因此
 * `import.meta.url` 在运行期指向 `build-scripts/`，而不是 `scripts/` ——
 * 任何"从自身位置上溯找仓库根"的写法都会算错一层。
 *
 * 三种取值来源，按可靠性排序：
 *   1. `__DSH_REPO__` —— `run.mjs` 在运行前注入的仓库根（最可靠）
 *   2. `DSH_PX_REPO` 环境变量 —— 供外部工具显式指定
 *   3. 从 `import.meta.url` 向**上逐级查找**含 `package.json` 的目录 ——
 *      对 `scripts/*.ts`（直接跑源码）与 `build-scripts/*.js`（跑产物）都成立，
 *      因此不需要知道自己在哪一层
 *
 * 第 3 条刻意用"找 package.json"而不是"退 N 层"：退层数会随目录布局变化而失效，
 * 本项目在 `APP_ROOT` 上正好踩过一次这种坑（见 src/main/index.ts）。
 *
 * @module dsh-px/scripts/paths
 */
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** 声明由 `run.mjs` 注入的全局。 */
declare global {
  // eslint-disable-next-line no-var
  var __DSH_REPO__: string | undefined
}

/**
 * 仓库根目录。
 * @returns 绝对路径
 */
export function repoRoot (): string {
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
