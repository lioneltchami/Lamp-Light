/**
 * Window/native theme resolution. Free of any `electron` import so
 * `resolveWindowTheme` is unit-testable; the caller that actually mutates
 * `nativeTheme` and the open windows lives in `ipc/app.ts`.
 */

/** Chromium background colours, keyed by the resolved (post-`nativeTheme`) mode. */
export const WINDOW_BG = { light: "#f5f0e6", dark: "#161b18" } as const;

export type ResolvedWindowTheme = {
	preference: "light" | "dark" | "system";
	resolved: "light" | "dark";
	background: string;
};

/**
 * Map a stored preference plus the OS-level "is dark" answer onto the
 * preference to apply and the background colour to paint.
 *
 * `preference` is normalised defensively so callers can pass the raw stored
 * value; unknown values fall back to `system`.
 */
export function resolveWindowTheme(
	preference: string,
	shouldUseDarkColors: boolean,
): ResolvedWindowTheme {
	const mode =
		preference === "light" || preference === "dark" ? preference : "system";
	const resolved = shouldUseDarkColors ? "dark" : "light";
	return { preference: mode, resolved, background: WINDOW_BG[resolved] };
}
