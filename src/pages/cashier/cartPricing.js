export const isPartyProduct = (item) => {
  const type = String(item?.productType || item?.activityTypeKey || "").toLowerCase();
  return type.includes("party");
};

export const isAddOnProduct = (item) => {
  const type = String(item?.productType || item?.activityTypeKey || "").toLowerCase();
  return type.includes("add_on") || type.includes("addon") || type.includes("add-on");
};

const productTypeKey = (item) =>
  String(item?.productType || item?.activityTypeKey || "").toLowerCase();

export const requiresCustomerForCheckout = (item) => {
  // POS quick checkout: a booking owner is OPTIONAL by default. Walk-ins
  // should not be forced to enter a customer to pay — not for jump passes,
  // and not for party packages. The only thing that forces a customer is an
  // explicit per-product admin flag (requiresCustomer / customerRequired).
  //
  // Vouchers / memberships / gift cards are NOT listed here because they
  // can still be sold customer-free; their *delivery email* is enforced
  // separately at checkout (a voucher with no email can't be sent), which
  // is a functional requirement rather than "you must attach a customer".
  if (!item) return false;
  return item.requiresCustomer === true || item.customerRequired === true;
};

export const requiresRecipientForCheckout = (item) => {
  const type = productTypeKey(item);
  return ["voucher_pack", "membership", "recurring_membership", "gift_card", "promo_card"].includes(type);
};

const getCustomerContact = (customer) =>
  customer?.contactEmail ||
  customer?.guestEmail ||
  customer?.email ||
  customer?.contactPhone ||
  customer?.guestPhone ||
  customer?.phone ||
  "";

const getCustomerName = (customer) =>
  customer?.name || customer?.guestName || customer?.fullName || "";

export const isNoScheduleProduct = (item) => {
  const type = productTypeKey(item);
  return [
    "stock_item",
    "voucher_pack",
    "membership",
    "gift_card",
  ].includes(type) || isAddOnProduct(item);
};

export const needsScheduleSelection = (item) => {
  if (!item || isNoScheduleProduct(item)) return false;
  const type = productTypeKey(item);
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

const getCustomerChoiceItems = (item) => {
  const sources = [
    item?.itemsIncluded,
    item?.bundleInclusions,
    item?.raw?.itemsIncluded,
    item?.raw?.bundleInclusions,
  ];
  return sources
    .filter(Array.isArray)
    .flat()
    .filter((includedItem) => includedItem?.fulfillmentMode === "customer_choice");
};

export const requiresChoiceSelection = (item) =>
  item?.requiresChoices === true ||
  item?.choiceRequired === true ||
  getCustomerChoiceItems(item).length > 0;

export const hasRequiredChoicesSelected = (item) => {
  if (!requiresChoiceSelection(item)) return true;
  const selections = item?.choiceSelections || {};
  return Object.values(selections).some((value) =>
    Array.isArray(value) ? value.filter(Boolean).length > 0 : Boolean(value)
  );
};

export const getCheckoutRequirements = (
  cartItems = [],
  { customer = null, waiverCoverage = 0, waiverPolicy = "beforePayment" } = {}
) => {
  const items = Array.isArray(cartItems) ? cartItems : [];
  const missingScheduleItems = items.filter(
    (item) => needsScheduleSelection(item) && !hasScheduleSelection(item)
  );
  const customerRequiredItems = items.filter(requiresCustomerForCheckout);
  const choiceRequiredItems = items.filter(requiresChoiceSelection);
  const missingChoiceItems = choiceRequiredItems.filter((item) => !hasRequiredChoicesSelected(item));
  const waiverRequiredQuantity = items.reduce(
    (count, item) => count + (item?.requiresWaiver ? Math.max(1, Number(item.qty) || 1) : 0),
    0
  );
  const hasCustomer =
    customerRequiredItems.length === 0 ||
    (Boolean(getCustomerName(customer)) && Boolean(getCustomerContact(customer)));
  const missingWaiver =
    waiverPolicy === "beforePayment" &&
    waiverRequiredQuantity > Math.max(0, Number(waiverCoverage) || 0);
  const nextStep =
    missingScheduleItems.length > 0
      ? "schedule"
      : !hasCustomer
        ? "customer"
        : missingChoiceItems.length > 0
          ? "choices"
          : missingWaiver
            ? "waiver"
            : "payment";

  return {
    requiresSchedule: items.some(needsScheduleSelection),
    requiresCustomer: customerRequiredItems.length > 0,
    requiresWaiver: waiverRequiredQuantity > 0,
    requiresChoices: choiceRequiredItems.length > 0,
    missingSchedule: missingScheduleItems.length > 0,
    missingCustomer: !hasCustomer,
    missingWaiver,
    missingChoices: missingChoiceItems.length > 0,
    canPayNow: nextStep === "payment",
    nextStep,
    missingScheduleItems,
    customerRequiredItems,
    missingChoiceItems,
    waiverRequiredQuantity,
  };
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

const normalizeCartVariationId = (value) => {
  if (value === null || value === undefined || value === "") return "";
  const number = Number(value);
  return Number.isFinite(number) ? String(number) : String(value);
};

export const canMergeCartLines = (left, right) =>
  left?.id === right?.id &&
  left?.meta === right?.meta &&
  normalizeCartVariationId(left?.variationId) === normalizeCartVariationId(right?.variationId);

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

export const buildPaidCheckoutPricingSummary = (basePricingSummary, payment) => {
  const extraDiscount = Number(payment?.discountAmount || 0);
  if (!extraDiscount) return basePricingSummary;

  const currentDiscount = Number(basePricingSummary?.discountAmount || 0);
  const nextDiscount = Math.round((currentDiscount + extraDiscount) * 100) / 100;
  const discount = payment?.discount || {};
  return {
    ...basePricingSummary,
    discountCode: discount.code || basePricingSummary?.discountCode || null,
    discountName: discount.label || discount.name || basePricingSummary?.discountName || "POS payment discount",
    discountType: discount.source === "coupon"
      ? basePricingSummary?.discountType || "code"
      : basePricingSummary?.discountType || "manual",
    discountValue: Number(basePricingSummary?.discountValue || 0),
    discountMaxValue: Number(basePricingSummary?.discountMaxValue || 0),
    discountAmount: nextDiscount,
  };
};

export const getCreateBookingPaymentAmount = (payment, bookingTotal) => {
  if (payment?.giftCard === true || payment?.terminal === true) return 0;
  const requested = Number(payment?.amountPaid || 0);
  if (!Number.isFinite(requested) || requested <= 0) return 0;
  const cap = Number(bookingTotal || 0);
  const amount = cap > 0 ? Math.min(requested, cap) : requested;
  return Math.round(amount * 100) / 100;
};
