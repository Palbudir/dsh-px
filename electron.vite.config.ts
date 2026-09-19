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
 * `resources/runtime/node/node.exe`，路径必须能在运行期按真实文件系统解析，
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
  }
})
