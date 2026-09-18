/** External links opened from the app (browser). Keep in sync with Settings → Support. */
export const EXTERNAL_LINKS = {
	coffee: "https://ko-fi.com/apologiadefense",
	supportMore: "https://apologialibrary.com/support",
	apologiaLibrary: "https://apologialibrary.com",
	site: "https://lamp-and-light.netlify.app",
} as const;

const ALLOWED = new Set<string>(Object.values(EXTERNAL_LINKS));

export function isAllowedExternalUrl(url: string): boolean {
	return ALLOWED.has(url);
}
