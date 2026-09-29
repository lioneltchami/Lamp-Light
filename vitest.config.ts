import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		// `tsc -p tsconfig.electron.json` compiles `electron/*.test.ts` into
		// `dist-electron/`. Vitest's default `include` glob collects those
		// compiled copies too, so `npm run build && npm test` silently runs the
		// whole suite twice — and the compiled copies read source files by
		// relative path that don't exist under `dist-electron/`, producing
		// spurious failures. Exclude build output.
		//
		// The include is deliberately broad (every *.test.ts in the app) rather
		// than an allowlist of directories, so a new test under scripts/ or
		// anywhere else is picked up automatically instead of silently never
		// running. `website/` is a separate package with its own vite config and
		// node_modules — excluded so it can grow its own runner without
		// colliding with this one.
		include: ["**/*.test.ts"],
		exclude: [
			"**/node_modules/**",
			"**/dist/**",
			"**/dist-electron/**",
			"**/release/**",
			"**/website/**",
			// Scratch trees that agents create while diffing. They contain full
			// copies of the sources, so vitest would collect their stale tests
			// and fail on code that no longer exists in the real tree.
			"**/.tmp-*/**",
		],
	},
});
