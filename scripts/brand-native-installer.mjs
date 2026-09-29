/**
 * Brand the official NSIS installer as DSH-PX without modifying pinned upstream files.
 *
 * The official `installer.nsh` defines `INSTALLER_STRINGS_FILE` and `INSTALLER_BUILD_DIR` with
 * `!define /ifndef`. A PX wrapper predefines both, then includes the unchanged official script, so
 * pages, the directory installer and the uninstall safety helper stay exactly the reviewed upstream
 * implementation. Only visible text and brand bitmaps differ.
 *
 * Usage (after scripts/prepare-native-desktop.mjs):
 *   node scripts/brand-native-installer.mjs <prepared upstream checkout> --icon=<build/icon.png>
 * Then build with --config .desktop-build/px/builder-branded.mjs
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const PX_INSTALLER_NAME = 'DSH-PX Desktop'
const OFFICIAL_NAMES = ['DeepSeek Harness']
/** Bitmaps the official installer embeds from INSTALLER_BUILD_DIR, besides window-frame.dll. */
export const BRAND_BITMAPS = ['brand', 'brand-2x', 'brand-dark', 'brand-dark-2x', 'uninstaller-sidebar']

/** Replace every official product name in the NSIS string table; nothing official may remain. */
export function brandInstallerStrings(source) {
  if (!OFFICIAL_NAMES.some((name) => source.includes(name)))
    throw new Error('Official installer strings changed; review the branding anchors')
  let text = source
  for (const name of OFFICIAL_NAMES) text = text.replaceAll(name, PX_INSTALLER_NAME)
  if (/DeepSeek|Harness/.test(text)) throw new Error('Official branding remains in installer strings')
  const declared = text.match(/^LangString\s+\w+/gm) ?? []
  const original = source.match(/^LangString\s+\w+/gm) ?? []
  if (!declared.length || declared.length !== original.length)
    throw new Error('Installer string table changed shape')
  return text.startsWith('; ') ? text : `; DSH-PX branding of the pinned official string table.\n${text}`
}

const nsisPath = (value) => {
  const path = resolve(value)
  if (/["\r\n$]/.test(path)) throw new Error(`Unsupported NSIS path: ${path}`)
  return path.replaceAll('/', '\\')
}

/** Predefine the two /ifndef symbols, then include the unchanged official installer script. */
export function installerWrapper({ stringsFile, buildDirectory, officialInstaller }) {
  return (
    '; DSH-PX installer wrapper. The official script is included unchanged; it uses !define /ifndef.\n' +
    `!define INSTALLER_STRINGS_FILE "${nsisPath(stringsFile)}"\n` +
    `!define INSTALLER_BUILD_DIR "${nsisPath(buildDirectory)}"\n` +
    `!include "${nsisPath(officialInstaller)}"\n`
  )
}

/**
 * The official uninstaller removes Electron userData and the updater cache only; DSH_HOME is never a
 * target. PX keeps DSH_HOME at %USERPROFILE%\.dsh-px, so uninstalling always preserves PX data.
 */
export function assertDataPreserved({ bootstrap, uninstall }) {
  if (!/join\(require\('node:os'\)\.homedir\(\),'\.dsh-px'\)/.test(bootstrap))
    throw new Error('PX bootstrap no longer keeps DSH_HOME at %USERPROFILE%\\.dsh-px')
  if (
    /\.dsh-px|DSH_HOME\\/.test(uninstall) ||
    !/\$APPDATA\\\$\{APP_PACKAGE_NAME\}|\$APPDATA\\\$\{PRODUCT_FILENAME\}/.test(uninstall)
  )
    throw new Error('Official uninstall targets changed; review data preservation')
  if (/MessageBox[^\n]*(?:delete|remove)/i.test(uninstall))
    throw new Error('Uninstaller unexpectedly offers a data deletion choice')
}

/** Wrap the prepared builder: keep its beforeBuild (compiles window-frame.dll), then add PX assets. */
export function brandedBuilderModule({ builder, officialUi, pxUi, wrapper }) {
  return `import {copyFileSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import config from ${JSON.stringify('./' + builder)};
const officialUi=${JSON.stringify(officialUi)},pxUi=${JSON.stringify(pxUi)};
if(process.env.DSH_PX_DIRECTORY_PROBE==='1')throw Error('The branded installer config builds only a real NSIS installer');
const official=config.beforeBuild;
if(typeof official!=='function')throw Error('Prepared builder lost the official installer preparation');
config.beforeBuild=async(context)=>{
  const result=await official(context);
  const dll=join(officialUi,'window-frame.dll');
  if(!existsSync(dll))throw Error('Official installer helper was not built: '+dll);
  copyFileSync(dll,join(pxUi,'window-frame.dll'));
  for(const name of ${JSON.stringify(BRAND_BITMAPS)})if(!existsSync(join(pxUi,name+'.bmp')))throw Error('PX installer bitmap missing: '+name);
  return result;
};
config.nsis={...config.nsis,include:${JSON.stringify(wrapper)},installerSidebar:join(pxUi,'uninstaller-sidebar.bmp'),uninstallerSidebar:join(pxUi,'uninstaller-sidebar.bmp'),differentialPackage:false};
export default config;
`
}

function main() {
  const root = fileURLToPath(new URL('../', import.meta.url))
  const [upstreamArg, ...rest] = process.argv.slice(2)
  if (!upstreamArg || upstreamArg.startsWith('--'))
    throw new Error('Usage: brand-native-installer <prepared upstream checkout> --icon=<png>')
  const icon = rest.find((arg) => arg.startsWith('--icon='))?.slice('--icon='.length)
  if (!icon || !existsSync(icon)) throw new Error('--icon=<existing PNG> is required')
  const upstream = resolve(upstreamArg)
  const pin = JSON.parse(readFileSync(join(root, 'config/native-desktop.json'), 'utf8'))
  const git = (...args) =>
    execFileSync('git', args, { cwd: upstream, encoding: 'utf8', windowsHide: true }).trim()
  if (git('rev-parse', 'HEAD') !== pin.commit) throw new Error('Wrong upstream commit')
  if (git('status', '--porcelain')) throw new Error('Upstream sources must be clean')
  const app = join(upstream, 'apps/desktop'),
    px = join(app, '.desktop-build/px')
  for (const file of ['builder.mjs', 'overlay.json'])
    if (!existsSync(join(px, file))) throw new Error(`Run prepare-native-desktop first: missing ${file}`)
  assertDataPreserved({
    bootstrap: readFileSync(join(app, 'lib/px-bootstrap.cjs'), 'utf8'),
    uninstall: readFileSync(join(app, 'installer/uninstall.nsh'), 'utf8')
  })
  const brand = join(px, 'installer'),
    ui = join(brand, 'ui')
  mkdirSync(ui, { recursive: true })
  const strings = join(brand, 'strings.nsh')
  writeFileSync(strings, brandInstallerStrings(readFileSync(join(app, 'installer/strings.nsh'), 'utf8')))
  const wrapper = join(brand, 'installer.nsh')
  writeFileSync(
    wrapper,
    installerWrapper({
      stringsFile: strings,
      buildDirectory: ui,
      officialInstaller: join(app, 'scripts/installer.nsh')
    })
  )
  execFileSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      join(root, 'scripts/brand-installer-images.ps1'),
      '-Icon',
      resolve(icon),
      '-OutputDirectory',
      ui,
      '-Name',
      PX_INSTALLER_NAME
    ],
    { stdio: 'inherit', windowsHide: true }
  )
  for (const name of BRAND_BITMAPS)
    if (!existsSync(join(ui, `${name}.bmp`))) throw new Error(`Brand bitmap was not generated: ${name}`)
  writeFileSync(
    join(px, 'builder-branded.mjs'),
    brandedBuilderModule({
      builder: 'builder.mjs',
      officialUi: join(app, '.desktop-build/targets/win-x64/installer-ui'),
      pxUi: ui,
      wrapper
    })
  )
  console.log(`Branded installer config: ${join(px, 'builder-branded.mjs')}`)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
