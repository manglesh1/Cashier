import test from "node:test";
import assert from "node:assert/strict";

import {
  originalTenderLabel,
  refundSubmitBlockReason,
} from "./refundPresentation.js";

test("original cash refunds are labeled as cash rather than card", () => {
  assert.equal(
    originalTenderLabel([{ tenderType: "cash", refundableAmount: 15.4 }]),
    "Original cash tender"
  );
});

test("original card refunds are labeled as card", () => {
  assert.equal(
    originalTenderLabel([{ tenderType: "card", refundableAmount: 15.4 }]),
    "Original card"
  );
});

test("mixed original tenders use a neutral plural label", () => {
  assert.equal(
    originalTenderLabel([
      { tenderType: "cash", refundableAmount: 5 },
      { tenderType: "card", refundableAmount: 10 },
    ]),
    "Original tenders"
  );
});

test("cash confirmation explains why refund submission is disabled", () => {
  assert.equal(
    refundSubmitBlockReason({
      refundable: 15.4,
      destinationReady: true,
      cashReady: false,
      verdict: { canSubmit: true },
    }),
    "Confirm the cash payout above before continuing."
  );
});

test("a ready refund has no blocking explanation", () => {
  assert.equal(
    refundSubmitBlockReason({
      refundable: 15.4,
      destinationReady: true,
      cashReady: true,
      verdict: { canSubmit: true },
    }),
    null
  );
});
