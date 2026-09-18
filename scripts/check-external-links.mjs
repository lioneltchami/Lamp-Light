import assert from "node:assert/strict";
import {
	EXTERNAL_LINKS,
	isAllowedExternalUrl,
} from "../dist-electron/shared/externalLinks.js";

assert.equal(isAllowedExternalUrl(EXTERNAL_LINKS.coffee), true);
assert.equal(isAllowedExternalUrl("https://evil.example"), false);
assert.equal(EXTERNAL_LINKS.coffee.includes("ko-fi.com"), true);
console.log("check-external-links: ok");
