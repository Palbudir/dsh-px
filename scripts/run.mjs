/** Compile a maintained TypeScript script with esbuild, then forward its arguments. */
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
  process.stderr.write(
    `可用脚本：${readdirSync(SRC_DIR)
      .filter((f) => f.endsWith('.ts'))
      .join('、')}\n`
  )
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
  target: 'node24',
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
