# Release checklist (auto-update)

Installed Mac/Windows apps update via **electron-updater** + **GitHub Releases**.  
Push a version tag → CI builds → release assets upload → apps check and download.

## Before every release

1. **Solidify the build locally**
   ```bash
   npm test
   npm run check
   npm run dist
   npm run verify:packaged -- "release/mac-arm64/Lamp Light.app"   # on Mac
   ```
2. **Bump `package.json` `version`** (e.g. `1.2.7` → `1.2.8`).  
   Tag **must** match: `v1.2.8` ↔ `"version": "1.2.8"`. CI fails if they differ.
3. Commit the version bump (and any product changes).
4. **Tag and push**
   ```bash
   git tag v1.2.8
   git push origin main          # or your release branch
   git push origin v1.2.8
   ```
5. Watch **Build desktop release** on GitHub Actions until green.
6. Confirm [Releases](https://github.com/cfanfelle/Bible-Trivia/releases) has:
   - Windows: `Bible-Trivia-Setup-*.exe`, `latest.yml`, `.blockmap`
   - Mac: `*.dmg`, `*.zip` (zip is what auto-update uses), `latest-mac.yml`, `.blockmap`
7. **Smoke update path**
   - Machine A: older installed build
   - Open app → should see update check → download → Restart and update
   - Profiles/progress stay in `~/Library/Application Support/bible-questions-app` (Mac) or `%APPDATA%\bible-questions-app` (Windows)

## What users see

| Step                  | Behavior                                |
| --------------------- | --------------------------------------- |
| App launch (packaged) | Checks GitHub for newer version         |
| Update found          | Downloads in background                 |
| Download done         | Dialog: Restart and update / Later      |
| After restart         | New version; local SQLite profiles kept |

Dev (`npm run dev`) does **not** auto-update — only installed builds.

## CI secrets (optional but recommended)

Without these, CI still builds. Updates and first open are smoother **with** them.

| Secret                        | Platform | Purpose                                               |
| ----------------------------- | -------- | ----------------------------------------------------- |
| `MAC_CSC_LINK`                | Mac      | Base64 `.p12` Developer ID Application cert (or path) |
| `MAC_CSC_KEY_PASSWORD`        | Mac      | Cert password                                         |
| `APPLE_ID`                    | Mac      | Apple ID for notarization                             |
| `APPLE_APP_SPECIFIC_PASSWORD` | Mac      | App-specific password                                 |
| `APPLE_TEAM_ID`               | Mac      | Team ID (e.g. `UD43QCFHR4`)                           |
| `WIN_CSC_LINK`                | Windows  | Base64 `.pfx` code-signing cert                       |
| `WIN_CSC_KEY_PASSWORD`        | Windows  | Cert password                                         |

Repo → Settings → Secrets and variables → Actions.

`mac.notarize` is **not** forced in `package.json` so local `npm run dist` still works without Apple API creds. When you are ready to notarize in CI:

1. Add the Apple secrets above.
2. Set `"notarize": true` under `build.mac` in `package.json` (or use electron-builder’s credential auto-detect once secrets exist).
3. Re-run a tagged release and confirm Gatekeeper opens without “Unnotarized Developer ID”.

## Packaging rules (do not break)

- Builder output dir is **`release/`**, never mix with Vite **`dist/`**.
- `build.files` must **not** include `release/**` or whole `dist/**` (only `dist/index.html` + `dist/assets/**`).
- CI runs `scripts/verify-packaged-app.mjs` so a ~960MB asar / corrupted `preload.cjs` fails the job.

## Rollback

- Do not delete the previous GitHub Release if users are mid-update.
- To stop offering a bad version: mark the release as prerelease or remove `latest.yml` / `latest-mac.yml` from it (advanced). Prefer shipping a fixed `version+1` quickly.
