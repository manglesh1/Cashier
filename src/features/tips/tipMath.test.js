import test from "node:test";
import assert from "node:assert/strict";

import { computeTipBase, applyTipPercent, computeTotals, TIP_ALLOCATIONS } from "./tipMath.js";

test("tipMath(client): computeTipBase honors calcOnTotal", () => {
  assert.equal(computeTipBase({ subtotal: 50, bookingTotal: 100, calcOnTotal: false }), 50);
  assert.equal(computeTipBase({ subtotal: 50, bookingTotal: 100, calcOnTotal: true }), 100);
});

test("tipMath(client): applyTipPercent computes + rounds", () => {
  assert.equal(applyTipPercent(50, 15), 7.5);
  assert.equal(applyTipPercent(33.33, 13), 4.33);
  assert.equal(applyTipPercent(50, 0), 0);
});

test("tipMath(client): applyTipPercent guards bad percent", () => {
  assert.equal(applyTipPercent(50, NaN), 0);
  assert.equal(applyTipPercent(50, -5), 0);
});

test("tipMath(client): computeTotals keeps booking total tip-free", () => {
  const t = computeTotals({ subtotal: 50, tax: 6.5, tipAmount: 8 });
  assert.equal(t.bookingTotal, 56.5);
  assert.equal(t.charged, 64.5);
  assert.equal(t.tip, 8);
});

test("tipMath(client): zero tip → charged equals booking total", () => {
  const t = computeTotals({ subtotal: 50, tax: 6.5, tipAmount: 0 });
  assert.equal(t.charged, 56.5);
});

test("tipMath(client): three allocation options exposed", () => {
  assert.deepEqual(
    TIP_ALLOCATIONS.map((a) => a.value),
    ["booking_host", "logged_in_staff", "general_pool"]
  );
});
