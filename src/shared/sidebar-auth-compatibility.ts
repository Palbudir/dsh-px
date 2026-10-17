import { createHash } from 'node:crypto'

export const SIDEBAR_AUTH_SOURCE = {
  name: 'dsh-better-sidebar',
  version: '0.24.1',
  integrity:
    'sha512-X5tdu07Ub0isxruG559o46891F7MjxM+CzR6QoGpHZtN5J8gz6FA8Dq632lLI77c4IjL2GP+N6PuWaDnoKPuPQ==',
  sourceSha256: 'a39a18228c1ad1282040b80269358067a26bd61869902778eb2e71b85cfb45c7',
  patchedSha256: '119703786b9ef293e4a7363858051a3c770b825e9fa59ccf71406d8cbdba5463',
  patchId: 'px-sidebar-native-auth-write-v2'
} as const

/** Applied only to a private copied payload, never to an installed package or pnpm's shared store. */
export function patchSidebarAuthentication(source: string): { code: string; sha256: string } {
  if (createHash('sha256').update(source).digest('hex') !== SIDEBAR_AUTH_SOURCE.sourceSha256)
    throw new Error('侧栏来源与已核验版本不一致，拒绝应用认证补丁')
  const injection = 'const inject = [\n\t"webServer",'
  const fence = 'const fence = (req) => isTrustedApiRequest(req, ctx.webRuntime.trustedHosts);'
  if (source.split(injection).length !== 2 || source.split(fence).length !== 2)
    throw new Error('侧栏认证合约已变化，拒绝应用补丁')
  let code = source
    .replace(injection, 'const inject = [\n\t"connection",\n\t"webServer",')
    .replace(
      fence,
      'const fence = (req) => ctx.connection.requestRejection(req) === void 0 && isTrustedApiRequest(req, ctx.webRuntime.trustedHosts);'
    )
  const writeStart = '\t\t"fs.write": async (payload) => {'
  const writeEnd = '\n\t\t"fs.rename": async (payload) => {'
  const start = code.indexOf(writeStart),
    end = code.indexOf(writeEnd, start)
  if (start < 0 || end < 0 || code.split(writeStart).length !== 2) throw Error('侧栏文件保存合约已变化')
  code =
    code.slice(0, start) +
    `\t\t"fs.write": async (payload) => {
\t\t\tconst { cwd } = await cwdOf(payload);
\t\t\tconst path = await ensureWorkspaceWritePath(cwd, requireString(payload, "path"));
\t\t\tconst editor = ctx.get("pxFileEditing");
\t\t\tif (!editor) throw new SidebarError("fs-error", "安全保存服务尚未加载，请重试或使用外部编辑器。", 503);
\t\t\ttry { await editor.save(cwd, path, payload.content, payload.expectedContent, resolved.readLimit); }
\t\t\tcatch (error) { throw new SidebarError("fs-error", error instanceof Error ? error.message : String(error), error.status ?? 400); }
\t\t\tinvalidateDirectoryCache(dirname(path));
\t\t\treturn { ok: true };
\t\t},` +
    code.slice(end)
  const sha256 = createHash('sha256').update(code).digest('hex')
  if (sha256 !== SIDEBAR_AUTH_SOURCE.patchedSha256)
    throw new Error('侧栏认证补丁产物与已核验摘要不一致：' + sha256)
  return { code, sha256 }
}

export const SIDEBAR_CLIENT_SOURCE = {
  sourceSha256: '657812e84edd91684b8e85b728f119ce0b0e0f5318ad96714f9c528d1b75b41e',
  patchedSha256: 'ab77f8a3648cec6c0bc6da9de10c2253831a0bce49c37b38fa77da216a53f928',
  patchId: 'px-sidebar-native-client-v2'
} as const
/** Native shell owns transport/auth; HTML receives an absolute path before the upstream URL codec. */
export function patchSidebarClientTransport(source: string): { code: string; sha256: string } {
  if (createHash('sha256').update(source).digest('hex') !== SIDEBAR_CLIENT_SOURCE.sourceSha256)
    throw Error('侧栏客户端来源与固定版本不一致')
  let code = source
  for (const name of ['fs-watch', 'agent-opens']) {
    const before = `new URL("/sidebar/ws/${name}", location.origin)`
    if (code.split(before).length !== 2) throw Error('侧栏连接合约已变化')
    code = code.replace(
      before,
      `new URL("/sidebar/ws/${name}", globalThis.__DSH_TRANSPORT__?.streamBaseUrl ?? location.origin)`
    )
  }
  code = patchSidebarHtmlViewer(code)
  const sha256 = createHash('sha256').update(code).digest('hex')
  if (sha256 !== SIDEBAR_CLIENT_SOURCE.patchedSha256) throw Error('侧栏客户端补丁摘要不一致')
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
  sourceSha256: '39537bd5d6124075d549e26995ea15542590cf1820ddad28932735153ebe2407',
  patchedSha256: '02616e272ad0679014de49fb769ba3261d2033d9bc54d39246c210b1089ff425',
  patchId: 'px-sidebar-native-html-v1'
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
      'html && mode === "preview" && (ctx.get("pxHtmlPreview") ? (0, react.createElement)(ctx.get("pxHtmlPreview").component, {scope, path, content: draft ?? content, dirty, truncated, className: sidebar_module_css_default.editorHtml}) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: ['
    )
    .replace(end, '})] })),\n\t\t\tselectionPopup.popup !== null')
  code = patchSidebarEditorSave(code)
  code = patchSidebarMarkdownNavigation(code)
  const sha256 = createHash('sha256').update(code).digest('hex')
  if (sha256 !== SIDEBAR_EDITOR_SOURCE.patchedSha256) throw Error('侧栏 HTML 补丁产物摘要不一致：' + sha256)
  return { code, sha256 }
}

/** The native renderer already understands local links and images when its owner supplies a delegate. */
export function patchSidebarMarkdownNavigation(source: string): string {
  const start = 'markdown && mode === "preview" && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {'
  const end = '\n\t\t\t}),\n\t\t\thtml && mode === "preview" &&'
  for (const anchor of [start, end])
    if (source.split(anchor).length !== 2) throw Error('侧栏 Markdown 导航合约已变化')
  return source
    .replace(
      start,
      'markdown && mode === "preview" && (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.MarkdownDelegateProvider, {openFile: ctx.get("pxFilePreviewLinks") ? (target) => { const slash = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\\\")); const absolute = normalizeLocalPath(isAbsolutePath(target) ? target : path.slice(0, slash + 1) + target); ctx.get("pxFilePreviewLinks").open(scope, absolute); } : undefined, fileImages: {resolve: (target) => resolveLocalMediaDest(target, scope, path, window.location.origin), labels: {dialog: "图片预览", close: "关闭", open: "打开图片", loading: "正在加载图片", failed: "无法加载图片"}}}, /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {'
    )
    .replace(end, '\n\t\t\t})),\n\t\t\thtml && mode === "preview" &&')
}

export function patchSidebarEditorSave(source: string): string {
  const replacements: Array<[string, string]> = [
    [
      'fsWrite: (scope, path, content) => call$1("fs.write", scopePayload(scope, {\n\t\t\tpath,\n\t\t\tcontent\n\t\t})),',
      'fsWrite: (scope, path, content, expectedContent) => call$1("fs.write", scopePayload(scope, {path, content, expectedContent})),'
    ],
    [
      'const [saveState, setSaveState] = (0, react.useState)("idle");',
      'const [saveState, setSaveState] = (0, react.useState)("idle");\n\t\tconst [saveError, setSaveError] = (0, react.useState)("");\n\t\tconst baselineRef = (0, react.useRef)(content);\n\t\t(0, react.useEffect)(() => { if (draft === null) { baselineRef.current = content; setSaveError(""); } }, [content, path, scope.sessionId]);'
    ],
    [
      'if (view === null || savingRef.current) return;\n\t\t\tsavingRef.current = true;',
      'if (view === null || savingRef.current) return;\n\t\t\tif (truncated) { setSaveError("文件未完整读取，未保存，避免覆盖未显示的部分。"); setSaveState("failed"); return; }\n\t\t\tsavingRef.current = true;\n\t\t\tsetSaveError("");'
    ],
    [
      'api.fsWrite(scope, path, view.state.doc.toString()).then(() => {\n\t\t\t\tsavingRef.current = false;\n\t\t\t\tsetDraft(null);\n\t\t\t\tsetDirty(false);\n\t\t\t\tsetSaveState("saved");\n\t\t\t}).catch(() => {\n\t\t\t\tsavingRef.current = false;\n\t\t\t\tsetSaveState("failed");\n\t\t\t});',
      'const savedText = view.state.doc.toString();\n\t\t\tapi.fsWrite(scope, path, savedText, baselineRef.current).then(() => {\n\t\t\t\tsavingRef.current = false; baselineRef.current = savedText;\n\t\t\t\tconst current = viewRef.current?.state.doc.toString() ?? savedText;\n\t\t\t\tsetDraft(current === savedText ? null : current); setDirty(current !== savedText); setSaveState(current === savedText ? "saved" : "idle");\n\t\t\t}).catch((error) => {\n\t\t\t\tsavingRef.current = false; setSaveError(error instanceof Error ? error.message : String(error)); setSaveState("failed");\n\t\t\t});'
    ],
    [
      '!hostToolbar && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {\n\t\t\t\tclassName: sidebar_module_css_default.editorHeader,',
      'saveError && (0, react_jsx_runtime.jsx)("p", {role: "alert", style: {padding: "8px", color: "var(--dsw-alias-label-secondary)"}, children: saveError}),\n\t\t\t!hostToolbar && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {\n\t\t\t\tclassName: sidebar_module_css_default.editorHeader,'
    ]
  ]
  let code = source
  for (const [before, after] of replacements) {
    if (code.split(before).length !== 2) throw Error('侧栏编辑保存合约已变化')
    code = code.replace(before, after)
  }
  return code
}
