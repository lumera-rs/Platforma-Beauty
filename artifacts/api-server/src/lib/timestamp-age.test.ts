import assert from "node:assert/strict";
import { timestampAgeMinutes } from "./timestamp-age";

const now = new Date("2026-09-02T12:00:00.000Z");

assert.equal(timestampAgeMinutes(new Date("2026-09-02T11:45:00.000Z"), now), 15);
assert.equal(timestampAgeMinutes("2026-09-02T11:30:00.000Z", now), 30);
assert.equal(timestampAgeMinutes(null, now), null);
assert.equal(timestampAgeMinutes("not-a-timestamp", now), null);

process.stdout.write("✓ timestamp age normalization regression passed\n");