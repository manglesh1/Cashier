import test from "node:test";
import assert from "node:assert/strict";
import { validateRefundDestination } from "./refundValidation.js";

test("gift-card destination is required even when the refund amount is valid", () => {
  assert.equal(validateRefundDestination({
    resolutionMethod: "gift_card",
    destinationGiftCard: null,
    cashConfirmationRequired: false,
    cashConfirmed: false,
  }), "Look up and select the destination gift card.");
});

test("cash handover is required for original-tender cash refunds", () => {
  assert.equal(validateRefundDestination({
    resolutionMethod: "original_tender",
    destinationGiftCard: null,
    cashConfirmationRequired: true,
    cashConfirmed: false,
  }), "Confirm that the cash payout will be handed to the customer.");
});

test("a fully confirmed destination passes validation", () => {
  assert.equal(validateRefundDestination({
    resolutionMethod: "gift_card",
    destinationGiftCard: { giftCardId: 9 },
    cashConfirmationRequired: false,
    cashConfirmed: false,
  }), null);
});
