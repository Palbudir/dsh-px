# dsh-px

A self-contained **Electron desktop client that packages DeepSeek Harness (`dsh`) into one app**.

No terminal. No `npm install` on the user's side. No separately-installed Node, pnpm, or dsh.
Download, double-click, and the full harness is there.

> **Status: beta in progress.** The beta acceptance bar is deliberately concrete:
> **the packaged app must reach at least official `dsh` capability.**
> That bar is measured, not asserted — see [Verification](#verification).

---

## The idea

`dsh` is already a web application: `dsh --profile web` serves a browser UI on
`127.0.0.1`. So a desktop client does **not** need to reimplement any harness
behaviour. It needs to do exactly two things:

1. **Own the runtime** — ship a fixed Node plus the official dsh install, so the
   user's machine is irrelevant.
2. **Own the window** — spawn that dsh, wait for its HTTP surface, and embed it
   in a native window.

Everything else (agent, tools, sandbox, sessions, plugin composition, settings)
is the official dsh doing what it already does. That is why "at least official
capability" is an achievable bar rather than a rewrite.

```
electron main process
  └─ spawn  runtime/node/node.exe runtime/dsh/lib/bin.js --profile web --no-open
              │  DSH_HOME = <userData>/dsh-home   (seeded from runtime/dsh-home)
              └─ serves http://127.0.0.1:<port>  ──►  BrowserWindow
```

One subtlety makes or breaks the window, and it is worth stating up front:
**the clean URL above answers `401`.** dsh fences its browser surface with a
per-process launch token, and only the URL `dsh web` announces — the clean URL
plus `?token=…` — exchanges that token for a signed session cookie. So the shell
uses the clean URL purely as a *readiness probe* and loads the URL the harness
prints. See `docs/PACKAGING.md`, constraint 6.

## Repository layout

```
app/
  main.mjs                Electron main process: resolve runtime, spawn dsh, window, tray
  bootstrap.mjs           headless smoke test — boots the staged runtime without Electron
scripts/
  stage-runtime.mjs       assembles ./runtime (node + dsh + seed profile)
  verify-capabilities.mjs the beta acceptance harness (structure + parity + spawn)
docs/
  PACKAGING.md            how the runtime is assembled, and why it is done this way
  ROADMAP.md              what beta means, and what comes after
```

`runtime/` is **generated, never committed** — it is hundreds of megabytes of
third-party code. `.gitignore` enforces that.

## Quick start (development)

```sh
npm install

# Assemble the runtime.
#   --from-existing  clones the profile you already run locally (fast, offline)
#   --with-plugins   installs the default plugin set from npm (reproducible)
npm run stage -- --from-existing

# Prove the staged runtime is real and capable.
npm run verify -- --boot

# Run the desktop client.
npm start
```

## Verification

`npm run verify` is the beta gate. It performs three independent checks:

| Check | What it proves |
|---|---|
| **Structure** | The staged runtime exists, its profile declares the shipped bundle layers, and a manifest records exactly what was staged. |
| **Parity** | The staged profile's composed plugin tree and the **official** install's tree are dumped and compared **row by row**. Anything official has that staged lacks is a capability gap, and the run fails. |
| **Spawn** (`--boot`) | The staged harness actually starts and its HTTP surface answers. |

The parity check is the important one: it turns "at least official capability"
from a claim into a diff. Bundled plugins legitimately make the staged tree a
**superset**; the gate only fails on **missing** rows.

```sh
npm run verify -- --boot --json     # machine-readable, for CI
```

## Bundled plugins

The beta ships the web profile with these pre-installed (npm names verified):

| Package | Role |
|---|---|
| `dshmarket` | In-app plugin market: browse, one-click install/upgrade, themes |
| `dsh-better-sidebar` | VSCode-like right sidebar (files, editor, terminal, git, browser); also the extension point other UI plugins register tabs into |
| `dsh-mermaid-render` | Renders mermaid code blocks as diagram cards |
| `dsh-find-plugin` | Lets the agent discover plugins from the curated registry |

Plugin composition is **not** hardcoded. It is the profile's
`dsh.profile.bundles` list, which is the official mechanism — the app inherits
it rather than reimplementing it.

## Packaging

```sh
npm run stage -- --with-plugins   # reproducible runtime from npm
npm run dist                      # electron-builder -> dist/
```

`electron-builder` copies `runtime/` into the app's `resources/`, so the
installed app is genuinely self-contained. See `docs/PACKAGING.md` for the
non-obvious constraints (junction trees, pnpm build approvals, `allowBuilds`).

## Known limitations (beta)

- **Windows is the primary target**; macOS/Linux targets are configured but
  unexercised.
- **No auto-update yet.** `docs/ROADMAP.md` covers the intended design and why
  it will reuse existing, proven updater plugins rather than a bespoke one.
- The Electron build is **unsigned**.
- Auth uses dsh's own browser-trust fence; the shell does not add a second
  login layer.
- **Installing plugins from inside the app needs `pnpm` on PATH.** The initial
  plugin set is pre-installed in the bundled profile, so the app works out of the
  box; adding more from the market currently expects pnpm (the market offers a
  one-click setup when it is missing).
- The staged runtime is ~620 MB (Node 100 MB + dsh 213 MB + plugin tree 309 MB),
  so an installed build is large. `electron-builder` compresses it, but there is
  real room to trim.

### Verifying Electron itself on Windows

`npm install` can silently leave a broken Electron (see `docs/PACKAGING.md`,
constraint 7). If `npx electron --version` fails, the cached zip is usually fine
and only the extraction failed:

```sh
tar -xf "$LOCALAPPDATA/electron/Cache"/*/electron-v*-win32-x64.zip -C node_modules/electron/dist
printf 'electron.exe' > node_modules/electron/path.txt
```

## License

MIT
