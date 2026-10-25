import { createHash } from 'node:crypto'

export const SIDEBAR_AUTH_SOURCE = {
  name: 'dsh-better-sidebar',
  version: '0.28.0',
  integrity:
    'sha512-x7+/YmH/HrSlXWOBZkhL7qQqcDgZEnDcWrhR5GlizzUZjz+w84FbQ6jo8trJC9tyaQxMaNvXVnXwDxn4I330Ew==',
  sourceSha256: '00080091516184efe0005d8521cb890ae89032b9abcd514b752c4ef7642fa129',
  patchedSha256: '00080091516184efe0005d8521cb890ae89032b9abcd514b752c4ef7642fa129',
  patchId: 'upstream-native-auth-v1'
} as const

/** Applied only to a private copied payload, never to an installed package or pnpm's shared store. */
export function patchSidebarAuthentication(source: string): { code: string; sha256: string } {
  if (createHash('sha256').update(source).digest('hex') !== SIDEBAR_AUTH_SOURCE.sourceSha256)
    throw new Error('侧栏来源与已核验版本不一致，拒绝应用认证补丁')
  const fence = 'const fence = (req) => ctx.connection.requestRejection(req) === void 0;'
  if (source.split(fence).length !== 2) throw new Error('侧栏认证合约已变化，拒绝应用补丁')
  // Upstream now owns authentication and revision-aware, encoding-preserving writes.
  return { code: source, sha256: SIDEBAR_AUTH_SOURCE.sourceSha256 }
}

export const SIDEBAR_CLIENT_SOURCE = {
  sourceSha256: '53b70b1b5317205247c074b8121e1ececec1df2dc3771b0641f0a66b8fd127e1',
  patchedSha256: '9c7e709f4e7c69c7afeb95933977abec2281862a35300d38f86b1c446dbe6a31',
  patchId: 'px-sidebar-native-client-v3'
} as const
/** Native shell owns transport/auth; HTML receives an absolute path before the upstream URL codec. */
export function patchSidebarClientTransport(source: string): { code: string; sha256: string } {
  if (createHash('sha256').update(source).digest('hex') !== SIDEBAR_CLIENT_SOURCE.sourceSha256)
    throw Error('侧栏客户端来源与固定版本不一致')
  if (!source.includes('globalThis.__DSH_TRANSPORT__?.streamBaseUrl')) throw Error('侧栏原生连接合约已变化')
  const code = patchSidebarHtmlViewer(source)
  const sha256 = createHash('sha256').update(code).digest('hex')
  if (sha256 !== SIDEBAR_CLIENT_SOURCE.patchedSha256) throw Error('侧栏客户端补丁摘要不一致：' + sha256)
  return { code, sha256 }
}

/** Reuse the sidebar's path resolver; do not change file contents, native addresses or sandbox policy. */
export function patchSidebarHtmlViewer(source: string): string {
  const ready = '!showEmpty && load.status === "ready" && (0, react.createElement)(load.viewer.component, {'
  const loading = '!showEmpty && load.status === "loading" &&'
  const path =
    '\t\t\t\t\t\t\t\tscope,\n\t\t\t\t\t\t\t\tpath,\n\t\t\t\t\t\t\t\ttitle,\n\t\t\t\t\t\t\t\tviewerId: load.viewer.id,'
  for (const match of [ready, loading, path])
    if (source.split(match).length !== 2) throw Error('侧栏 HTML 查看器合约已变化')
  const waiting =
    '(load.status === "ready" && ["html", "markdown"].includes(load.viewer.id) && !isAbsolutePath$1(path) && !scope.cwd)'
  const unsafeSettings =
    /\s*settings: \{ toggles: \[\{\s*key: "htmlViewerNoSandbox",[\s\S]*?key: "htmlViewerDefaultUnsafe",[\s\S]*?\}\] \},/u
  if (!unsafeSettings.test(source)) throw Error('侧栏 HTML 设置合约已变化')
  return source
    .replace(unsafeSettings, '')
    .replace(loading, `!showEmpty && (load.status === "loading" || ${waiting}) &&`)
    .replace(
      ready,
      `!showEmpty && load.status === "ready" && !${waiting} && (0, react.createElement)(load.viewer.component, {`
    )
    .replace(
      path,
      path.replace(
        '\n\t\t\t\t\t\t\t\tpath,',
        '\n\t\t\t\t\t\t\t\tpath: ["html", "markdown"].includes(load.viewer.id) ? resolveSidebarPath(scope.cwd, path) : path,'
      )
    )
}

export const SIDEBAR_EDITOR_SOURCE = {
  sourceSha256: 'e899df938ceb8ea29ff2319e15a89e76155775ba07c8cf65a970a1c8596b69fd',
  patchedSha256: '0ed015f181f1c9ab628b32bc7709cfa2ef092394b54a38dd5819362290490ff2',
  patchId: 'px-sidebar-native-html-v2'
} as const
/** Retain the upstream editor/draft/save controls; delegate preview bytes to the PX native-file renderer. */
export function patchSidebarHtmlRenderer(source: string): { code: string; sha256: string } {
  if (createHash('sha256').update(source).digest('hex') !== SIDEBAR_EDITOR_SOURCE.sourceSha256)
    throw Error('侧栏编辑器来源与固定版本不一致')
  const start =
    'html && mode === "preview" && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: ['
  const end = '})] }),\n\t\t\tselectionPopup.popup !== null'
  for (const text of [start, end])
    if (source.split(text).length !== 2) throw Error('侧栏 HTML 渲染合约已变化')
  let code = source
    .replace(
      start,
      'html && mode === "preview" && (ctx.get("pxHtmlPreview") ? (0, react.createElement)(ctx.get("pxHtmlPreview").component, {scope, path, content: draft ?? content, dirty, truncated: readOnly, className: sidebar_module_css_default.editorHtml}) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: ['
    )
    .replace(end, '})] })),\n\t\t\tselectionPopup.popup !== null')
  code = patchSidebarEditorSave(code)
  // Upstream now supplies the Markdown navigation/media delegate.
  const sha256 = createHash('sha256').update(code).digest('hex')
  if (sha256 !== SIDEBAR_EDITOR_SOURCE.patchedSha256) throw Error('侧栏 HTML 补丁产物摘要不一致：' + sha256)
  return { code, sha256 }
}

/** Preserve changes typed during an in-flight native save; the native write owns format and revision checks. */
export function patchSidebarEditorSave(source: string): string {
  const begin =
    'api.fsWrite(scope, path, view.state.doc.toString(), mtimeRef.current ?? null).then((result) => {'
  const settled =
    '\t\t\t\tsetDraft(null);\n\t\t\t\tsetDirty(false);\n\t\t\t\tsetConflict(false);\n\t\t\t\tsetSaveState("saved");'
  for (const anchor of [begin, settled])
    if (source.split(anchor).length !== 2) throw Error('侧栏编辑保存合约已变化')
  return source
    .replace(
      begin,
      'const savedText = view.state.doc.toString();\n\t\t\tapi.fsWrite(scope, path, savedText, mtimeRef.current ?? null).then((result) => {'
    )
    .replace(
      settled,
      '\t\t\t\tconst live = viewRef.current?.state.doc.toString() ?? savedText;\n\t\t\t\tconst changed = !sameDocument(live, savedText);\n\t\t\t\tsetDraft(changed ? live : null); setDirty(changed); setConflict(false); setSaveState(changed ? "idle" : "saved");'
    )
}
