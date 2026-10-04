import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { homedir } from 'node:os'
import { createRequire } from 'node:module'
import { managedRuntimePath } from './runtime-cache'

export async function runPackCli(
  installSignals: (loadKoffi: () => Promise<{ default: any }>) => Promise<void>
): Promise<void> {
  const profile = join(process.env.DSH_HOME || join(homedir(), '.dsh-px'), 'profiles', 'desktop')
  const pointer = join(profile, '.dsh-px', 'runtime.json')
  let runtime = resolve(__dirname, '../../../app.asar/dsh')
  if (existsSync(pointer)) {
    const state = JSON.parse(readFileSync(pointer, 'utf8'))
    if (state.schemaVersion !== 1) throw Error('Unsupported PX runtime pointer')
    runtime = managedRuntimePath(profile, state.runtime)
  }
  if (process.platform === 'win32') {
    const require = createRequire(join(runtime, 'package.json'))
    await installSignals(async () => ({ default: require('koffi') }))
  }
  // Imported entry points do not set import.meta.main. Invoke the native exported CLI explicitly,
  // with the installed pnpm support directory rather than inferring it from the external cache.
  const { runDesktopCli } = await import(
    pathToFileURL(join(runtime, 'node_modules/@deepseek-ai/dsh-desktop-host/lib/cli.js')).href
  )
  await runDesktopCli(runtime, resolve(__dirname, '../..'))
}
