/** Prepare an isolated branded overlay over verified official build outputs. */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { basename, dirname, resolve, join } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { build } from 'esbuild'
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
  'preparePxDefaults(this.paths.profile);\n\t\t\tcreatePluginProfile(this.paths.profile);\n\t\t\tawait preparePxPack(this.paths.profile, this.runtime.dsh);'
)
main = replaceOnce(
  main,
  'async applyRelease() {\n\t\tawait this.withLock(() => {',
  'async applyRelease() {\n\t\tawait this.withLock(async () => {'
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
writeFileSync(
  join(lib, 'px-main.mjs'),
  'import { configurePxUpdates, preparePxDefaults, preparePxPack } from "./px-updates.mjs";\n' + main
)
await build({
  stdin: {
    contents: `import {configureSignedUpdates} from ${JSON.stringify(join(root, 'src/main/signed-update-provider.ts'))};
export function configurePxUpdates(updater){configureSignedUpdates(updater,${JSON.stringify(keys.keys)},'preview',${products.protocolGeneration})}
import {prepareNativeProfileDefaults,applyNativeDesktopPolicy} from ${JSON.stringify(join(root, 'src/main/native-profile-defaults.ts'))};
import {provisionNativePack} from ${JSON.stringify(join(root, 'src/main/native-pack-provision.ts'))};
import {createRequire} from 'node:module';import {join,delimiter} from 'node:path';import {pathToFileURL} from 'node:url';import {existsSync} from 'node:fs';
// PX profile preparation never stops the Host: defaults, telemetry policy and Pack provisioning only log failures.
export function preparePxDefaults(profile){
  try{return prepareNativeProfileDefaults(profile,process.env.DSH_PX_DOCUMENTS_DIRECTORY||'')}
  catch(error){console.error('[dsh-px] Profile defaults could not be applied; the Host starts without them',error);return false}
}
// provisionNativePack records and logs its own failures.
export async function preparePxPack(profile,runtimeDir){
  try{applyNativeDesktopPolicy(profile)}
  catch(error){console.error('[dsh-px] Desktop telemetry policy could not be applied; the Host starts with the current profile patch',error)}
  const archive=process.resourcesPath?join(process.resourcesPath,'px-pack.tgz'):'';
  if(process.env.DSH_DESKTOP_DEV_APP==='1'||!archive||!existsSync(archive)){
    console.error('[dsh-px] Bundled Pack archive unavailable (development app or missing resources/px-pack.tgz); Pack provisioning skipped');
    return 'skipped';
  }
  let runPluginCommand;
  try{
    const require=createRequire(join(runtimeDir,'package.json'));
    ({runPluginCommand}=await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-plugin-manager/operations')).href));
  }catch(error){console.error('[dsh-px] Native plugin operations unavailable; Pack provisioning skipped',error);return 'failed'}
  const result=await provisionNativePack({profile,archive,version:${JSON.stringify(products.pack.version)},sha256:${JSON.stringify(packSha256)},install:async archive=>{
    const result=await runPluginCommand({profile:'desktop',dir:profile,installAnchor:join(runtimeDir,'node_modules/@deepseek-ai/dsh/package.json'),cwd:profile},['add',archive.replaceAll('\\\\','/')],{
      execution:'service',command:process.execPath,args:['--expose-internals',join(process.resourcesPath,'runtime/pnpm/bin/pnpm.mjs')],outputBytes:16384,idleTimeoutMs:120000,signal:AbortSignal.timeout(300000),
      env:{ELECTRON_RUN_AS_NODE:'1',DSH_DESKTOP_NODE_EXECUTABLE:process.execPath,PATH:join(process.resourcesPath,'runtime/bin')+delimiter+(process.env.PATH||'')}
    });if(result.exitCode!==0||result.timedOut)throw Error('Native Pack installation failed; see '+result.logPath);
  }});
  return result;
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
// DSH_HOME stays outside Electron userData: the official NSIS uninstaller deletes %APPDATA%\<app>.
const bootstrap = `const {app,dialog}=require('electron');const {join,isAbsolute}=require('node:path');const {pathToFileURL}=require('node:url');
const {mkdirSync}=require('node:fs');app.setName('DSH-PX Desktop');const override=process.env.DSH_PX_USER_DATA_DIR;if(override&&!isAbsolute(override))throw Error('Absolute data path required');const userData=override||join(app.getPath('appData'),'dsh-px-desktop');mkdirSync(userData,{recursive:true});app.setPath('userData',userData);process.env.DSH_HOME=override?join(userData,'dsh-home'):join(require('node:os').homedir(),'.dsh-px');process.env.DSH_PX_DOCUMENTS_DIRECTORY=override?join(userData,'documents'):join(app.getPath('documents'),'DSH-PX');
app.on('browser-window-created',(_e,window)=>{window.on('page-title-updated',(e,title)=>{e.preventDefault();const branded=title.replaceAll('DeepSeek Harness','DSH-PX Desktop');window.setTitle(branded);if(branded!==title)window.webContents.executeJavaScript('document.title='+JSON.stringify(branded)).catch(()=>{})})});
import(new URL('./px-main.mjs',pathToFileURL(__filename)).href).catch(e=>{console.error(e);dialog.showErrorBox('DSH-PX Desktop',String(e));app.exit(1)});
`
writeFileSync(join(lib, 'px-bootstrap.cjs'), bootstrap)
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
config.files=config.files.filter(f=>f!=='lib/main.js');config.files.push('lib/px-main.mjs','lib/px-bootstrap.cjs','lib/px-updates.mjs',${brandedPreloads.map((n) => JSON.stringify('lib/px-' + n)).join(',')});
config.win.icon=${JSON.stringify(join(root, 'build/icon.png'))};config.extraResources=config.extraResources.map(r=>r.to==='icon.png'?{...r,from:${JSON.stringify(join(root, 'build/icon.png'))}}:r);
config.extraResources.push({from:${JSON.stringify(packArchive)},to:'px-pack.tgz'});
config.directories.output=${JSON.stringify(join(output, 'dist'))};config.artifactName='DSH-PX-Desktop-\${version}-win-x64.\${ext}';config.nsis.differentialPackage=false;
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
console.log('Prepared native Desktop overlay: ' + join(output, 'builder.mjs'))
