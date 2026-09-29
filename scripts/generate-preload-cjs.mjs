#!/usr/bin/env node
/**
 * Generate `electron/preload.cjs` from the TypeScript source of truth
 * `electron/preload.ts`.
 *
 * Why this exists: the main process compiles to ESM (tsconfig.electron.json
 * uses `module: NodeNext`), but Electron loads preload scripts as CommonJS, so
 * a hand-maintained `.cjs` twin is required. Keeping two hand-edited copies of
 * the IPC allow-list is how they drift — this script removes the second copy
 * from the developer's hands.
 *
 * Usage:
 *   node scripts/generate-preload-cjs.mjs
 *   npm run gen:preload
 *
 * Behaviour:
 *   - Transpiles with the project's own TypeScript compiler (devDependency),
 *     so no new dependency and no hand-rolled type stripper.
 *   - Emits CommonJS: `require("electron")`, never ESM `import`/`export`.
 *   - Writes atomically (temp file + rename) so an interrupted run can never
 *     leave a truncated preload.cjs in place.
 *   - Skips the write entirely when the output is already byte-identical, so a
 *     clean `npm run build` produces zero git churn.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);

const HEADER = [
  "// AUTO-GENERATED from electron/preload.ts — do not edit by hand. Run `npm run build` to regenerate.",
  "// Source of truth: electron/preload.ts (see scripts/generate-preload-cjs.mjs).",
  "",
].join("\n");

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, "..");
const SOURCE = path.join(REPO_ROOT, "electron", "preload.ts");
const TARGET = path.join(REPO_ROOT, "electron", "preload.cjs");

/** Thrown for every expected failure so `finally` blocks still clean up. */
class GenerationError extends Error {}

function fail(message) {
  throw new GenerationError(message);
}

/** Locate the project's own tsc without depending on `.bin` shims (Windows). */
function resolveTsc() {
  const candidates = [];
  try {
    const pkgDir = path.dirname(require.resolve("typescript/package.json"));
    candidates.push(path.join(pkgDir, "lib", "tsc.js"), path.join(pkgDir, "bin", "tsc"));
  } catch {
    // typescript not resolvable — fall through to the .bin shim.
  }
  candidates.push(
    path.join(REPO_ROOT, "node_modules", "typescript", "lib", "tsc.js"),
    path.join(REPO_ROOT, "node_modules", ".bin", "tsc"),
  );
  const found = candidates.find((candidate) => fs.existsSync(candidate));
  if (!found) {
    fail("could not find the TypeScript compiler. Run `npm install` first.");
  }
  return found;
}

/** Transpile `electron/preload.ts` to CommonJS and return the emitted source. */
function transpile() {
  if (!fs.existsSync(SOURCE)) {
    fail(`source file not found: ${path.relative(REPO_ROOT, SOURCE)}`);
  }

  // `noCheck` skips type checking (that is `npm run check`'s job) but still
  // reports syntax errors, which are exactly the "fails to transpile" case.
  // `newLine: "lf"` keeps the output byte-identical across platforms.
  const tsconfig = {
    compilerOptions: {
      target: "ES2022",
      module: "CommonJS",
      esModuleInterop: true,
      skipLibCheck: true,
      noCheck: true,
      types: [],
      sourceMap: false,
      declaration: false,
      declarationMap: false,
      removeComments: false,
      newLine: "lf",
      rootDir: path.join(REPO_ROOT, "electron"),
      outDir: "out",
    },
    files: [SOURCE],
  };

  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "preload-cjs-"));
  try {
    const configPath = path.join(workDir, "tsconfig.json");
    fs.writeFileSync(configPath, `${JSON.stringify(tsconfig, null, 2)}\n`, "utf8");

    // Run from the repo root so tsc diagnostics read `electron/preload.ts`
    // rather than a chain of `../` segments.
    const result = spawnSync(process.execPath, [resolveTsc(), "-p", configPath], {
      cwd: REPO_ROOT,
      encoding: "utf8",
    });

    if (result.error) {
      fail(`failed to run the TypeScript compiler: ${result.error.message}`);
    }
    if (result.status !== 0) {
      const detail = `${result.stdout || ""}${result.stderr || ""}`.trim();
      fail(
        `transpiling ${path.relative(REPO_ROOT, SOURCE)} failed (tsc exit ${result.status}).` +
          (detail ? `\n${detail}` : ""),
      );
    }

    const emitted = path.join(workDir, "out", "preload.js");
    if (!fs.existsSync(emitted)) {
      fail(`the TypeScript compiler reported success but produced no output at ${emitted}`);
    }

    const body = fs.readFileSync(emitted, "utf8");
    // Anchor at line start so a trailing comment mentioning "export" cannot
    // trip the guard; CommonJS emit never begins a line with import/export.
    if (/^[ \t]*(?:import|export)\b/m.test(body)) {
      fail("transpiled output still contains ESM syntax; it would not load as a CommonJS preload script.");
    }

    // A leading comment is legal before the `"use strict"` directive prologue.
    return `${HEADER}${body.replace(/\s*$/, "")}\n`;
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
}

/** Write via a sibling temp file + rename so readers never see a partial file. */
function writeAtomic(destination, contents) {
  const temp = path.join(
    path.dirname(destination),
    `.${path.basename(destination)}.${process.pid}.tmp`,
  );
  try {
    fs.writeFileSync(temp, contents, "utf8");
    fs.renameSync(temp, destination);
  } finally {
    if (fs.existsSync(temp)) {
      fs.rmSync(temp, { force: true });
    }
  }
}

try {
  const next = transpile();
  const current = fs.existsSync(TARGET) ? fs.readFileSync(TARGET, "utf8") : null;

  if (current === next) {
    console.log("generate-preload-cjs: electron/preload.cjs is up to date (no changes).");
  } else {
    writeAtomic(TARGET, next);
    console.log(
      `generate-preload-cjs: regenerated electron/preload.cjs${
        current === null ? " (created)" : ""
      } from electron/preload.ts.`,
    );
  }
} catch (error) {
  if (error instanceof GenerationError) {
    console.error(`generate-preload-cjs: ${error.message}`);
    process.exitCode = 1;
  } else {
    throw error;
  }
}
