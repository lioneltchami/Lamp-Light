<p align="center">
  <img src="src/assets/logo.png" alt="Lamp & Light" width="180" />
</p>

<h1 align="center">Lamp & Light</h1>

<p align="center">
  <strong>Offline-first Bible trivia, reading, and practice for your desktop.</strong><br />
  Local profiles, daily questions, streaks, and optional friends — yours even without the network.
</p>

<p align="center">
  <a href="https://github.com/lioneltchami/Lamp-Light/releases/latest"><img alt="Latest release" src="https://img.shields.io/github/v/release/lioneltchami/Lamp-Light?label=download&color=b45309" /></a>
  <a href="https://github.com/lioneltchami/Lamp-Light/actions/workflows/ci.yml"><img alt="CI" src="https://img.shields.io/github/actions/workflow/status/lioneltchami/Lamp-Light/ci.yml?branch=main&label=CI" /></a>
</p>

## What it is

**Lamp & Light** is a native desktop app (macOS + Windows) for spending time in Scripture — not a browser tab that forgets you when you go offline.

- **Trivia & practice** — quizzes with a curated question bank
- **Bible reading** — full BSB, WEB, and KJV bundled for offline use
- **Daily question** — one prompt a day, with optional reminders and a dock badge on Mac
- **Progress that stays** — profiles, XP, streaks, medals, highlights on your machine
- **Friends when you want them** — optional online friends and live games

## Download

Direct installer links (also on the [site](https://lamp-and-light.netlify.app/#download)):

| Platform | File |
| --- | --- |
| Windows | [`Lamp-Light-Setup.exe`](https://github.com/lioneltchami/Lamp-Light/releases/latest/download/Lamp-Light-Setup.exe) |
| macOS (Apple Silicon) | [`Lamp-Light-arm64.dmg`](https://github.com/lioneltchami/Lamp-Light/releases/latest/download/Lamp-Light-arm64.dmg) |
| macOS (Intel) | [`Lamp-Light-x64.dmg`](https://github.com/lioneltchami/Lamp-Light/releases/latest/download/Lamp-Light-x64.dmg) |

Installed apps **auto-update** and keep your local profiles and progress.

### Homebrew (Mac)

```bash
brew tap lioneltchami/tap
brew install --cask lamp-light
```

Tap: [lioneltchami/homebrew-tap](https://github.com/lioneltchami/homebrew-tap).
 Shipping a new version: [RELEASE.md](./RELEASE.md).

## Branching (required)

| Branch | Role |
| --- | --- |
| **`dev`** | Default. All day-to-day commits and pushes land here. |
| **`main`** | Protected. Only via PR from `dev`. Tagged releases come from here. |
| **`feature/*`** | Optional. Use for parallel or risky work, then PR into `dev`. |

**Best default for this repo:** push straight to **`dev`**. Feature branches are optional — use them when you want an isolated review or two things in flight. You do **not** need feature → `dev` → `main` for every small change.

Flow:

```text
you → push to dev  →  CI
         ↓
   PR: dev → main  →  CI (required)
         ↓
   merge to main
         ↓
   tag vX.Y.Z on main  →  Mac/Win release build + GitHub Release
```

Direct pushes to `main` are blocked (GitHub rules + local `.githooks/pre-push`). After `npm install`, hooks path is set automatically.

```bash
git checkout dev
git pull
# …work…
git push -u origin HEAD   # tracks dev; never push to main
```

## Website

Marketing site lives in [`website/`](./website/) (Vite + Netlify).

```bash
cd website && npm install && npm run dev
```

Deploy: Netlify base directory `website`. Download buttons deep-link installers via `/releases/latest/download/…` (stable artifact names).

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
# After packaging on Mac:
npm run verify:packaged -- "release/mac-arm64/Lamp Light.app"
```

## Project layout

| Path | Role |
| --- | --- |
| `content/` | Public-domain verse corpora (BSB, WEB, KJV) |
| `electron/` | Main process, SQLite, domain rules, auto-update |
| `src/` | React UI (preload bridge: `window.lampLight`) |
| `shared/` | IPC / multiplayer contracts |
| `release/` | Installer output (`dist/` is Vite UI only) |

Content DB is built into Electron `userData` (`selah-content.sqlite`). Profiles live in `selah-user.sqlite` outside the install dir so upgrades do not wipe progress. On disk the app folder may still be named `bible-questions-app` so older installs keep their data.

Question IDs in the bank are permanent — never reuse an ID.

## Content policy

Bundled BSB and WEB are public domain. KJV is public domain outside the United Kingdom (Crown letters patent). Do not change a translation’s verse text while presenting it under that translation’s name. See [`content/LICENSES.md`](./content/LICENSES.md).
