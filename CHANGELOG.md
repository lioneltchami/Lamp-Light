# Changelog

All notable changes to Lamp & Light are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [1.2.23] - 2026-09-27

### Fixed
- **Reader keyboard arrows stopped working after the first chapter change** — the keyboard `useEffect` was bound once on mount, capturing the initial `chapter`/`book`. Navigation now reads via refs that sync to latest state. (`src/Reader.tsx`)
- **`useAsyncError` returned a fresh object every render**, churning effect dependencies in Friends polling, Online restore, and Reader search. Now memoized on `error`. (`src/hooks/useAsyncError.ts`)
- **Destructive confirm dialogs (delete note, unlink profile, sign out) styled identically to safe ones** — added `.confirm-actions button.danger` rule using the existing warm-red palette. (`src/styles.css`)

### Added
- `process.on("uncaughtException")` and `unhandledRejection` handlers in main process so a crash during startup or IPC shows the user a copy-pasteable error instead of dying silently. (`electron/main.ts`)
- `app.on("before-quit")` / `"will-quit"` lifecycle hooks for future telemetry flush. (`electron/main.ts`)
- Auto-update error reason propagates to the renderer (`UpdateStatus.reason`) and surfaces in Settings. (`electron/main.ts`, `src/types.ts`, `src/main.tsx`)
- IPC channel allowlist on the preload bridge — the renderer can only call the 47 channels the main process actually exposes. (`electron/preload.ts`, `electron/preload.cjs`)
- `<ConfirmDialog>` component with focus management + keyboard handling, replacing every native `alert()`/`confirm()` call site. (`src/components/ConfirmDialog.tsx`, `src/main.tsx`, `src/Reader.tsx`)
- Reader first-render skeleton so the chrome doesn't flash empty before `bible:chapter` resolves. (`src/Reader.tsx`)
- Contributing, Security, Changelog docs; troubleshooting section in README. (`CONTRIBUTING.md`, `SECURITY.md`, `CHANGELOG.md`, `README.md`)

### Changed
- Pinned 14 dependency versions that were previously `"latest"` to caret-ranges. (`package.json`, `package-lock.json`)
- Added `concurrency:` block to the release workflow to prevent the Homebrew cask job from racing on rapid re-tags. (`.github/workflows/release.yml`)
- `verify-packaged-app.mjs` now asserts no `*.test.js` files leak into the asar. (`scripts/verify-packaged-app.mjs`)
- Extracted `UpdateStatus` to `src/types.ts` to remove the duplicate declaration. (`src/types.ts`, `src/main.tsx`)

## [1.2.22] - 2026-09-26

### Fixed
- **Auto-update dialog re-fire loop**: clicking "Restart and update" would silently no-op on macOS (Squirrel.Mac race window), then re-show the same dialog. Added version-keyed idempotency on the `update-downloaded` listener, hoisted the updater wiring to a module-level singleton (no more listener leak across macOS `activate` cycles), replaced the permanent `setInterval` with a re-arming `setTimeout`, and added a 4-second `app.quit()` safety net. (`electron/main.ts`, `electron/updater-state.ts`, `src/main.tsx`)
- Documented the `/Applications` install requirement in `RELEASE.md` — Squirrel.Mac cannot swap the bundle from a mounted DMG or `~/Downloads`.

### Added
- Homebrew tap auto-update after each desktop release (`.github/workflows/release.yml`, `scripts/update-homebrew-cask.sh`).

## [1.2.21] and earlier
See [GitHub Releases](https://github.com/lioneltchami/Lamp-Light/releases).
