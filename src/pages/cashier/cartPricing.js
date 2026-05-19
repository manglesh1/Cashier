export const isPartyProduct = (item) => {
  const type = String(item?.productType || item?.activityTypeKey || "").toLowerCase();
  return type.includes("party");
};

export const isAddOnProduct = (item) => {
  const type = String(item?.productType || item?.activityTypeKey || "").toLowerCase();
  return type.includes("add_on") || type.includes("addon") || type.includes("add-on");
};

export const isNoScheduleProduct = (item) => {
  const type = String(item?.productType || item?.activityTypeKey || "").toLowerCase();
  return [
    "stock_item",
    "voucher_pack",
    "membership",
    "gift_card",
  ].includes(type) || isAddOnProduct(item);
};

export const needsScheduleSelection = (item) => {
  if (!item || isNoScheduleProduct(item)) return false;
  const type = String(item.productType || item.activityTypeKey || "").toLowerCase();
  return (
    type === "session_pass" ||
    type === "party_package" ||
    type === "party_bundle" ||
    type.includes("session") ||
    type.includes("party")
  );
};

export const hasScheduleSelection = (item) => {
  const slotId = item?.slotId;
  if (Array.isArray(slotId)) return slotId.some((id) => Number(id) > 0);
  return Number(slotId) > 0;
};

export const positiveNumber = (value, fallback = 0) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
};

export const positiveInt = (value, fallback = 1) => {
  const number = Math.floor(positiveNumber(value, fallback));
  return number > 0 ? number : fallback;
};

export const getDefaultCartQuantity = (item) => {
  if (!isPartyProduct(item)) return 1;
  return positiveInt(item?.includedGuests || item?.minGuests || item?.minimumGuests || 1, 1);
};

export const getMinimumCartQuantity = (item) => {
  if (!isPartyProduct(item)) return 1;
  return positiveInt(item?.minGuests || item?.minimumGuests || item?.includedGuests || 1, 1);
};

export const getMaximumCartQuantity = (item) => {
  const maxGuests = positiveInt(item?.maxGuests || item?.maximumGuests || 0, 0);
  return maxGuests > 0 ? maxGuests : null;
};

export const clampCartQuantity = (item, quantity) => {
  const minQty = getMinimumCartQuantity(item);
  const maxQty = getMaximumCartQuantity(item);
  const nextQty = Math.max(minQty, positiveInt(quantity, minQty));
  return maxQty ? Math.min(maxQty, nextQty) : nextQty;
};

export const getCartLineSubtotal = (item) => {
  const qty = clampCartQuantity(item, item?.qty);
  const price = positiveNumber(item?.price, 0);
  const pricingMode = String(item?.pricingMode || item?.pricingType || "").toLowerCase();

  if (isPartyProduct(item) && pricingMode === "perpackage") {
    const includedGuests = positiveInt(item?.includedGuests || item?.minGuests || qty, qty);
    const extraGuests = Math.max(0, qty - includedGuests);
    const additionalPersonPrice = positiveNumber(item?.additionalPersonPrice, NaN);
    const extraGuestPrice =
      Number.isFinite(additionalPersonPrice) && additionalPersonPrice >= 0
        ? additionalPersonPrice
        : price / Math.max(1, includedGuests);
    return Number((price + extraGuests * extraGuestPrice).toFixed(2));
  }

  return Number((price * qty).toFixed(2));
};
