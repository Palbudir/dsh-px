# Packaging notes — assembling the dsh-px runtime

These are the non-obvious constraints discovered while building `scripts/stage-runtime.mjs`.
They are recorded because every one of them was learned by hitting it.

## What gets bundled

`runtime/` has three parts:

| Part | Source | Why |
|---|---|---|
| `runtime/node/` | standalone Node build from `nodejs.org/dist` | The user installs nothing. Pinned by `DSH_PX_NODE_VERSION`. |
| `runtime/dsh/` | the official `@deepseek-ai/dsh` install | The harness itself. Pinned by `DSH_PX_DSH_VERSION`. |
| `runtime/dsh-home/` | a seed Harness home: `profiles/<name>/` + plugin tree | So the app starts with a working, plugin-complete profile. |

## Constraint 1 — the dsh install is already self-contained

A global dsh install carries **239 nested `@deepseek-ai/*` packages** inside its
own `node_modules` (~213 MB on this machine). It does **not** rely on a hoisted
sibling tree to resolve its bundle layers.

Consequence: copying the dsh install directory whole is sufficient for bundle
resolution. There is no need to reconstruct a `@deepseek-ai` fallback tree.

```js
// stage-runtime.mjs
const src = join(execFileSync('npm', ['root', '-g']).trim(), '@deepseek-ai', 'dsh')
cpSync(src, dest, { recursive: true, dereference: true })
```

## Constraint 2 — dsh's `@deepseek-ai` fallback tree must NOT be materialised

`$DSH_HOME/profiles/node_modules/@deepseek-ai/*` are **Windows junctions**
pointing back into the global dsh install. Two opposite mistakes are possible
here, and both were made while building this:

**(a) A plain copy loses them.** Without `dereference: true` the junctions come
across as dead links, and the bundle silently depends on this machine's global
dsh.

**(b) Dereferencing them breaks the boot.** With `dereference: true` the
junctions become real directories, and dsh then refuses to start:

```
Error: dsh: <home>/profiles/node_modules/@deepseek-ai/dsh exists and is not a
symlink or dsh-managed module proxy; remove it so dsh can manage the
installation fallback
```

That tree is not ours to copy. It is **dsh's own managed module-proxy fallback**,
and dsh asserts ownership of its shape at boot. It is also **redundant**: the
bundled `runtime/dsh` already carries all 239 nested `@deepseek-ai` packages, and
bundle names resolve against the dsh installation first.

The resolution is selective copying. `profiles/node_modules` contains two very
different things, and they need opposite treatment:

| Contents | Treatment | Why |
|---|---|---|
| `node_modules/@deepseek-ai/**` (246 MB) | **exclude** | dsh-managed proxy; redundant with `runtime/dsh`; breaks boot if materialised |
| `node_modules/<everything else>` (react, mermaid, `@codemirror`, `node-pty`, …) | **copy, dereferenced** | third-party plugin dependencies; exist nowhere else in the bundle |

```js
const SKIP_IN_PROFILE_TREE = new Set(['@deepseek-ai'])
copyTree(srcWebModules, join(profileDir, 'node_modules'), { skip: SKIP_IN_PROFILE_TREE })
```

`cpSync` has no exclude option, hence the small `copyTree` helper in
`stage-runtime.mjs`. Pruning that one directory also removes ~246 MB — it is the
single largest size win available.

If you ever see the "not a symlink or dsh-managed module proxy" error from a
staged build, this constraint has been violated again.

## Constraint 3 — `profiles/node_modules` is a *junction* tree

The remaining entries under `profiles/node_modules` (and the plugin tree under
`profiles/<profile>/node_modules`) are junctions too, so `dereference: true` is
still required for the parts being copied:

```js
cpSync(from, to, { dereference: true, force: true })
```

There are two staging paths:

- `--from-existing` — copy the profile this machine already runs. Fast, offline,
  and it reproduces a configuration you have personally verified.
- `--with-plugins` — build the profile from scratch with the staged dsh itself
  (`dsh plugin --profile <name> add ...`). Slower, needs network, but fully
  reproducible in CI from a clean checkout.

Re-doing the install through `dsh plugin add` rather than hand-copying is not
optional on that path: `dsh plugin` is what reconciles `dsh.profile.bundles`.
Hand-editing that list is how you get a bundle installed but never mounted.

## Constraint 4 — pnpm ≥ 10 blocks dependency build scripts

Installing `dsh-better-sidebar` prints:

```
Ignored build scripts: node-pty@1.1.0.
```

`node-pty` needs its postinstall to place `conpty.dll` and `OpenConsole.exe`.
Skipped, the sidebar's terminal fails **at runtime**, long after a green install.

The profile's `pnpm-workspace.yaml` must therefore carry:

```yaml
allowBuilds:
  node-pty: true
```

then approve:

```sh
pnpm approve-builds --all
```

The exact key matters. `onlyBuiltDependencies` is the older spelling; pnpm
10.34 accepts `allowBuilds`, which is what `pnpm approve-builds` writes. Verify
with `pnpm approve-builds --help` rather than trusting a blog post.

## Constraint 5 — bundle membership changes need a restart

A profile with `patchReload: live` hot-applies edits to `cordis.patch.yml`. It
does **not** hot-apply **bundle membership** changes.

Measured behaviour on this machine: after `dsh plugin add`, `--dump-config`
immediately showed the four new layers, but the *running* host still answered
`404` on those plugins' routes until restarted.

Consequence for the desktop app: installing a plugin from the market can leave
it visible-but-inert until the harness process is restarted. The shell must be
able to restart the harness on request, and the UI should say so.

## Constraint 6 — Electron's Node is not the harness's Node

The harness runs in a **spawned** Node process, never inside Electron's runtime.
This is deliberate:

- Native modules (`node-pty`) match the staged Node's ABI, not Electron's.
- Harness crashes cannot take the shell down; the shell can report and restart.
- The child environment is explicit (`DSH_HOME`, `NODE_OPTIONS: ''`) rather than
  inherited from whatever launched Electron.

The corollary: `ELECTRON_RUN_AS_NODE` is set on the child, and the child uses the
bundled `runtime/node/node.exe` binary — not `process.execPath`.

## Verifying a staging run

```sh
npm run verify -- --boot
```

Structure + parity + spawn. `--json` for CI. The parity check diffs the staged
composed tree against the official install's tree and **fails on any missing
row**; extra rows from bundled plugins are expected and reported, not penalised.
