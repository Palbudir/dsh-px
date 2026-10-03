import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildSync } from 'esbuild'
import { runInNewContext } from 'node:vm'

test('managed client entries activate without the native sidebar and register panels when it appears', () => {
  const styles: any[] = []
  const document = {
    querySelector: (selector: string) =>
      styles.find((style) => selector === `style[data-dsh-px-style="${style.dataset.dshPxStyle}"]`),
    createElement: () => {
      const style: any = {
        dataset: {},
        setAttribute: () => {},
        remove: () => {
          const index = styles.indexOf(style)
          if (index >= 0) styles.splice(index, 1)
        }
      }
      return style
    },
    head: { appendChild: (style: unknown) => styles.push(style) }
  }
  const React = {
    useState: () => {
      throw new Error('entry registration must not render components')
    }
  }
  const jsx = (type: unknown, props: unknown): unknown => ({ type, props })
  for (const name of [
    'dsh-px-workspace',
    'dsh-px-taskflow',
    'dsh-px-artifacts',
    'dsh-px-annotations',
    'dsh-px-schedules'
  ]) {
    const source = buildSync({
      entryPoints: [`packages/${name}/src/client.tsx`],
      bundle: true,
      write: false,
      platform: 'browser',
      format: 'cjs',
      jsx: 'automatic',
      external: ['react', 'react/jsx-runtime'],
      logLevel: 'silent'
    }).outputFiles![0].text
    const module: { exports: any } = { exports: {} }
    runInNewContext(source, {
      module,
      exports: module.exports,
      require: (specifier: string) => (specifier === 'react' ? React : { jsx, jsxs: jsx }),
      document
    })
    const registered: string[] = [],
      cleanups: Array<() => void> = []
    const pending: Array<{ services: string[]; callback: (host: any) => void }> = []
    const core: any = {
      // Boundary: this stand-in calls the inject callback inline and drops its return value. The
      // pinned slot service wraps the callback in `ctx.effect(callback)`, and `SlotRegistry.register`
      // runs `this.ctx.effect(…)` on the CALLER's fiber. Do not reason about contribution ownership
      // or release from this mock — assert only which entries get registered.
      slots: {
        inject: (_: string, callback: () => void) => callback(),
        register: (entry: any) => {
          registered.push(entry.id)
          return () => {}
        }
      },
      layout: {},
      sessions: {},
      uiWorkspace: {},
      conversation: {},
      effect: (effect: () => () => void) => {
        cleanups.push(effect())
      },
      inject: (services: string[], callback: (host: any) => void) => {
        pending.push({ services, callback })
      }
    }
    assert.ok(
      module.exports.inject.every((service: string) => core[service]),
      `${name} must not remain a pending native boot entry when sidebar is disabled`
    )
    assert.doesNotThrow(() => module.exports.apply(core))
    if (name === 'dsh-px-workspace')
      assert.ok(registered.includes('dsh-px-workspace'), 'feature toolbar stays registered')
    const panels: string[] = []
    const host = {
      ...core,
      sidebarRight: {},
      sidebarRightTabs: {
        entries: () => [],
        register: (tab: { id: string }) => {
          panels.push(tab.id)
          return () => {
            panels.splice(panels.indexOf(tab.id), 1)
          }
        }
      }
    }
    for (const injection of pending.filter(
      (entry) => entry.services.includes('sidebarRightTabs') && entry.services.includes('sidebarRight')
    ))
      injection.callback(host)
    const expected: Record<string, string> = {
      'dsh-px-taskflow': 'dsh-px-taskflow',
      'dsh-px-artifacts': 'px-artifacts',
      'dsh-px-annotations': 'px-notes',
      'dsh-px-schedules': 'px-schedules'
    }
    if (name === 'dsh-px-workspace')
      assert.deepEqual(panels, [], 'foundation does not register optional feature panels')
    else assert.ok(panels.includes(expected[name]))
    cleanups.reverse().forEach((dispose) => dispose())
    assert.equal(panels.length, 0)
  }
})
