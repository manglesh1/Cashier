import test from "node:test";
import assert from "node:assert/strict";

import {
  clampCartQuantity,
  getCartLineSubtotal,
  getDefaultCartQuantity,
  getMinimumCartQuantity,
  hasScheduleSelection,
  needsScheduleSelection,
} from "./cartPricing.js";

test("party packages default to included guests before minimum guests", () => {
  const item = {
    productType: "party_bundle",
    includedGuests: 10,
    minGuests: 5,
  };

  assert.equal(getDefaultCartQuantity(item), 10);
  assert.equal(getMinimumCartQuantity(item), 5);
});

test("party packages fall back to minimum guests when included guests is not set", () => {
  const item = {
    productType: "party_bundle",
    minGuests: 12,
  };

  assert.equal(getDefaultCartQuantity(item), 12);
  assert.equal(clampCartQuantity(item, 1), 12);
});

test("per-package party subtotal keeps base price through included guest count", () => {
  const item = {
    productType: "party_bundle",
    pricingMode: "perPackage",
    price: 270,
    qty: 10,
    includedGuests: 10,
    additionalPersonPrice: 20,
  };

  assert.equal(getCartLineSubtotal(item), 270);
});

test("per-package party subtotal charges configured extra guests", () => {
  const item = {
    productType: "party_bundle",
    pricingMode: "perPackage",
    price: 270,
    qty: 12,
    includedGuests: 10,
    additionalPersonPrice: 20,
  };

  assert.equal(getCartLineSubtotal(item), 310);
});

test("non-party subtotal remains unit price times quantity", () => {
  assert.equal(getCartLineSubtotal({ productType: "stock_item", price: 6, qty: 3 }), 18);
});

test("session and party products require a schedule selection", () => {
  assert.equal(needsScheduleSelection({ productType: "session_pass" }), true);
  assert.equal(needsScheduleSelection({ productType: "party_package" }), true);
  assert.equal(needsScheduleSelection({ productType: "stock_item" }), false);
  assert.equal(needsScheduleSelection({ productType: "voucher_pack" }), false);
  assert.equal(needsScheduleSelection({ productType: "party_add_on" }), false);
});

test("schedule selection is present when a slot id is selected", () => {
  assert.equal(hasScheduleSelection({ slotId: 123 }), true);
  assert.equal(hasScheduleSelection({ slotId: [null, 456] }), true);
  assert.equal(hasScheduleSelection({ slotId: null }), false);
  assert.equal(hasScheduleSelection({ slotId: [] }), false);
});
