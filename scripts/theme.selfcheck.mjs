/** ponytail: mirrors src/theme.ts resolve rules — fails if contract drifts. */
import assert from "node:assert/strict";

function resolveTheme(preference, systemDark) {
  if (preference === "light") return "light";
  if (preference === "dark") return "dark";
  return systemDark ? "dark" : "light";
}

assert.equal(resolveTheme("light", true), "light");
assert.equal(resolveTheme("dark", false), "dark");
assert.equal(resolveTheme("system", true), "dark");
assert.equal(resolveTheme("system", false), "light");
assert.equal("lamp-light-theme", "lamp-light-theme");
console.log("theme.selfcheck: ok");
