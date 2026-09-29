import { describe, expect, it } from "vitest";
import { resolveWindowTheme, WINDOW_BG } from "./theme.js";

describe("window theme resolution", () => {
	it("passes explicit preferences through and resolves them to themselves", () => {
		expect(resolveWindowTheme("dark", true)).toEqual({
			preference: "dark",
			resolved: "dark",
			background: WINDOW_BG.dark,
		});
		expect(resolveWindowTheme("light", false)).toEqual({
			preference: "light",
			resolved: "light",
			background: WINDOW_BG.light,
		});
	});

	it("falls back to the OS scheme for `system`", () => {
		expect(resolveWindowTheme("system", true)).toEqual({
			preference: "system",
			resolved: "dark",
			background: WINDOW_BG.dark,
		});
		expect(resolveWindowTheme("system", false)).toEqual({
			preference: "system",
			resolved: "light",
			background: WINDOW_BG.light,
		});
	});

	it("normalises an unknown or empty preference to `system`", () => {
		// A corrupt settings row must not leave the window with no background.
		for (const value of ["", "DARK", "midnight", "  "]) {
			expect(resolveWindowTheme(value, false).preference).toBe("system");
		}
	});

	it("picks the background from the OS answer, not the stored preference", () => {
		// The caller must assign `nativeTheme.themeSource` *before* asking, so
		// `shouldUseDarkColors` already reflects the theme being applied.
		// This function only translates; it never consults the preference again.
		expect(resolveWindowTheme("dark", true).background).toBe(WINDOW_BG.dark);
		expect(resolveWindowTheme("light", false).background).toBe(WINDOW_BG.light);
		expect(resolveWindowTheme("system", true).background).toBe(WINDOW_BG.dark);
		expect(resolveWindowTheme("system", false).background).toBe(WINDOW_BG.light);
	});
});
