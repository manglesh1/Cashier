export function taxLineLabel({ taxName, taxCalculation } = {}) {
  const name = String(taxName || "").trim();
  const namedRate = name && name.toLowerCase() !== "tax" ? ` (${name})` : "";
  return `Subtotal tax${namedRate}${taxCalculation === "include_in_price" ? " · included" : ""}`;
}

export function totalWithTaxLabel(base, taxAmount) {
  return Number(taxAmount) > 0 ? `${base} (inc. tax)` : base;
}
