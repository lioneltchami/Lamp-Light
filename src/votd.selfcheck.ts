/** Assert VOTD date pick is stable and in-range. Run: npx tsx src/votd.selfcheck.ts */
import assert from "node:assert/strict";
import { dayOfYear, pickTodayVotd, VOTD_REFS } from "./votd.ts";

const fixed = new Date(2026, 8, 18); // local Sep 18 2026
const a = pickTodayVotd(fixed);
const b = pickTodayVotd(fixed);
assert.equal(a, b);
assert.ok(VOTD_REFS.includes(a));
assert.equal(a, VOTD_REFS[dayOfYear(fixed) % VOTD_REFS.length]);

const nextYear = pickTodayVotd(new Date(2027, 8, 18));
assert.ok(VOTD_REFS.includes(nextYear));

console.log("votd.selfcheck ok", a.label);
