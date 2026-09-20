/**
 * 把 `scripts/*.ts` 编译到 `build-scripts/*.js` 再运行。
 *
 * ## 为什么需要这一层
 *
 * 这些脚本的源码是 TypeScript（项目约定：自研代码用 TS 写），但**运行**必须
 * 用普通的 `.js`：
 *
 *   - Node 对 `.ts` 的原生支持（`--experimental-strip-types`）在 22.6+ 才有，
 *     且长期带 "experimental" 标记。CI 的 Node 版本一旦回退就会全线失败，
 *     而这类失败与脚本逻辑无关、很难归因。
 *   - 用 esbuild 做**纯类型擦除**（不做打包）产出的 `.js` 在任何 Node 20+ 上都能跑，
 *     且产物与源码一一对应，报错时的行号仍然可读。
 *
 * 本文件的职责只是"编译 + 原样转发参数"，不改变任何脚本的语义。
 */
import { build } from 'esbuild'
import { readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..')
const SRC_DIR = join(REPO, 'scripts')
const OUT_DIR = join(REPO, 'build-scripts')

/** 目标脚本名（不含扩展名）。第一个参数即名字。 */
const target = process.argv[2]
if (target === undefined || target.length === 0) {
  process.stderr.write('用法：node scripts/run.mjs <脚本名> [参数…]\n')
  process.stderr.write(`可用脚本：${readdirSync(SRC_DIR).filter((f) => f.endsWith('.ts')).join('、')}\n`)
  process.exit(2)
}

const entry = join(SRC_DIR, `${target}.ts`)

await build({
  entryPoints: [entry],
  bundle: true,
  // `packages: 'external'` —— 这些是构建工具，允许 import 仓库的开发依赖
  // （如 esbuild），与自研插件"零运行时依赖"的约束不同。
  packages: 'external',
  format: 'esm',
  platform: 'node',
  target: 'node20',
  outfile: join(OUT_DIR, `${target}.js`),
  // 注入仓库根：编译产物的 `import.meta.url` 指向 build-scripts/，
  // 任何"从自身位置上溯"的写法都会算错一层。见 scripts/paths.ts。
  banner: { js: `globalThis.__DSH_REPO__ = ${JSON.stringify(REPO)};` },
  // 保留可读性：脚本报错时行号要能对上源码。
  minify: false,
  legalComments: 'none',
  logLevel: 'warning'
})

// 原样转发剩余参数，并把 argv 改成被调用脚本的样子，
// 这样脚本里的 process.argv.slice(2) 语义与直接 node 调用完全一致。
process.argv = [process.argv[0], join(OUT_DIR, `${target}.js`), ...process.argv.slice(3)]

await import(pathToFileURL(join(OUT_DIR, `${target}.js`)).href)
