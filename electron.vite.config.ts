/**
 * electron-vite 构建配置。
 *
 * 参考了 dataelement/dsh-desktop 的做法（同一套 electron-vite 方案），
 * 但按本项目的需要做了精简：只有 main 进程需要构建，
 * 因为界面是 dsh 自己提供的 Web UI，我们没有自研 renderer 页面
 * （client 插件是独立包，走 dsh 的客户端模块体系，不由 electron-vite 处理）。
 *
 * 关键点：`externalizeDepsPlugin()` 把 package.json 里的 dependencies 外部化，
 * 不把它们打进 bundle。对本项目尤其重要 —— 主进程要 spawn 随附的
 * `resources/node/node.exe`，路径必须能在运行期按真实文件系统解析，
 * 不能被打包器重写。
 */
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import { resolve } from 'node:path'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: 'out/main',
      lib: {
        entry: resolve('src/main/index.ts')
      },
      rollupOptions: {
        output: {
          // 固定文件名，便于 electron-builder 的 main 字段与调试时定位。
          entryFileNames: 'index.js'
        }
      }
    }
  },
  // 进度页（首启/重启期间显示）的 renderer 入口。
  //
  // 为什么不是"没有 renderer 就留空"：electron-vite 会按
  //   ['main','renderer','preload'].filter(f => !config[f])
  // 判断"配置缺失"，而 `null`/`false` 也是 falsy，所以留空或置 null 都会让每次
  // 构建都打印 `(!) renderer and preload config is missing`。这个警告**无法在
  // 配置文件里关掉**（`ignoreConfigWarning` 只能从 CLI 传入），与其压制它，
  // 不如把本来就需要的那一个页面做成真入口 —— 警告消失，页面也不再埋在
  // 主进程的 HTML 模板字符串里。
  //
  // 应用主界面仍然是 dsh 自己提供的 Web UI（由 harness 的 HTTP 服务提供），
  // 这个 renderer 只负责启动期间的那个进度页。
  renderer: {
    // root 不覆盖：electron-vite 默认就是 `./src/renderer`，
    // 且它默认取 `<root>/index.html` 作为入口，正是我们要的。
    //
    // outDir 用**绝对路径**。写相对路径会相对 `root` 解析，很容易算错层级：
    // 曾写 `out/renderer` → 落到 `src/renderer/out/renderer`；
    // 改写 `../../out/renderer` → 变成 `out/../../out/renderer`（构建日志里
    // 显示为 `../../../../out/renderer`）。绝对路径一次说清，不依赖层级推理。
    build: {
      outDir: resolve('out/renderer')
    }
  },
  preload: {
    // 同上：root 默认 `./src/preload`；outDir 明确用绝对路径。
    build: {
      outDir: resolve('out/preload'),
      // sandboxed preload 使用 Electron 的 CommonJS require shim，不能产出 ESM。
      rollupOptions: { output: { format: 'cjs', entryFileNames: 'index.cjs' } }
    }
  }
})
