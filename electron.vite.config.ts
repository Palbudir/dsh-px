import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import { resolve } from 'node:path'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: 'out/main',
      lib: { entry: resolve('src/main/index.ts') },
      rollupOptions: { output: { entryFileNames: 'index.js' } }
    }
  },
  // DSH serves the main UI; this renderer is the local startup/recovery page.
  renderer: { build: { outDir: resolve('out/renderer') } },
  preload: {
    build: {
      outDir: resolve('out/preload'),
      // Sandboxed Electron preloads use the CommonJS require shim.
      rollupOptions: { output: { format: 'cjs', entryFileNames: 'index.cjs' } }
    }
  }
})
