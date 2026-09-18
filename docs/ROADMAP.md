# Roadmap

## What "beta" means here

The beta bar is **capability parity with a plain `dsh --profile web` install**,
plus a desktop shell that removes the terminal from the loop.

This is a deliberately narrow bar, and it is defined so that it can be *measured*.
`scripts/verify-capabilities.mjs` composes both trees and diffs them row by row.
A beta release is one where that diff has no missing rows and the harness boots
from the packaged runtime on a machine with no Node installed.

**In scope for beta**

- Self-contained runtime: bundled Node + official dsh + a working profile.
- Desktop window embedding the harness UI, with tray and clean shutdown.
- Bundled plugin set installed and composed through the official bundle mechanism.
- Mechanical parity verification wired into the repo (`npm run verify`).
- Restart-the-harness (needed because bundle changes require a restart).

**Explicitly out of scope for beta**

- Auto-update. See below — it is designed, not implemented.
- Code signing / notarisation.
- Non-Windows platform validation (targets are configured, not exercised).
- Any harness capability the official dsh does not have. Parity is a ceiling for
  beta, not a starting point to exceed.

## After beta

### 1. Auto-update — reuse, do not rebuild

The temptation is to write an updater. Don't: this ecosystem already has several,
and they have solved the failure modes that a first attempt gets wrong.

Two layers update independently, and conflating them is the classic mistake:

| Layer | Channel | Mechanism |
|---|---|---|
| The desktop shell | **GitHub Releases** | `electron-updater` (mature: differential updates, signature checks) |
| Plugins + the profile | **npm** | `dsh plugin add` / `pnpm update`, reconciling `dsh.profile.bundles` |
| The dsh core inside `runtime/` | GitHub Releases (new shell build) | follows the shell |

Existing plugins worth reusing rather than reinventing:

- `dsh-update-checker` — dual-source (npm/GitHub) semver checks, backup,
  integrity check, rollback, watchdog restart, loopback-only write routes,
  refuses cross-channel prerelease promotion.
- `dshmarket` — publishes a versioned *Public plugin update API v1*
  (`/dsh-market/api/v1/...`) with operation polling, rollback and restart, and
  verifies the version pnpm actually placed on disk.

The correct split: the **release manifest** says *what* the bundle should contain
and at which versions; the **existing updater** does the install safely.

### 2. Distribution artifact design

Fields worth carrying in a release manifest, informed by what works elsewhere:

```json
{
  "schema": "dsh-px/release/v1",
  "bundle": { "version": "0.2.0" },
  "requiresDsh": ">=0.1.5-rc.2",
  "plugins": [{ "name": "dsh-better-sidebar", "version": "0.19.1", "source": "npm" }],
  "minShellVersion": "0.2.0"
}
```

An installer should verify a SHA-256 checksum **before** touching an existing
installation, and a failed download or checksum mismatch must leave the previous
install intact and runnable. Re-running the same command should be an in-place
upgrade.

### 3. Plugin composition as a first-class feature

The app's real differentiator is the curated composition, not the shell. That
points at:

- A versioned **aggregate bundle** package (the ecosystem's established pattern:
  declare `dsh.bundle.patch`, pin member plugins as dependencies, ship a
  compatibility check — *not* a copy of their patches).
- Per-plugin `dsh.compatibility.dshReleases` declarations, so the market can warn
  before a host-version mismatch rather than after a failed boot.
- CI assertions that every declared plugin name actually resolves on the registry.
  This is not paranoia: four names in this ecosystem's curated list turned out to
  differ from their npm package name (`dsh-capability-menu` →
  `@daweifu/capability-menu`, `zhengjy01/dsh-updater` → `@zhengjunyao/dsh-updater`,
  `dsh-suite` → `@scoped/dsh-suite`, and `@oh-dsh/skins` exists on no registry).

### 4. Shell hardening

- Single-instance lock; focus the existing window instead of booting a second harness.
- Persist and restore window geometry.
- Surface harness stderr in a diagnostics panel — plugin boot failures currently
  only reach a terminal the user no longer has.
- A "restart harness" affordance, since plugin installs require one.

## Design rules this project holds to

1. **The shell never implements harness behaviour.** If the official dsh can do
   it, the shell spawns it or embeds it. Parity is achieved by *shipping* dsh,
   not by reimplementing dsh.
2. **Capability claims are verified mechanically.** `npm run verify` fails on a
   missing row. A claim that is not checked in CI is a claim that will rot.
3. **Prefer the official extension mechanism.** Plugin composition goes through
   `dsh.profile.bundles`; nothing is hand-patched into the tree.
4. **Reuse proven components over bespoke ones**, especially for anything with a
   failure mode (updaters, rollback, restart supervision).
