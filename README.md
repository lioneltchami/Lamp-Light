# Lamp & Light

Offline-first Electron desktop app for Bible reading, quizzes, practice, daily questions, local profiles, XP, streaks, medals, highlights, and optional online friends / live games.

## Download

Newest Windows (`.exe`) or macOS (`.dmg`) from [GitHub Releases](https://github.com/cfanfelle/Bible-Trivia/releases/latest).  
Installed copies **check for updates automatically** and keep local profiles/progress.

How to ship a version: see [RELEASE.md](./RELEASE.md).

## Architecture

- `content/*.txt` — public-domain verse corpora (BSB, WEB, KJV); main process builds `selah-content.sqlite` in userData (questions, animals, books seeded in code).
- Electron `userData/selah-user.sqlite` — private profiles and progress (outside the install dir; survives upgrades). On disk the folder is still named `bible-questions-app` so rebrands do not orphan data.
- `electron/` — trusted main process, migrations, domain rules, persistence, auto-update.
- `src/` — sandboxed React UI via preload bridge (`window.lampLight`).
- `shared/` — IPC / multiplayer contracts.
- Installer artifacts land in `release/` (not `dist/` — that is Vite UI output only).

Bundled offline reading: full BSB / WEB / KJV. Question bank is curated in-app (IDs are permanent and must never be reused).

## Develop

```bash
npm install
npm run dev
```

## Verify and package

```bash
npm test
npm run check
npm run dist
# Mac example after dist:
npm run verify:packaged -- "release/mac-arm64/Lamp Light.app"
```

## Content policy

Bundled BSB and WEB are public domain. KJV is public domain outside the United Kingdom (Crown letters patent). Do not edit a translation’s verse text while presenting it under that translation’s name. See `content/LICENSES.md`.
