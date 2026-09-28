import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		// `tsc -p tsconfig.electron.json` compiles `electron/*.test.ts` into
		// `dist-electron/`. Vitest's default `include` glob collects those
		// compiled copies too, so `npm run build && npm test` silently runs the
		// whole suite twice — and the compiled copies read source files by
		// relative path that don't exist under `dist-electron/`, producing
		// spurious failures. Exclude build output.
		include: ["electron/**/*.test.ts", "src/**/*.test.ts", "shared/**/*.test.ts"],
		exclude: [
			"**/node_modules/**",
			"**/dist/**",
			"**/dist-electron/**",
			"**/release/**",
		],
	},
});
