import test from "node:test";
import assert from "node:assert/strict";
import { resolveCashierLocationId } from "./locationContext.js";

test("paired terminal location is authoritative", () => {
  assert.equal(
    resolveCashierLocationId({
      pairedTerminal: { locationId: 4 },
      authLocations: [{ locationId: 1 }],
      cookieLocationId: 2,
    }),
    4
  );
});

test("falls back to auth location, then cookie, before pairing", () => {
  assert.equal(
    resolveCashierLocationId({
      authLocations: [{ locationId: 7 }],
      cookieLocationId: 2,
    }),
    7
  );
  assert.equal(resolveCashierLocationId({ cookieLocationId: "2" }), 2);
});

test("ignores invalid location identifiers", () => {
  assert.equal(
    resolveCashierLocationId({
      pairedTerminal: { locationId: 0 },
      authLocations: [{ locationId: "not-a-number" }],
    }),
    null
  );
});
