// Money helpers, shared so we don't drift between screens.
//
// Why Math.round(x*100)/100 and NOT Number(x.toFixed(2)):
//   The toFixed() path goes through string conversion and uses banker's
//   rounding under the hood, which can round 1.005 to "1.00" on some
//   JS engines (V8 historically). Math.round always rounds .5 up, which
//   matches what cashiers expect on a receipt.
//
//   Also: toFixed allocates a string per call. Math.round is one int op.
//   Not a perf bottleneck, but free win on a kiosk doing 1000 ops/sec.

export const roundMoney = (v) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
};

export const moneyFmt = (v) => `$${roundMoney(v).toFixed(2)}`;

// Convert money to integer cents (use this when accumulating sums to
// avoid float drift, e.g. line allocations in CashierApp).
export const toCents = (v) => Math.round((Number(v) || 0) * 100);
