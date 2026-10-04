/** Prepare an isolated branded overlay over verified official build outputs. */
import { readFileSync, writeFileSync, mkdirSync, cpSync, existsSync } from 'node:fs'
import { basename, dirname, resolve, join, relative } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { build } from 'esbuild'
import { releaseAssetNames } from './release-version.mjs'
const root = fileURLToPath(new URL('../', import.meta.url))
if (!process.argv[2] || process.argv[2].startsWith('--'))
  throw Error(
    'Usage: prepare-native-desktop <prepared upstream checkout> --pack=<verified Pack tgz> [--candidate]'
  )
const upstream = resolve(process.argv[2])
const pin = JSON.parse(readFileSync(join(root, 'config/native-desktop.json'), 'utf8'))
const expected = pin.commit
const candidate = process.argv.includes('--candidate')
if (execFileSync('git', ['rev-parse', 'HEAD'], { cwd: upstream, encoding: 'utf8' }).trim() !== expected)
  throw Error('Wrong upstream')
if (execFileSync('git', ['status', '--porcelain'], { cwd: upstream, encoding: 'utf8' }).trim())
  throw Error('Upstream sources must be clean')
const app = join(upstream, 'apps/desktop'),
  lib = join(app, 'lib'),
  output = join(app, '.desktop-build/px')
mkdirSync(output, { recursive: true })
const products = JSON.parse(readFileSync(join(root, 'config/products.json'), 'utf8'))
if (
  !candidate &&
  (products.desktop.architecture !== 'official-derived' ||
    products.desktop.hostVersion !== pin.version ||
    !products.pack.hostVersions.includes(pin.version))
)
  throw Error(
    'Native Desktop is not the active product contract; --candidate is required for isolated validation'
  )
const keys = JSON.parse(readFileSync(join(root, 'config/update-keys.json'), 'utf8'))
const ownHead = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()
const ownDirty = !!execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim()
const packOption = process.argv.find((arg) => arg.startsWith('--pack='))
if (!packOption) throw Error('A verified native Pack archive is required: --pack=<tgz>')
const packArchive = resolve(packOption.slice('--pack='.length))
const packBytes = readFileSync(packArchive)
const packSha256 = createHash('sha256').update(packBytes).digest('hex')
const packManifest = JSON.parse(
  execFileSync('tar', ['-xOf', packArchive, 'package/package.json'], { encoding: 'utf8', windowsHide: true })
)
if (packManifest.dshPx?.sourceCommit !== ownHead)
  throw Error('Pack must be rebuilt for the current source commit')
const distribution = JSON.parse(
  execFileSync('tar', ['-xOf', packArchive, 'package/distribution.json'], {
    encoding: 'utf8',
    windowsHide: true
  })
)
if (
  distribution.schemaVersion !== 1 ||
  distribution.version !== products.pack.version ||
  distribution.foundation?.name !== 'dsh-px-core'
)
  throw Error('Missing native Pack distribution')
const distributionDir = join(output, 'distribution-' + packSha256)
mkdirSync(distributionDir, { recursive: true })
writeFileSync(join(distributionDir, 'distribution.json'), JSON.stringify(distribution, null, 2) + '\n')
for (const entry of [distribution.foundation, ...distribution.features]) {
  if (
    entry.file !== `distribution/${entry.name}-${products.pack.version}.tgz` ||
    !/^[a-z0-9-]+$/.test(entry.name)
  )
    throw Error('Invalid distribution file')
  const bytes = execFileSync('tar', ['-xOf', packArchive, 'package/' + entry.file], {
    windowsHide: true,
    maxBuffer: 32 * 1024 * 1024
  })
  if (createHash('sha256').update(bytes).digest('hex') !== entry.sha256)
    throw Error('Distribution digest mismatch')
  mkdirSync(dirname(join(distributionDir, entry.file)), { recursive: true })
  writeFileSync(join(distributionDir, entry.file), bytes)
}
const coreDir = join(distributionDir, 'foundation')
mkdirSync(coreDir, { recursive: true })
execFileSync('tar', ['-xzf', relative(coreDir, join(distributionDir, distribution.foundation.file))], {
  cwd: coreDir,
  windowsHide: true
})
const nativeAnchor = join(
  app,
  '.desktop-build/targets/win-x64/dsh/node_modules/@deepseek-ai/dsh/package.json'
)
const foundationManifest = JSON.parse(readFileSync(join(coreDir, 'package/package.json'), 'utf8'))
const installationManifest = JSON.parse(readFileSync(nativeAnchor, 'utf8'))
installationManifest.dependencies = {
  ...installationManifest.dependencies,
  'dsh-px-core': products.pack.version,
  ...foundationManifest.dependencies
}
const pxAnchor = join(distributionDir, 'dsh-package.json')
writeFileSync(pxAnchor, JSON.stringify(installationManifest, null, 2) + '\n')
// Assemble a private runtime tree instead of overlapping electron-builder file mappings.
const nativeRuntime = join(app, '.desktop-build/targets/win-x64/dsh')
const pxRuntime = join(output, 'runtime-' + packSha256)
const runtimeReady = join(pxRuntime, '.px-runtime-ready')
if (!existsSync(runtimeReady)) {
  cpSync(nativeRuntime, pxRuntime, { recursive: true })
  writeFileSync(
    join(pxRuntime, 'node_modules/@deepseek-ai/dsh/package.json'),
    JSON.stringify(installationManifest, null, 2) + '\n'
  )
  cpSync(join(coreDir, 'package'), join(pxRuntime, 'node_modules/dsh-px-core'), { recursive: true })
  for (const name of Object.keys(foundationManifest.dependencies))
    cpSync(join(coreDir, 'package/node_modules', name), join(pxRuntime, 'node_modules', name), {
      recursive: true
    })
  writeFileSync(runtimeReady, packSha256)
}
if (
  packManifest.name !== 'dsh-px-pack' ||
  packManifest.version !== products.pack.version ||
  packManifest.dshPx?.hostVersion !== pin.version ||
  packManifest.dshPx?.upstreamCommit !== expected ||
  packManifest.dshPx?.protocolGeneration !== products.protocolGeneration
)
  throw Error('Pack archive does not match Desktop contract')
if (
  !candidate &&
  (ownDirty ||
    packManifest.dshPx?.candidate !== false ||
    packManifest.dshPx?.sourceDirty !== false ||
    packManifest.dshPx?.sourceCommit !== ownHead)
)
  throw Error('Release Desktop requires clean same-commit release Pack')
if (!candidate) {
  // A release embeds exactly the Pack its quality gate recorded: the artifact.json written next to
  // the archive by build-native-pack must describe these bytes.
  const recordPath = join(dirname(packArchive), 'artifact.json')
  let record
  try {
    record = JSON.parse(readFileSync(recordPath, 'utf8'))
  } catch {
    throw Error('Release Desktop requires the Pack artifact.json next to the archive')
  }
  if (
    record.artifact !== basename(packArchive) ||
    record.version !== products.pack.version ||
    record.candidate !== false ||
    record.sourceDirty !== false ||
    record.sourceCommit !== ownHead ||
    record.size !== packBytes.length ||
    record.sha256 !== packSha256 ||
    record.sha512 !== createHash('sha512').update(packBytes).digest('base64')
  )
    throw Error('Pack archive does not match its release artifact record')
}
// First-start Pack provisioning calls runPluginCommand(context, args, options) from the packaged dsh
// directory, which the official build stages at .desktop-build/targets/win-x64/dsh. Verify that
// contract here so a changed upstream fails the build instead of silently skipping the Pack.
const pluginManager = join(
  app,
  '.desktop-build/targets/win-x64/dsh/node_modules/@deepseek-ai/dsh-plugin-manager'
)
let pluginManifest
try {
  pluginManifest = JSON.parse(readFileSync(join(pluginManager, 'package.json'), 'utf8'))
} catch {
  throw Error('Packaged dsh does not contain @deepseek-ai/dsh-plugin-manager')
}
const operationsEntry = pluginManifest.exports?.['./operations']?.default
if (
  pluginManifest.name !== '@deepseek-ai/dsh-plugin-manager' ||
  pluginManifest.version !== pin.version ||
  typeof operationsEntry !== 'string'
)
  throw Error('Packaged dsh plugin manager does not match the pinned host or lacks ./operations')
const { runPluginCommand: operation } = await import(pathToFileURL(join(pluginManager, operationsEntry)).href)
if (typeof operation !== 'function' || operation.length !== 3)
  throw Error('Packaged dsh plugin manager no longer exports runPluginCommand(context, args, options)')
function replaceOnce(text, from, to) {
  if (text.split(from).length !== 2) throw Error('Upstream patch anchor changed: ' + from)
  return text.replace(from, to)
}
const original = readFileSync(join(lib, 'main.js'), 'utf8')
function assertDigest(text, expected, label) {
  if (createHash('sha256').update(text).digest('hex') !== expected)
    throw Error(label + ' differs from pinned compiled upstream')
}
assertDigest(original, pin.compiledMainSha256, 'Desktop main')
let main = replaceOnce(
  original,
  'this.updater.allowDowngrade = false;',
  'this.updater.allowDowngrade = false;\n\t\tconfigurePxUpdates(this.updater);'
)
main = replaceOnce(
  main,
  'if (app.isPackaged || process.env.DSH_DESKTOP_DEV_APP === "1") app.setAsDefaultProtocolClient("dsh");',
  'if ((app.isPackaged || process.env.DSH_DESKTOP_DEV_APP === "1") && process.env.DSH_PX_DISABLE_PROTOCOL_REGISTRATION !== "1") app.setAsDefaultProtocolClient("dsh-px");'
)
main = replaceOnce(
  main,
  'createPluginProfile(this.paths.profile);',
  'preparePxDefaults(this.paths.profile);\n\t\t\tcreatePluginProfile(this.paths.profile);\n\t\t\tthis.runtime.dsh = await preparePxPack(this.paths.profile, this.runtime.dsh);'
)
main = replaceOnce(
  main,
  'async applyRelease() {\n\t\tawait this.withLock(() => {',
  'async applyRelease() {\n\t\tawait this.withLock(async () => {'
)
main = replaceOnce(
  main,
  'const updateJournal = journalDirectory === void 0 ? void 0 : new DesktopUpdateJournal(journalDirectory, app.getVersion());',
  'const updateJournal = createUpdateJournal(DesktopUpdateJournal, journalDirectory, app.getPath("userData"), app.getVersion());'
)
main = replaceOnce(
  main,
  '\tasync install(version) {',
  `\tasync restartPack(version, commit) {
    this.assertLive();
    if (this.downloadOperation || this.installOperation || this.downloaded) throw Error('请先完成或取消客户端更新');
    const previous = this.current;
    this.installOperation = Promise.resolve().then(async () => {
      await this.checkOperation;
      this.setState({phase:'installing', version});
      try {
        if (!await this.beforeRestart()) { this.setState(previous); return false; }
        this.assertLive();
        commit();
        app.relaunch(); app.quit(); return true;
      } catch (error) { this.setState(this.failure(error, 'install')); throw error; }
    }).finally(() => { this.installOperation = undefined; });
    return this.installOperation;
  }
\tasync install(version) {`
)
main = replaceOnce(
  main,
  'const updateSchedule = new DesktopUpdateSchedule(',
  `const pxUpdateWindow = createPackUpdateWindow({app, BrowserWindow, ipcMain, net}, {assets: fileURLToPath(new URL('.', import.meta.url)), deployment: currentPackDeployment, desktop: updates, restart: (version, commit) => updates.restartPack(version, commit)});
\tconst updateSchedule = new DesktopUpdateSchedule(`
)
main = replaceOnce(main, 'await openUpdatePrompt();', 'pxUpdateWindow.open();')
main = replaceOnce(
  main,
  '\t\t\t...this.target(),\n\t\t\tpercent\n',
  '\t\t\t...this.target(),\n\t\t\tpercent, transferred: progress.transferred, total: progress.total, bytesPerSecond: progress.bytesPerSecond\n'
)
main = replaceOnce(
  main,
  'DSH_CLIENT_VERSION: desktopClientVersion()',
  'DSH_PX_MANAGED_PACK: "1",\n\t\t\tDSH_CLIENT_VERSION: desktopClientVersion()'
)
main = main.replaceAll('openUpdatePrompt(true)', 'Promise.resolve(pxUpdateWindow.open())')
main = main.replaceAll(
  'if (backend.host !== void 0) updateJournal?.action("workspace-ready");',
  'if (backend.host !== void 0) { confirmPackStartup(); updateJournal?.action("workspace-ready"); }'
)
// Both the native menu and the Windows title-bar Application popup use applicationItems().
// Resolve the currently owned Host at click time so a restart cannot reuse an earlier port/token.
main = replaceOnce(
  main,
  'const applicationItems = () => [',
  `const applicationItems = () => [
    {
      label: currentDesktopLocale().id.startsWith('zh') ? '在浏览器中打开' : 'Open in Browser',
      click: () => {
        openDesktopInBrowser(backend.host === undefined ? undefined : hostUrl, (url) => shell.openExternal(url)).catch(() => {
          const zh = currentDesktopLocale().id.startsWith('zh');
          void dialog.showMessageBox({type: 'error', title: 'DSH-PX Desktop', message: zh ? '无法打开浏览器' : 'Could not open browser', detail: zh ? '请确认本机服务已启动，并检查系统默认浏览器设置。' : 'Make sure the local service is running and check your default browser settings.'});
        });
      }
    },
    {type: 'separator'},`
)
// Branded preload copies: the originals stay untouched and are no longer loaded by px-main.
// Each original is pinned by digest, so the text rewrite only ever runs over reviewed upstream content.
const brandedPreloads = ['preload-app.cjs', 'preload-welcome.cjs']
for (const name of brandedPreloads) {
  const source = readFileSync(join(lib, name), 'utf8')
  const pinned = pin.preloadSha256?.[name]
  if (typeof pinned !== 'string' || !/^[a-f0-9]{64}$/.test(pinned))
    throw Error('Missing pinned digest for upstream preload: ' + name)
  assertDigest(source, pinned, 'Desktop ' + name)
  if (!source.includes('DeepSeek Harness')) throw Error('Upstream preload brand anchor changed: ' + name)
  writeFileSync(join(lib, 'px-' + name), source.replaceAll('DeepSeek Harness', 'DSH-PX Desktop'))
  main = replaceOnce(
    main,
    `new URL("./${name}", import.meta.url)`,
    `new URL("./px-${name}", import.meta.url)`
  )
}
main = main
  .replaceAll('"dsh://open"', '"dsh-px://open"')
  .replaceAll('"dsh://open/"', '"dsh-px://open/"')
  .replaceAll('DeepSeek Harness', 'DSH-PX Desktop')
// Our third-party distribution does not enable official product-use telemetry.
main = replaceOnce(
  main,
  'analyticsEnabled = await welcomeBackend.analyticsEnabled().catch(() => false);',
  'analyticsEnabled = false;'
)
main = replaceOnce(main, 'analyticsEnabled = enabled;', 'analyticsEnabled = false;')
// Assumptions of the splices above, checked on the pinned bundle: the protocol is fully renamed, and
// the profile lock holds across the awaited Pack provisioning (withLock awaits its operation before
// releasing the lock in `finally`).
if (/["'`]dsh:\/\//.test(main) || (main.match(/"dsh-px:\/\/open\/?"/g) ?? []).length !== 2)
  throw Error('Patched Desktop main still contains the official dsh:// protocol')
if (
  !/async withLock\(operation\) \{[\s\S]*?try \{[\s\S]*?return await operation\(\);\s*\} finally \{[\s\S]*?unlinkSync\(lockPath\);/.test(
    main
  )
)
  throw Error('Upstream withLock no longer holds the profile lock across an awaited operation')
writeFileSync(
  join(lib, 'px-main.mjs'),
  'import { configurePxUpdates, preparePxDefaults, preparePxPack, openDesktopInBrowser, createUpdateJournal, createPackUpdateWindow, currentPackDeployment, confirmPackStartup } from "./px-updates.mjs";\n' +
    main
)
// The patched entry is text surgery on the pinned bundle; parse it now (including every injected
// `await`, which is only valid inside an async scope) so a bad splice fails the build, not the app.
try {
  execFileSync(process.execPath, ['--check', join(lib, 'px-main.mjs')], { stdio: 'pipe', windowsHide: true })
} catch (error) {
  throw Error('Patched Desktop main does not parse: ' + String(error.stderr ?? error.message).slice(0, 2000))
}
await build({
  stdin: {
    contents: `import {configureSignedUpdates} from ${JSON.stringify(join(root, 'src/main/signed-update-provider.ts'))};
export {openDesktopInBrowser} from ${JSON.stringify(join(root, 'src/main/open-browser.ts'))};
export {createUpdateJournal} from ${JSON.stringify(join(root, 'src/main/update-history.ts'))};
export {createPackUpdateWindow} from ${JSON.stringify(join(root, 'src/main/pack-update-window.ts'))};
import {PackDeployment} from ${JSON.stringify(join(root, 'src/main/pack-deployment.ts'))};
let deployment, bundledRuntime;
export function currentPackDeployment(){return deployment}
export function confirmPackStartup(){deployment?.confirm()}
export function configurePxUpdates(updater){configureSignedUpdates(updater,${JSON.stringify(keys.keys)},'preview',${products.protocolGeneration})}
import {prepareNativeProfileDefaults,applyNativeDesktopPolicy} from ${JSON.stringify(join(root, 'src/main/native-profile-defaults.ts'))};
import {createRequire} from 'node:module';import {createHash} from 'node:crypto';import {join,delimiter} from 'node:path';import {pathToFileURL} from 'node:url';import {existsSync,readFileSync} from 'node:fs';
// Defaults can degrade; an incomplete Pack installation must not start a mixed cohort.
export function preparePxDefaults(profile){
  try{return prepareNativeProfileDefaults(profile,process.env.DSH_PX_DOCUMENTS_DIRECTORY||'')}
  catch(error){console.error('[dsh-px] Profile defaults could not be applied; the Host starts without them',error);return false}
}
// Native composition upgrades run offline under the Desktop profile lock.
export async function preparePxPack(profile,runtimeDir){
  try{applyNativeDesktopPolicy(profile)}
  catch(error){console.error('[dsh-px] Desktop telemetry policy could not be applied; the Host starts with the current profile patch',error)}
  const archive=process.resourcesPath?join(process.resourcesPath,'px-pack.tgz'):'';
  if(process.env.DSH_DESKTOP_DEV_APP==='1')return runtimeDir;
  if(!archive||!existsSync(archive))throw Error('客户端缺少随附 Pack 归档，请重新运行安装程序修复；现有数据已保留。');
  bundledRuntime ??= runtimeDir;
  const hostInventory=createHash('sha256').update(readFileSync(join(bundledRuntime,'desktop-runtime.json'))).digest('hex');
  const foundation=JSON.parse(readFileSync(join(bundledRuntime,'node_modules/dsh-px-core/package.json'),'utf8'));
  if(foundation.version!==${JSON.stringify(products.pack.version)}||foundation.dshPx?.sourceCommit!==${JSON.stringify(ownHead)})throw Error('PX foundation does not match the installed Desktop');
  deployment = new PackDeployment({profile,bundledRuntime,bundledArchive:archive,candidate:${candidate},keys:${JSON.stringify(keys.keys)},hostKey:${JSON.stringify('native-cache-v1:' + expected)}+':'+hostInventory+':'+process.versions.node+':'+process.arch,bundled:${JSON.stringify({ version: products.pack.version, sha256: packSha256, sourceCommit: ownHead, hostVersion: pin.version, upstreamCommit: expected, protocolGeneration: products.protocolGeneration })},install:async (runtimeDir,args)=>{
    const require=createRequire(join(runtimeDir,'package.json'));
    const {runPluginCommand}=await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-plugin-manager/operations')).href);
    const result=await runPluginCommand({profile:'desktop',dir:profile,installAnchor:join(runtimeDir,'node_modules/@deepseek-ai/dsh/package.json'),cwd:profile},args,{
      execution:'service',command:process.execPath,args:['--expose-internals',join(process.resourcesPath,'runtime/pnpm/bin/pnpm.mjs')],outputBytes:16384,idleTimeoutMs:120000,signal:AbortSignal.timeout(300000),
      env:{ELECTRON_RUN_AS_NODE:'1',DSH_DESKTOP_NODE_EXECUTABLE:process.execPath,PATH:join(process.resourcesPath,'runtime/bin')+delimiter+(process.env.PATH||'')}
    });if(result.exitCode!==0||result.timedOut)throw Error('Native Pack installation failed; see '+result.logPath);
  }});
  process.env.DSH_PX_MANAGED_PACK='1';
  return deployment.activate();
}`,
    resolveDir: root,
    sourcefile: 'px-update-entry.ts',
    loader: 'ts'
  },
  outfile: join(lib, 'px-updates.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  banner: {
    js: "import {createRequire as __pxCreateRequire} from 'node:module'; const require=__pxCreateRequire(import.meta.url);"
  },
  external: ['electron', 'electron-updater'],
  legalComments: 'none'
})
// The signed provider subclasses electron-updater's Provider, so it must resolve the very module the
// official main uses for its updater: both import it as an external app dependency, never inlined.
const updaterImport = /^import \w+ from "electron-updater";$/m
const providerImport = /^import \{ Provider \} from "electron-updater";$/m
if (
  !updaterImport.test(original) ||
  !providerImport.test(readFileSync(join(lib, 'px-updates.mjs'), 'utf8')) ||
  typeof JSON.parse(readFileSync(join(app, 'package.json'), 'utf8')).dependencies?.['electron-updater'] !==
    'string'
)
  throw Error('Desktop main and the signed update provider no longer share the packaged electron-updater')
// Canonicalize Windows short aliases before deriving profile paths so native package identities match.
// DSH_HOME stays outside Electron userData: the official NSIS uninstaller deletes %APPDATA%\<app>.
const bootstrap = `const {app,dialog}=require('electron');const {join,isAbsolute}=require('node:path');const {pathToFileURL}=require('node:url');
const {mkdirSync,realpathSync}=require('node:fs');app.setName('DSH-PX Desktop');const override=process.env.DSH_PX_USER_DATA_DIR;if(override&&!isAbsolute(override))throw Error('Absolute data path required');const requestedData=override||join(app.getPath('appData'),'dsh-px-desktop');mkdirSync(requestedData,{recursive:true});const userData=realpathSync(requestedData);app.setPath('userData',userData);process.env.DSH_HOME=override?join(userData,'dsh-home'):join(require('node:os').homedir(),'.dsh-px');process.env.DSH_PX_DOCUMENTS_DIRECTORY=override?join(userData,'documents'):join(app.getPath('documents'),'DSH-PX');
app.on('browser-window-created',(_e,window)=>{window.on('page-title-updated',(e,title)=>{e.preventDefault();const branded=title.replaceAll('DeepSeek Harness','DSH-PX Desktop');window.setTitle(branded);if(branded!==title)window.webContents.executeJavaScript('document.title='+JSON.stringify(branded)).catch(()=>{})})});
import(new URL('./px-main.mjs',pathToFileURL(__filename)).href).catch(e=>{console.error(e);dialog.showErrorBox('DSH-PX Desktop',String(e));app.exit(1)});
`
writeFileSync(join(lib, 'px-bootstrap.cjs'), bootstrap)
for (const name of ['px-update-preload.cjs', 'px-updates.html', 'px-updates-renderer.js'])
  cpSync(join(root, 'src/main', name), join(lib, name))
// Keep the official command manager, but make its launcher use PX's executable and default home.
const cliSource = readFileSync(join(app, 'cli', 'dsh.cmd'), 'utf8')
const brandedCli = replaceOnce(
  replaceOnce(cliSource, 'DeepSeek Harness.exe', 'DSH-PX Desktop.exe'),
  '%~dp0..\\..\\..\\app.asar\\dsh\\node_modules\\@deepseek-ai\\dsh-desktop-host\\lib\\cli.js',
  '%~dp0px-cli.cjs'
).replace(
  'setlocal DisableDelayedExpansion',
  'setlocal DisableDelayedExpansion\r\nif not defined DSH_HOME set "DSH_HOME=%USERPROFILE%\\.dsh-px"'
)
const cliPath = join(output, 'dsh.cmd')
writeFileSync(cliPath, brandedCli)
const nativeSignals = replaceOnce(
  replaceOnce(
    readFileSync(join(upstream, 'apps/desktop-host/src/windows-cli-signals.ts'), 'utf8'),
    'installWindowsCliSignals()',
    'installWindowsCliSignals(loadKoffi: () => Promise<{default: any}>)'
  ),
  "await import('koffi')",
  'await loadKoffi()'
)
const signalsPath = join(output, 'windows-cli-signals.ts')
writeFileSync(signalsPath, nativeSignals)
await build({
  stdin: {
    contents: `import {runPackCli} from ${JSON.stringify(join(root, 'src/main/pack-cli.ts'))};import {installWindowsCliSignals} from ${JSON.stringify(signalsPath)};void runPackCli(installWindowsCliSignals).catch(error=>{console.error(error);process.exitCode=1});`,
    resolveDir: root,
    loader: 'ts'
  },
  outfile: join(output, 'px-cli.cjs'),
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node24'
})
const factoryPath = join(app, 'scripts/electron-builder-config.mjs'),
  factoryUrl = pathToFileURL(factoryPath).href
const originalFactory = readFileSync(factoryPath, 'utf8')
assertDigest(originalFactory, pin.builderFactorySha256, 'Builder factory')
let factory = replaceOnce(
  originalFactory,
  'const policy = resolveDesktopPolicyEnvironment(env)',
  'const policy = undefined'
)
factory = factory
  .replace(
    /from (['"])(\.{1,2}\/[^'"]+)\1/g,
    (_m, _q, spec) => 'from ' + JSON.stringify(new URL(spec, factoryUrl).href)
  )
  .replaceAll('import.meta.url', JSON.stringify(factoryUrl))
factory = factory.replace(
  /import\((['"])(\.{1,2}\/[^'"]+)\1\)/g,
  (_m, _q, spec) => 'import(' + JSON.stringify(new URL(spec, factoryUrl).href) + ')'
)
writeFileSync(join(output, 'factory.mjs'), factory)
const cfg = `import {createElectronBuilderConfig} from './factory.mjs';
const config=createElectronBuilderConfig({...process.env,DSH_DESKTOP_UNSIGNED:'1',DSH_DESKTOP_TARGET_PLATFORM:'win32',DSH_DESKTOP_TARGET_ARCH:'x64',DSH_DESKTOP_APP_ID:'com.palbudir.dshpx.desktop',DSH_DESKTOP_BUILD_COMMIT:${JSON.stringify(ownHead)},DSH_DESKTOP_BUILD_DIRTY:${JSON.stringify(ownDirty ? '1' : '0')}});
config.appId='com.palbudir.dshpx.desktop';config.productName='DSH-PX Desktop';config.protocols=[{name:'DSH-PX Desktop',schemes:['dsh-px']}];
config.extraMetadata={...config.extraMetadata,name:'dsh-px-desktop',version:${JSON.stringify(products.desktop.version)},main:'lib/px-bootstrap.cjs',dshDesktopAppId:config.appId,dshPx:{packVersion:${JSON.stringify(products.pack.version)},protocolGeneration:${products.protocolGeneration},upstreamCommit:${JSON.stringify(expected)},upstreamVersion:${JSON.stringify(pin.version)},candidate:${candidate},sourceCommit:${JSON.stringify(ownHead)},sourceDirty:${ownDirty}}};
config.files=config.files.filter(f=>f!=='lib/main.js');config.files.push('lib/px-main.mjs','lib/px-bootstrap.cjs','lib/px-updates.mjs','lib/px-update-preload.cjs','lib/px-updates.html','lib/px-updates-renderer.js',${brandedPreloads.map((n) => JSON.stringify('lib/px-' + n)).join(',')});
config.win.icon=${JSON.stringify(join(root, 'build/icon.png'))};config.extraResources=config.extraResources.map(r=>r.to==='icon.png'?{...r,from:${JSON.stringify(join(root, 'build/icon.png'))}}:r);
config.extraResources.push({from:${JSON.stringify(packArchive)},to:'px-pack.tgz'});
config.extraResources.push({from:${JSON.stringify(distributionDir)},to:'px-distribution',filter:['distribution.json','distribution/*.tgz']});
config.files=config.files.map(f=>typeof f==='object'&&f.to==='dsh'?{...f,from:${JSON.stringify(pxRuntime)}}:typeof f==='object'&&f.to==='dsh/node_modules'?{...f,from:${JSON.stringify(join(pxRuntime, 'node_modules'))}}:f);
config.extraResources=config.extraResources.map(r=>r.to==='runtime'?{...r,filter:['**/*','!cli/bin/dsh.cmd']}:r);
config.extraResources.push({from:${JSON.stringify(cliPath)},to:'runtime/cli/bin/dsh.cmd'});
config.extraResources.push({from:${JSON.stringify(join(output, 'px-cli.cjs'))},to:'runtime/cli/bin/px-cli.cjs'});
config.directories.output=${JSON.stringify(join(output, 'dist'))};config.artifactName=${JSON.stringify(releaseAssetNames('desktop', products.desktop.version).installer)};config.nsis.differentialPackage=true;
config.publish=[{provider:'generic',url:'https://raw.githubusercontent.com/Palbudir/dsh-px/updates/',channel:'preview',updaterCacheDirName:'dsh-px-desktop-updater'}];
if(process.env.DSH_PX_DIRECTORY_PROBE==='1'){if(!process.argv.includes('--dir'))throw Error('Directory probe cannot build installer');config.beforeBuild=()=>true;}
export default config;
`
writeFileSync(join(output, 'builder.mjs'), cfg)
writeFileSync(
  join(output, 'overlay.json'),
  JSON.stringify(
    {
      upstream: expected,
      sourceCommit: ownHead,
      sourceDirty: ownDirty,
      originalMainSha256: createHash('sha256').update(original).digest('hex'),
      mainSha256: createHash('sha256').update(main).digest('hex'),
      packSha256,
      version: products.desktop.version,
      config: join(output, 'builder.mjs')
    },
    null,
    2
  )
)
// Every file written above lies under paths the pinned upstream ignores (`lib/` and
// `apps/desktop/.desktop-build/`), so the tree stays clean for brand-native-installer, which
// requires `git status --porcelain` to be empty. A changed ignore rule fails here, not later.
const leftover = execFileSync('git', ['status', '--porcelain', '--untracked-files=all'], {
  cwd: upstream,
  encoding: 'utf8'
}).trim()
if (leftover)
  throw Error('Overlay output is not ignored by the pinned upstream tree:\n' + leftover.slice(0, 2000))
console.log('Prepared native Desktop overlay: ' + join(output, 'builder.mjs'))
