/**
 * 客户端半边用到的宿主模块类型声明。
 *
 * 为什么需要这个文件：客户端插件运行在 **dsh 前端**里，它 `require` 的
 * `react` / `@deepseek-ai/dsh-client-ui-slots` 等由前端的**静态模块表**提供
 * （实测见 `dsh-web-frontend/dist/assets/index-*.js` 里的 `staticModules`：
 * react、react/jsx-runtime、react-dom、dsh-client-ui-slots、
 * dsh-client-ui-primitives、dsh-client-store、cordis）。
 *
 * 但这些包**不在本仓库可解析的位置**（它们在 dsh 安装的 pnpm 隔离目录里，
 * 仓库根拿不到），所以 TypeScript 需要一个最小声明面。这里刻意只声明
 * 我们真正用到的那几个成员，而不是抄一份完整 API —— 声明面越小，
 * 与宿主不匹配的风险越小。
 *
 * 类型只用于**编辑/类型检查**；产物由 esbuild 把 `react` / `react/jsx-runtime`
 * 留成外部 `require(...)`，运行期交给宿主解析。
 */

declare module 'react' {
  /** 函数组件的返回值（宿主自带 React，这里不细分元素类型）。 */
  export type ReactNode = unknown
  export interface ReactElement {
    readonly __reactElementBrand?: never
  }
  export function useState<T> (initial: T | (() => T)): [T, (next: T | ((prev: T) => T)) => void]
  export function useRef<T> (initial: T): { current: T }
  export function useEffect (effect: () => void | (() => void), deps?: readonly unknown[]): void
  export function useCallback<T extends (...args: never[]) => unknown> (fn: T, deps: readonly unknown[]): T
  export function useMemo<T> (factory: () => T, deps: readonly unknown[]): T
  const React: {
    createElement: (type: unknown, props?: unknown, ...children: unknown[]) => ReactElement
  }
  export default React
}

declare module 'react/jsx-runtime' {
  /** automatic JSX 运行时：tsc 会把 `<div/>` 编译成 jsx(...) / jsxs(...)。 */
  export function jsx (type: unknown, props: unknown, key?: unknown): unknown
  export function jsxs (type: unknown, props: unknown, key?: unknown): unknown
  export const Fragment: unknown
}

/**
 * 最小 JSX 命名空间。
 *
 * 客户端插件的可达包面里没有 `@types/react`（前端类型不在本仓库可解析的位置），
 * 因此必须自己声明 `JSX.IntrinsicElements`，否则每个标签都报 TS7026。
 * 用宽松类型是有意的：我们依赖的是**宿主**的 React 与 DOM 属性，
 * 在这里复刻一遍既不可能也不必要 —— 宿主版本一变就会失配。
 */
declare namespace JSX {
  interface IntrinsicAttributes { key?: string | number }
  /** 任意标签、任意属性都接受（见上面的说明）。 */
  interface IntrinsicElements {
    [tag: string]: Record<string, unknown>
  }
  type Element = unknown
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  /** 一个插槽注册项可以提供的注入面（本站点只用 slots/locale）。 */
  export interface SlotInject {
    /** 翻译函数；namespace 由注册时的 `locale` 决定。 */
    t?: (key: string, params?: Record<string, unknown>) => string
    /** 其它宿主注入的服务（本站点未使用）。 */
    [key: string]: unknown
  }

  /** 注册项：列表插槽用 `id`/`order`/`label`，并可声明子插槽。 */
  export interface SlotRegistration {
    name: string
    id?: string
    order?: number
    label?: string | (() => string)
    locale?: string
    inject?: (() => SlotInject) | SlotInject
    children?: Record<string, { kind: 'list' | 'single', scope?: 'root' }>
  }

  /** 渲染函数收到的 props：本站点只依赖宿主注入面。 */
  export type SlotComponentProps = SlotInject

  export interface SlotsService {
    /**
     * 等目标插槽被声明后再注册 —— 与官方插件一致。
     * 注意：**必须**用它而不是 `get()`，否则插槽尚未声明时会静默拿不到。
     */
    inject (name: string, register: () => unknown): unknown
    register (registration: SlotRegistration, component: (props: SlotComponentProps) => unknown): unknown
  }
}

declare module '@deepseek-ai/dsh-client-locale' {
  export interface LocaleRuntime {
    register (ns: string, locale: string, dict: Record<string, string>): () => void
    bind (ns: string): (key: string, params?: Record<string, unknown>) => string
  }
}

declare module '@deepseek-ai/cordis' {
  /** 客户端 cordis 上下文：只声明本站点用到的成员。 */
  export interface ClientContext {
    slots: import('@deepseek-ai/dsh-client-ui-slots').SlotsService
    locale: import('@deepseek-ai/dsh-client-locale').LocaleRuntime
    effect?: (fn: () => (() => void) | void, label?: string) => void
    logger?: { info?: (...args: unknown[]) => void, warn?: (...args: unknown[]) => void }
  }

  // ── 宿主半边（src/index.ts）用到的成员 ─────────────────────────────────────

  /** HTTP 响应（只用得到这几个成员）。 */
  export interface HostResponse {
    writeHead (status: number, headers: Record<string, string>): void
    end (body?: string): void
  }

  /** HTTP 请求（本站点用到 method 与 url）。 */
  export interface HostRequest {
    method?: string
    headers?: Record<string, string | string[] | undefined>
    /**
     * 请求 URL（含查询串）。
     *
     * 用它而不是读 body：宿主给的 req 不保证带 body 读取能力，
     * 而我们的端点参数只有一个白名单枚举值，放查询串里最简单也最稳。
     */
    url?: string
  }

  /** 一个已注册路由的清理函数。 */
  export type RouteDisposer = () => void

  /** webServer 服务。 */
  export interface WebServer {
    register (route: {
      kind: 'exact' | 'prefix'
      path: string
      handler: (req: HostRequest, res: HostResponse) => void | Promise<void>
    }): RouteDisposer
  }

  /** 工具注册表服务。 */
  export interface ToolRegistry {
    register (tool: {
      name: string
      description: string
      parameters: Record<string, unknown>
      output: { schema: Record<string, unknown>, render: (args: unknown, value: string) => unknown[] }
      execute: (args: { checkRemote?: boolean } | undefined) => Promise<string>
    }): unknown
  }

  /**
   * 宿主侧插件上下文。只为本站点用到的成员声明类型。
   *
   * 注意 `inject` 的回调会拿到**带服务的窄化上下文** —— 这正是本插件的关键用法：
   * apply 期间 webServer 可能尚未提供，`ctx.get()` 会静默拿到 undefined，
   * 而 `ctx.inject([...])` 会等到服务就绪后再回调。
   */
  export interface HostPluginContext {
    logger?: { info?: (...args: unknown[]) => void, debug?: (...args: unknown[]) => void }
    inject (services: readonly string[], callback: (ctx: HostPluginContext & {
      webServer?: WebServer
      tools?: ToolRegistry
    }) => void): unknown
    effect?: (fn: () => (() => void) | void, label?: string) => void
  }
}
