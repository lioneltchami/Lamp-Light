# Contributing to Lamp & Light

Thanks for your interest. This is a small Electron app — the contribution bar is "small, focused, well-tested."

## Local setup

```bash
npm install
npm run dev       # starts vite + electron with hot-reload
```

## Branching

| Branch | Role |
| --- | --- |
| `dev` | Default. All day-to-day work. Direct push allowed. |
| `main` | Protected. PR from `dev` only. Tagged releases come from here. |
| `feature/*`, `fix/*` | Optional. Use for parallel or risky work, then PR into `dev`. |

See `README.md` for the full flow.

## Before opening a PR

1. `npm run check` (typecheck both renderer and electron)
2. `npm test` (vitest — expect 50+ tests; the `content.test.ts` 5s timeout is pre-existing and unrelated to your changes)
3. If you changed any IPC channel name, update `verify-packaged-app.mjs` to match.
4. If you changed `electron/main.ts`, rebuild before testing the installer path:
   ```bash
   npm run build
   node scripts/verify-packaged-app.mjs "release/mac-arm64/Lamp Light.app"
   ```

## Code style

- TypeScript everywhere. No `any` unless the type genuinely can't be expressed.
- Imports: relative paths only (no path aliases).
- Tests: vitest, colocated as `*.test.ts` next to source.
- Renderer: React + hooks. No class components.

## Security

- IPC handlers must validate inputs (no `as` casts without runtime checks).
- Never `eval`, `exec`, or load user-controlled paths.
- Report vulnerabilities privately — see `SECURITY.md`.
