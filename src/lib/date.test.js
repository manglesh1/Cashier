import test from "node:test";
import assert from "node:assert/strict";

import { formatDisplayDate } from "./date.js";

test("database DATEONLY values remain on the stored calendar day", () => {
  assert.equal(
    formatDisplayDate("2026-07-25", {
      locale: "en-US",
      month: "short",
      day: "numeric",
      year: "numeric",
    }),
    "Jul 25, 2026"
  );
});

test("real timestamps still use the requested display timezone", () => {
  assert.equal(
    formatDisplayDate("2026-07-25T01:00:00.000Z", {
      locale: "en-US",
      timeZone: "America/Toronto",
      month: "short",
      day: "numeric",
      year: "numeric",
    }),
    "Jul 24, 2026"
  );
});

test("invalid values use the supplied fallback", () => {
  assert.equal(formatDisplayDate("not-a-date", { fallback: "Date not set" }), "Date not set");
});
