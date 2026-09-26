# Changelog

All notable changes to Lamp & Light are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [1.2.22] - 2026-09-26

### Fixed
- **Auto-update dialog re-fire loop**: clicking "Restart and update" would silently no-op on macOS (Squirrel.Mac race window), then re-show the same dialog. Added version-keyed idempotency on the `update-downloaded` listener, hoisted the updater wiring to a module-level singleton (no more listener leak across macOS `activate` cycles), replaced the permanent `setInterval` with a re-arming `setTimeout`, and added a 4-second `app.quit()` safety net. (`electron/main.ts`, `electron/updater-state.ts`, `src/main.tsx`)
- Documented the `/Applications` install requirement in `RELEASE.md` — Squirrel.Mac cannot swap the bundle from a mounted DMG or `~/Downloads`.

### Added
- Homebrew tap auto-update after each desktop release (`.github/workflows/release.yml`, `scripts/update-homebrew-cask.sh`).

## [1.2.21] and earlier
See [GitHub Releases](https://github.com/lioneltchami/Lamp-Light/releases).
