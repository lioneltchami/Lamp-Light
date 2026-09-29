# Changelog

All notable changes to Lamp & Light are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [1.2.25] - 2026-09-29

### Fixed
- **The diagnostic export failed on every destination on Windows.** `validateExportPath` rejected any path containing a backslash, intending to refuse a Windows-shaped payload on a POSIX host. On Windows a backslash is the separator and `path.join` emits one in every absolute path, so the feature was broken on the platform where a user is most likely to need a bundle. The rule is now conditional on `path.sep`. (`electron/diagnostics.ts`)

## [1.2.24] - 2026-09-28

### Added
- **Accessibility pass.** Accessible names for the three genuinely unlabelled icon/emoji buttons (two avatar pickers whose emoji content shadowed their `title`, and the remove-highlight control); a "Skip to main content" link as the first focusable element; focus moved to the new view's `<h1>` on page change, skipped on first render and honouring `prefers-reduced-motion`; a real Tab/Shift+Tab focus trap plus Escape ownership and focus restore in `ConfirmDialog`; per-instance `useId()` for the dialog title; `aria-label` on four placeholder-only form fields; `aria-pressed` on the quiz answer buttons and avatar pickers. (`src/main.tsx`, `src/components/ConfirmDialog.tsx`, `src/styles.css`, `src/Reader.tsx`, `src/OnlineLive.tsx`, `src/CustomGame.tsx`)
- **Local diagnostic log** — `electron/diagnostics.ts` records startup failures and crashes, redacts emails and long tokens, caps the file at 256 KB, and exports a shareable bundle. Two new IPC channels: `diagnostics:read`, `diagnostics:export`. Nothing leaves the machine. (`electron/diagnostics.ts`, `electron/main.ts`, `electron/preload.ts`)
- **`withRetry` helper** with full-jitter exponential backoff, abort-aware during the sleep, applied to idempotent Supabase reads only — writes stay un-retried because a timed-out POST may already have been applied server-side. (`src/lib/retry.ts`, `src/onlineService.ts`)
- **`preload.cjs` is now generated** from `electron/preload.ts` during `npm run build`, and CI fails if the committed copy drifts. Previously the two files were maintained by hand and had already diverged once. (`scripts/generate-preload-cjs.mjs`, `package.json`, `.github/workflows/ci.yml`)

### Security
- **Diagnostic export followed symlinks and could overwrite the profile database.** A `.txt` symlink aimed at `selah-user.sqlite` passed every string check, because `realpathSync` resolved only the destination's *parent*. Exports now refuse a symlinked destination via `lstat` plus an `O_NOFOLLOW` open, so the check cannot be raced. A user who symlinked their chosen export path must now name the real path. (`electron/diagnostics.ts`)

### Changed
- **"Join", "Create profile" and "Save" no longer disable themselves** on empty input. They validate on submit and surface an inline `role="alert"` wired to the field via `aria-describedby` + `aria-invalid`, since a disabled control is unreachable by keyboard and announces nothing. (`src/main.tsx`, `src/CustomGame.tsx`)
- `--faint` and `--gold-eyebrow` corrected at the token level in `src/theme.css` rather than shimmed at usage sites, so a future `color: var(--faint)` cannot silently reintroduce the failure. (`src/theme.css`, `src/styles.css`, `src/avatar.css`, `src/logo.css`)
- `electron/main.ts` split from 1562 to 300 lines into `electron/ipc/*`, `electron/service/*` and focused modules. All 49 IPC channels and all 98 distinct SQL queries are preserved. (`electron/main.ts`, `electron/ipc/*`, `electron/service/*`)
- **Multiplayer polling pauses while the window is hidden** — invites, friend badges and the room poll stop rather than skip. The host's phase driver and clock keep running, since the host advances shared state and minimising would otherwise freeze the round for every other player. (`src/CustomGame.tsx`, `src/OnlineLive.tsx`)

### Fixed
- **Unbounded retry loop while offline.** Five effects listed the memoized `useAsyncError()` result in their dependency arrays. Each recorded failure produced a new object identity, which re-ran the effect, which re-issued the failing request — measured at 21 `restoreOnlineAccount()` calls across 20 commits. All five now depend on the stable `wrap` callback. (`src/OnlineLive.tsx`, `src/Reader.tsx`)
- **The host's phase driver stopped while the host's window was hidden**, freezing the round for every other player. The render clock is also what computes the elapsed time that triggers phase expiry, so removing only the write-loop gate would not have been enough. (`src/CustomGame.tsx`)
- **The 750 ms multiplayer poll had no in-flight guard**, so once retry made a request slower than its own interval, every tick started another chain against a backend that was already struggling. (`src/CustomGame.tsx`)
- **`ConfirmDialog` let focus escape on every parent render.** `onCancel` is an inline arrow at all seven call sites, so listing it as an effect dependency tore the focus trap down and rebuilt it on each render, and the cleanup's focus restore fired mid-dialog — throwing focus back out to the trigger behind the modal. Now read through a ref, with the effect keyed on `open` alone. (`src/components/ConfirmDialog.tsx`)
- **No visible indicator when focus moved on page change.** A programmatic `.focus()` on a `tabindex="-1"` element does not match `:focus-visible` when the navigation was mouse-initiated, so the heading's UA ring was invisible for anyone who clicked a nav item and then reached for the keyboard. The indicator is now explicit. (`src/styles.css`)
- **`verify-packaged-app.mjs` was failing on every build** — it asserted `preload.cjs` began with `const { contextBridge`, which the generator's banner and tsc's `"use strict"` prologue both broke. It now asserts the file exposes the bridge and contains no ESM, which survives a compiler change but still catches a silently-skipped transpile. (`scripts/verify-packaged-app.mjs`)
- **The diagnostic log stopped recording updater failures** when the main-process split moved the auto-updater into its own module. Restored. (`electron/updater.ts`)
- **The test suite ran twice after a build** — `tsc` compiles `electron/*.test.ts` into `dist-electron/`, and vitest collected the compiled copies alongside the sources. (`vitest.config.ts`)
- `.hero .eyebrow` measured 3.97:1 against the light theme's hero gradient, failing AA for 11px bold text. `--gold-hero` lightened to clear 4.5:1 at the gradient's dark end. (`src/theme.css`)
- `.form-error` was a hardcoded `#a44f45` with no dark variant, measuring 2.82:1 on the dark theme's paper. Now `var(--bad-fg)`. (`src/online.css`)
- The startup-error fallback interpolated an unescaped error message into `innerHTML`; it now builds the DOM with `textContent`. (`src/main.tsx`)

## [1.2.23] - 2026-09-27

### Fixed
- **Reader keyboard arrows stopped working after the first chapter change** — the keyboard `useEffect` was bound once on mount, capturing the initial `chapter`/`book`. Navigation now reads via refs that sync to latest state. (`src/Reader.tsx`)
- **`useAsyncError` returned a fresh object every render**, churning effect dependencies in Friends polling, Online restore, and Reader search. Now memoized on `error`. (`src/hooks/useAsyncError.ts`)
- **Destructive confirm dialogs (delete note, unlink profile, sign out) styled identically to safe ones** — added `.confirm-actions button.danger` rule using the existing warm-red palette. (`src/styles.css`)

### Added
- `process.on("uncaughtException")` and `unhandledRejection` handlers in main process so a crash during startup or IPC shows the user a copy-pasteable error instead of dying silently. (`electron/main.ts`)
- `app.on("before-quit")` / `"will-quit"` lifecycle hooks for future telemetry flush. (`electron/main.ts`)
- Auto-update error reason propagates to the renderer (`UpdateStatus.reason`) and surfaces in Settings. (`electron/main.ts`, `src/types.ts`, `src/main.tsx`)
- IPC channel allowlist on the preload bridge — the renderer can only call the 49 channels the main process actually exposes. (`electron/preload.ts`, `electron/preload.cjs`)
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
