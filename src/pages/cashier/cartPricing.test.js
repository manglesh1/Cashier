import test from "node:test";
import assert from "node:assert/strict";

import {
  buildPaidCheckoutPricingSummary,
  clampCartQuantity,
  getCheckoutRequirements,
  getCartLineSubtotal,
  getDefaultCartQuantity,
  getMinimumCartQuantity,
  hasScheduleSelection,
  needsScheduleSelection,
  requiresCustomerForCheckout,
  requiresRecipientForCheckout,
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

test("checkout matrix keeps retail and add-ons customer-free", () => {
  assert.equal(requiresCustomerForCheckout({ productType: "stock_item" }), false);
  assert.equal(requiresCustomerForCheckout({ productType: "party_add_on" }), false);
  assert.equal(requiresCustomerForCheckout({ productType: "food" }), false);
});

test("checkout matrix keeps party bookings customer-optional (POS quick checkout)", () => {
  const item = {
    productType: "party_bundle",
    slotId: 12,
    qty: 10,
  };

  // Customer is optional by default — a scheduled party can pay immediately.
  const reqs = getCheckoutRequirements([item]);
  assert.equal(reqs.requiresCustomer, false);
  assert.equal(reqs.canPayNow, true);
  assert.equal(reqs.nextStep, "payment");

  // An explicit per-product flag still forces a booking owner.
  const flagged = getCheckoutRequirements([{ ...item, requiresCustomer: true }]);
  assert.equal(flagged.requiresCustomer, true);
  assert.equal(flagged.canPayNow, false);
  assert.equal(flagged.nextStep, "customer");
});

test("checkout matrix keeps session pass customer optional unless configured", () => {
  const session = {
    productType: "session_pass",
    slotId: 99,
    qty: 2,
  };

  assert.equal(getCheckoutRequirements([session]).requiresCustomer, false);
  assert.equal(getCheckoutRequirements([{ ...session, requiresCustomer: true }]).nextStep, "customer");
});

test("checkout matrix separates booking owner from per-unit recipients", () => {
  assert.equal(requiresRecipientForCheckout({ productType: "party_bundle" }), false);
  assert.equal(requiresRecipientForCheckout({ productType: "voucher_pack" }), true);
  assert.equal(requiresRecipientForCheckout({ productType: "gift_card" }), true);
});

test("checkout matrix blocks missing schedule before customer", () => {
  const item = {
    productType: "party_bundle",
    qty: 10,
  };

  const requirements = getCheckoutRequirements([item]);
  assert.equal(requirements.requiresSchedule, true);
  assert.equal(requirements.missingSchedule, true);
  assert.equal(requirements.nextStep, "schedule");
});

test("phase 8: stock and food/add-on checkout can proceed without customer", () => {
  const stock = getCheckoutRequirements([
    { productType: "stock_item", price: 12, qty: 1 },
  ]);
  assert.equal(stock.requiresCustomer, false);
  assert.equal(stock.canPayNow, true);

  const foodAddon = getCheckoutRequirements([
    { productType: "party_add_on", price: 6, qty: 2 },
    { productType: "food", price: 4, qty: 1 },
  ]);
  assert.equal(foodAddon.requiresCustomer, false);
  assert.equal(foodAddon.canPayNow, true);
});

test("phase 8: session products need schedule before payment", () => {
  const scheduled = getCheckoutRequirements([
    { productType: "session_pass", slotId: 15, qty: 2 },
  ]);
  assert.equal(scheduled.nextStep, "payment");
  assert.equal(scheduled.canPayNow, true);

  const unscheduled = getCheckoutRequirements([
    { productType: "session_pass", qty: 2 },
  ]);
  assert.equal(unscheduled.nextStep, "schedule");
  assert.equal(unscheduled.canPayNow, false);
});

test("phase 8: party booking can pay right after schedule without a customer", () => {
  const item = { productType: "party_bundle", slotId: [10, 11], qty: 15 };
  const reqs = getCheckoutRequirements([item]);
  assert.equal(reqs.nextStep, "payment");
  assert.equal(reqs.canPayNow, true);
});

test("phase 8: party required choices block payment until selected", () => {
  const item = {
    productType: "party_bundle",
    slotId: 10,
    qty: 15,
    requiresChoices: true,
  };
  const customer = { name: "Bimal Gayali", email: "bimal@example.com" };

  const missingChoices = getCheckoutRequirements([item], { customer });
  assert.equal(missingChoices.nextStep, "choices");
  assert.equal(missingChoices.canPayNow, false);

  const ready = getCheckoutRequirements([
    { ...item, choiceSelections: { pizza: ["cheese"] } },
  ], { customer });
  assert.equal(ready.nextStep, "payment");
  assert.equal(ready.canPayNow, true);
});

test("phase 8: payment discount is merged into final booking pricing payload", () => {
  const base = {
    subtotalAmount: 100,
    discountAmount: 5,
    taxAmount: 4.75,
    grandTotal: 99.75,
  };

  const merged = buildPaidCheckoutPricingSummary(base, {
    discountAmount: 10,
    discount: { source: "manager", label: "Manager discount" },
  });

  assert.equal(merged.discountAmount, 15);
  assert.equal(merged.discountName, "Manager discount");
  assert.equal(merged.discountType, "manual");
  assert.equal(merged.subtotalAmount, 100);
});
