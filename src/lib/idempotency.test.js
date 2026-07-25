import test from "node:test";
import assert from "node:assert/strict";

import {
  createIdempotencyKey,
  ensureIdempotencyKey,
  keyForAttempt,
} from "./idempotency.js";

test("ensureIdempotencyKey keeps one key for a retried UI attempt", () => {
  const ref = { current: null };
  const first = ensureIdempotencyKey(ref, "cashier-payment");
  const retry = ensureIdempotencyKey(ref, "cashier-payment");

  assert.equal(retry, first);
  assert.match(first, /^cashier-payment:/);
});

test("keyForAttempt changes only when command semantics change", () => {
  const ref = { current: null };
  const first = keyForAttempt(ref, {
    prefix: "cashier-refund",
    fingerprint: "booking:42|amount:12.00|cash",
  });
  const retry = keyForAttempt(ref, {
    prefix: "cashier-refund",
    fingerprint: "booking:42|amount:12.00|cash",
  });
  const changed = keyForAttempt(ref, {
    prefix: "cashier-refund",
    fingerprint: "booking:42|amount:10.00|cash",
  });

  assert.equal(retry, first);
  assert.notEqual(changed, first);
});

test("createIdempotencyKey namespaces independently generated commands", () => {
  const first = createIdempotencyKey("cashier-payment");
  const second = createIdempotencyKey("cashier-payment");

  assert.notEqual(second, first);
  assert.match(second, /^cashier-payment:/);
});
