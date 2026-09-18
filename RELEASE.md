# Release checklist (auto-update)

Installed Mac/Windows apps update via **electron-updater** + **GitHub Releases**.

**Name:** Lamp & Light.  
**Ship path:** work on `dev` → PR into `main` → tag on `main` → CI builds installers.

## Branch rules

| Branch | Who pushes | What runs |
| --- | --- | --- |
| `dev` | You, every day | CI (test + typecheck + compile) |
| `main` | **Nobody directly** — PR only | CI on the PR; becomes release source |
| `v*` tag on `main` | You, after merge | Full Mac + Windows release + GitHub Release |

Optional: `feature/…` → PR → `dev` when work is large or parallel. Otherwise commit on `dev`.

## Before every release

1. **Land product work on `dev`**, CI green.
2. **Bump `package.json` `version` on `dev`** (e.g. `1.2.12` → `1.2.13`).  
   Tag **must** match: `v1.2.13` ↔ `"version": "1.2.13"`.
3. **Open PR `dev` → `main`**, wait for CI, merge (squash or merge commit — either is fine).
4. **Tag the commit that is now on `main`** (no direct push of commits to `main`):

   ```bash
   git fetch origin
   git checkout main
   git pull --ff-only origin main
   git tag v1.2.13
   git push origin v1.2.13
   git checkout dev
   ```

5. Watch **Build desktop release** until green. The workflow refuses tags that are not on `main`.
6. Confirm [Releases](https://github.com/lioneltchami/Lamp-Light/releases) has:
   - Windows: `Lamp-Light-Setup-*.exe`, `latest.yml`, `.blockmap`
   - Mac: `*.dmg`, `*.zip` (zip is what auto-update uses), `latest-mac.yml`, `.blockmap`
7. **Smoke update path** on an older installed build.

Local solidify (optional but wise before the version bump):

```bash
npm test
npm run check
npm run dist
npm run verify:packaged -- "release/mac-arm64/Lamp Light.app"   # on Mac
```

## What users see

| Step | Behavior |
| --- | --- |
| App launch (packaged) | Checks GitHub for newer version |
| Update found | Downloads in background |
| Download done | Dialog: Restart and update / Later |
| After restart | New version; local SQLite profiles kept |

`npm run dev` does **not** auto-update — only installed builds.

## CI secrets (optional but recommended)

Without these, CI still builds unsigned installers. Signing/notarization needs:

| Secret | Platform | Purpose |
| --- | --- | --- |
| `MAC_CSC_LINK` | Mac | Base64 `.p12` Developer ID Application cert |
| `MAC_CSC_KEY_PASSWORD` | Mac | Cert password |
| `APPLE_ID` | Mac | Apple ID for notarization |
| `APPLE_APP_SPECIFIC_PASSWORD` | Mac | App-specific password |
| `APPLE_TEAM_ID` | Mac | Team ID |
| `WIN_CSC_LINK` | Windows | Base64 `.pfx` |
| `WIN_CSC_KEY_PASSWORD` | Windows | Cert password |

Repo → Settings → Secrets and variables → Actions.

## Packaging rules (do not break)

- Builder output dir is **`release/`**, never mix with Vite **`dist/`**.
- `build.files` must not pack `release/**` into the asar.
- CI runs `scripts/verify-packaged-app.mjs` so a bad asar fails the job.
- Release tags that are not ancestors of `origin/main` fail the **guard** job.

## Rollback

- Do not delete the previous GitHub Release if users are mid-update.
- Prefer shipping a fixed `version+1` quickly over yanking `latest.yml`.
