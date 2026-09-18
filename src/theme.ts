/**
 * App appearance: system | light | dark
 * Persists in localStorage; syncs Electron nativeTheme when available.
 */
export type ThemePreference = "system" | "light" | "dark";

export const THEME_STORAGE_KEY = "lamp-light-theme";

export function getThemePreference(): ThemePreference {
  try {
    const value = localStorage.getItem(THEME_STORAGE_KEY);
    if (value === "light" || value === "dark" || value === "system")
      return value;
  } catch {
    /* private mode */
  }
  return "system";
}

export function systemPrefersDark(): boolean {
  return (
    typeof matchMedia === "function" &&
    matchMedia("(prefers-color-scheme: dark)").matches
  );
}

export function resolveTheme(preference: ThemePreference): "light" | "dark" {
  if (preference === "light") return "light";
  if (preference === "dark") return "dark";
  return systemPrefersDark() ? "dark" : "light";
}

export function applyTheme(preference: ThemePreference): "light" | "dark" {
  const resolved = resolveTheme(preference);
  const root = document.documentElement;
  root.dataset.theme = resolved;
  root.style.colorScheme = resolved;
  try {
    localStorage.setItem(THEME_STORAGE_KEY, preference);
  } catch {
    /* ignore */
  }
  void window.lampLight?.invoke("theme:set", preference).catch(() => undefined);
  return resolved;
}

export function initTheme(): ThemePreference {
  const preference = getThemePreference();
  applyTheme(preference);
  return preference;
}
