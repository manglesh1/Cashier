import test from "node:test";
import assert from "node:assert/strict";
import { taxLineLabel, totalWithTaxLabel } from "./taxDisplay.js";

test("POS tax breakdown labels included tax without adding it twice", () => {
  assert.equal(taxLineLabel({ taxName: "HST", taxCalculation: "add_to_price" }), "Subtotal tax (HST)");
  assert.equal(taxLineLabel({ taxName: "HST", taxCalculation: "include_in_price" }), "Subtotal tax (HST) · included");
  assert.equal(taxLineLabel(), "Subtotal tax");
  assert.equal(totalWithTaxLabel("Total", 2.86), "Total (inc. tax)");
});
