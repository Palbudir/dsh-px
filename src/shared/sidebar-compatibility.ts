import { createHash, randomUUID } from 'node:crypto'
import {
  closeSync,
  fsyncSync,
  lstatSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync
} from 'node:fs'
import { join, parse, resolve, sep } from 'node:path'
import { SIDEBAR_TERMINAL_PATCH_ID } from '../../packages/shared/sidebar-terminal-contract'

export const SIDEBAR_SOURCE = {
  name: 'dsh-better-sidebar',
  version: '0.19.1',
  tarball: 'https://registry.npmjs.org/dsh-better-sidebar/-/dsh-better-sidebar-0.19.1.tgz',
  integrity:
    'sha512-Jr0tPJoDKUVkq+fioL6Td+YwXZ+PULx3CnBJ4iktaQGNP5y9hgpz6V7o7f4Yh2czheVKZsewurqCaiN10GQYeQ==',
  sourceSha256: '14d7d0f55167d9571bd0bc4a46909ac20650ca4e4b4733547c2e8f1ab50e36a3',
  patchedSha256: '2c0ca7f1315302f9a2d0d19a02e46dd1af8ff5e7ae739c98547d0298d9623b40',
  patchId: SIDEBAR_TERMINAL_PATCH_ID
} as const

/** Kept as JavaScript so the shipped patch is identical in every compiler/build mode. */
export const SIDEBAR_TERMINAL_ADAPTER_SOURCE = String.raw`
// DSH-PX compatibility: dsh-better-sidebar 0.19.1, MIT. See docs/PLUGINS.md.
function dshPxTrackTerminals(nodePty) {
  const live = new Set();
  const waiters = new Set();
  let closing = false;
  const reconcile = () => {
    for (const record of live) {
      record.pidUnknown = false;
      if (!Number.isSafeInteger(record.pid) || record.pid <= 0) {
        record.pidUnknown = true;
        continue;
      }
      try { process.kill(record.pid, 0); }
      catch (error) {
        if (error && error.code === "ESRCH") live.delete(record);
        else record.pidUnknown = true;
      }
    }
    if (!live.size) for (const done of [...waiters]) done();
  };
  const snapshot = () => {
    reconcile();
    return { known: ![...live].some(record => record.pidUnknown || record.channelClosed), openTerminals: live.size, closing };
  };
  const adapter = nodePty === null ? null : {
    ...nodePty,
    spawn(...args) {
      if (closing) throw new Error("Terminal service is stopping");
      const pty = nodePty.spawn(...args);
      const record = { pid: pty.pid, channelClosed: false, pidUnknown: false };
      live.add(record);
      try {
        pty.onExit(() => {
          // On Windows node-pty also emits exit when its pipe closes, while the
          // process may still be alive. Only confirmed OS process death drains it.
          record.channelClosed = true;
          reconcile();
        });
      } catch (error) {
        record.channelClosed = true;
        try { pty.kill(); } catch {}
        throw error;
      }
      return pty;
    }
  };
  return {
    adapter,
    snapshot,
    beginClose() { closing = true; },
    waitUntilClosed() {
      reconcile();
      if (!live.size) return Promise.resolve();
      return new Promise((resolve) => {
        // Keep the process alive until node-pty actually emits exit. The desktop
        // watchdog offers explicit recovery on failure; never claim a timeout drained.
        const keepAlive = setInterval(reconcile, 100);
        const done = () => {
          clearInterval(keepAlive);
          waiters.delete(done);
          resolve();
        };
        waiters.add(done);
      });
    }
  };
}
`

const sha256 = (data: string | Buffer): string => createHash('sha256').update(data).digest('hex')
function replaceOnce(source: string, from: string, to: string): string {
  if (source.split(from).length !== 2) throw new Error('侧栏兼容补丁的固定来源不匹配')
  return source.replace(from, to)
}
/** Transform only the exact published entry; no fuzzy patching of user modifications. */
export function patchSidebarSource(source: string): string {
  if (sha256(source) !== SIDEBAR_SOURCE.sourceSha256) throw new Error('侧栏宿主文件不是受支持的原始来源')
  let output = replaceOnce(
    source,
    'function apply(ctx, config) {',
    SIDEBAR_TERMINAL_ADAPTER_SOURCE + '\nfunction apply(ctx, config) {'
  )
  output = replaceOnce(
    output,
    '\tconst nodePty = loadNodePty();',
    '\tconst dshPxTerminals = dshPxTrackTerminals(loadNodePty());\n\tconst nodePty = dshPxTerminals.adapter;\n\tctx.provide("dshPxSidebarTerminals", { version: 1, patchId: ' +
      JSON.stringify(SIDEBAR_TERMINAL_PATCH_ID) +
      ', snapshot: dshPxTerminals.snapshot });'
  )
  output = replaceOnce(
    output,
    '\tctx.effect(() => () => {\n\t\ttoolsDisposers?.();',
    '\tctx.effect(() => async () => {\n\t\tdshPxTerminals.beginClose();\n\t\ttoolsDisposers?.();'
  )
  output = replaceOnce(
    output,
    '\t\tagentOpenWss.close();\n\t}, "dsh-better-sidebar: teardown");',
    '\t\tagentOpenWss.close();\n\t\tawait dshPxTerminals.waitUntilClosed();\n\t}, "dsh-better-sidebar: teardown");'
  )
  return output
}

export interface SidebarCompatibility {
  state: 'original-known' | 'patched-known' | 'unknown'
  name: typeof SIDEBAR_SOURCE.name
  version: string | null
  sha256: string | null
  patchId: string
  sourceSha256: string
  patchedSha256: string
  reason?: string
}

/** Reparse points must never turn a private staging update into an external package edit. */
function noLinks(path: string): void {
  const absolute = resolve(path),
    root = parse(absolute).root
  let current = root
  for (const part of absolute.slice(root.length).split(sep).filter(Boolean)) {
    current = join(current, part)
    if (lstatSync(current).isSymbolicLink()) throw new Error('外部或链接路径保持原样')
  }
}

export function inspectSidebarCompatibility(profilePath: string): SidebarCompatibility {
  const result: SidebarCompatibility = {
    state: 'unknown',
    name: SIDEBAR_SOURCE.name,
    version: null,
    sha256: null,
    patchId: SIDEBAR_SOURCE.patchId,
    sourceSha256: SIDEBAR_SOURCE.sourceSha256,
    patchedSha256: SIDEBAR_SOURCE.patchedSha256
  }
  try {
    const directory = join(profilePath, 'node_modules', SIDEBAR_SOURCE.name),
      manifest = join(directory, 'package.json'),
      host = join(directory, 'lib/index.js')
    noLinks(manifest)
    noLinks(host)
    if (
      !lstatSync(manifest).isFile() ||
      lstatSync(manifest).size > 1048576 ||
      !lstatSync(host).isFile() ||
      lstatSync(host).size > 4194304
    )
      throw new Error('包入口格式无效')
    const pkg = JSON.parse(readFileSync(manifest, 'utf8'))
    result.version = typeof pkg.version === 'string' ? pkg.version : null
    result.sha256 = sha256(readFileSync(host))
    if (pkg.name === SIDEBAR_SOURCE.name && result.version === SIDEBAR_SOURCE.version) {
      if (result.sha256 === SIDEBAR_SOURCE.sourceSha256) result.state = 'original-known'
      if (result.sha256 === SIDEBAR_SOURCE.patchedSha256) result.state = 'patched-known'
    }
    if (result.state === 'unknown') result.reason = '版本或文件已变更，保留当前插件；终端活动需要兼容服务。'
  } catch {
    result.reason = '插件不存在、不可读或通过链接安装，保持原样。'
  }
  return result
}

/** Use only on a seed or a private profile staging tree under the caller's migration lease. */
export function applySidebarCompatibility(profilePath: string): SidebarCompatibility {
  const before = inspectSidebarCompatibility(profilePath)
  if (before.state !== 'original-known') return before
  const host = join(profilePath, 'node_modules', SIDEBAR_SOURCE.name, 'lib/index.js')
  const patched = patchSidebarSource(readFileSync(host, 'utf8'))
  if (sha256(patched) !== SIDEBAR_SOURCE.patchedSha256) throw new Error('侧栏补丁实现与发布摘要不一致')
  const temporary = `${host}.${randomUUID()}.tmp`
  let fd: number | undefined
  try {
    fd = openSync(temporary, 'wx')
    writeFileSync(fd, patched)
    fsyncSync(fd)
    closeSync(fd)
    fd = undefined
    noLinks(host)
    if (sha256(readFileSync(host)) !== before.sha256) throw new Error('侧栏文件已被其它操作改变，未替换')
    renameSync(temporary, host)
  } finally {
    if (fd !== undefined) closeSync(fd)
    try {
      unlinkSync(temporary)
    } catch {
      /* atomic rename already consumed it */
    }
  }
  const after = inspectSidebarCompatibility(profilePath)
  if (after.state !== 'patched-known') throw new Error('侧栏补丁写入后校验失败')
  return after
}
