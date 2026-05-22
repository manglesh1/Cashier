// Shared scheduling helpers — pure functions used by both the manual
// slot picker (ScheduleRequiredDialog) and the POS quick-checkout
// auto-assign flow (CashierApp.addItem). Keeping them in one place
// stops the two flows from drifting apart on slot/variation selection.

import {
  clampCartQuantity,
  getDefaultCartQuantity,
  positiveInt,
} from "./cartPricing.js";

// ── Date / time formatting ─────────────────────────────────────────
export const formatDateValue = (date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

export const addDays = (date, days) => {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
};

export const formatShortDate = (dateValue) =>
  new Date(`${dateValue}T00:00:00`).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });

export const timeRangeFromSession = (session) =>
  session?.displayName || session?.name || [session?.fromTime, session?.toTime].filter(Boolean).join(" - ");

export const getStartTime = (session) =>
  String(timeRangeFromSession(session) || "").split(" - ")[0] || "";

export const getEndTime = (session) =>
  String(timeRangeFromSession(session) || "").split(" - ")[1] || "";

// ── Inclusion / choice helpers ─────────────────────────────────────
const getInclusionRoundingMode = (item) => {
  const raw = String(item?.roundingMode || item?.rounding || "").toLowerCase();
  return raw === "down" || raw === "round_down" || raw === "floor" ? "down" : "up";
};

export const calculateEffectiveQty = (item, guestCount = 1) => {
  const baseQty = Math.max(0, Number(item?.qty ?? item?.quantity ?? 0) || 0);
  const guests = Math.max(1, Number(guestCount) || 1);
  const perUnit = String(item?.perUnit || "per_booking");
  if (perUnit === "per_guest") return baseQty * guests;
  if (perUnit === "per_n_guests") {
    const n = Math.max(1, Number(item?.perUnitN) || 1);
    const groups = getInclusionRoundingMode(item) === "down"
      ? (guests > 0 ? Math.max(1, Math.floor(guests / n)) : 0)
      : Math.ceil(guests / n);
    return baseQty * Math.max(0, groups);
  }
  return baseQty;
};

export const getInclusionLabel = (item) =>
  [item?.activityName, item?.variationName || item?.name]
    .filter(Boolean)
    .filter((value, index, arr) => arr.indexOf(value) === index)
    .join(" - ") || "Included item";

export const getAutoIncludedItems = (variation) =>
  (Array.isArray(variation?.itemsIncluded) ? variation.itemsIncluded : [])
    .filter((includedItem) => includedItem?.fulfillmentMode !== "customer_choice");

export const getIncludedItemSummary = (variation, guestCount) =>
  getAutoIncludedItems(variation)
    .map((includedItem) => ({
      key: `${includedItem.activityId || "item"}:${includedItem.variationId || includedItem.name || getInclusionLabel(includedItem)}`,
      label: getInclusionLabel(includedItem),
      quantity: calculateEffectiveQty(includedItem, guestCount),
    }))
    .filter((includedItem) => includedItem.quantity > 0);

export const expandChoiceItems = (includedItem) => {
  const options = Array.isArray(includedItem?.variationOptions) ? includedItem.variationOptions : [];
  if (!options.length) return [includedItem];

  return options
    .map((option) => ({
      ...includedItem,
      variationId: Number(option.variationId || option.id) || null,
      variationName: option.variationName || option.name || option.label || "",
      name: option.name || option.variationName || option.label || includedItem.activityName,
      price: 0,
      listedPrice: 0,
      variationOptions: [],
    }))
    .filter((option) => option.variationId);
};

export const getChoiceItemKey = (includedItem) =>
  `${includedItem.choiceGroup || includedItem.activityName || "choice"}:${includedItem.activityId}:${includedItem.variationId || "base"}`;

export const getChoiceGroups = (variation = {}, guestCount = 1) => {
  const items = Array.isArray(variation.itemsIncluded) ? variation.itemsIncluded : [];
  const groups = new Map();

  items
    .filter((includedItem) => includedItem?.fulfillmentMode === "customer_choice")
    .forEach((includedItem) => {
      const groupName = includedItem.choiceGroup || `${includedItem.activityName || "Guest"} choice`;
      const effectiveQty = calculateEffectiveQty(includedItem, guestCount);
      if (effectiveQty <= 0) return;
      if (!groups.has(groupName)) {
        groups.set(groupName, {
          key: groupName,
          label: groupName.replace(/\s+choice$/i, ""),
          choiceQuantity: effectiveQty,
          items: [],
        });
      } else {
        const group = groups.get(groupName);
        group.choiceQuantity = Math.max(group.choiceQuantity, effectiveQty);
      }
      groups.get(groupName).items.push(...expandChoiceItems(includedItem));
    });

  return [...groups.values()].filter((group) => group.items.length > 0);
};

export const buildResolvedInclusions = (variation, selections) => {
  const items = Array.isArray(variation?.itemsIncluded) ? variation.itemsIncluded : [];
  const selectedCounts = Object.values(selections || {})
    .flat()
    .reduce((acc, key) => {
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {});

  const includedItems = items
    .filter((includedItem) => includedItem.fulfillmentMode !== "customer_choice")
    .map((includedItem) => ({ ...includedItem, fulfillmentMode: "included" }));

  const selectedChoiceItems = items
    .filter((includedItem) => includedItem.fulfillmentMode === "customer_choice")
    .flatMap(expandChoiceItems)
    .filter((includedItem) => selectedCounts[getChoiceItemKey(includedItem)] > 0)
    .map((includedItem) => ({
      ...includedItem,
      qty: selectedCounts[getChoiceItemKey(includedItem)],
      quantity: selectedCounts[getChoiceItemKey(includedItem)],
      perUnit: "per_booking",
      perUnitN: null,
      fulfillmentMode: "included",
      selectedFromChoice: true,
    }));

  return [...includedItems, ...selectedChoiceItems];
};

// ── Variation / resource helpers ───────────────────────────────────
export const normalizeVariationId = (value) => String(value || "");

export const normalizeSlotIds = (value) => {
  const values = Array.isArray(value) ? value : [value];
  return values
    .map((slotId) => Number(slotId))
    .filter((slotId) => Number.isFinite(slotId) && slotId > 0)
    .map(String);
};

export const isVariationUnavailable = (variation) =>
  variation?.isAvailable === false ||
  (Array.isArray(variation?.resourceGroups) &&
    variation.resourceGroups.some((group) => group?.isAvailable === false));

export const getDefaultGuestCount = (variation, item) =>
  positiveInt(
    variation?.includedGuests ||
      variation?.minGuests ||
      item?.includedGuests ||
      item?.minGuests ||
      getDefaultCartQuantity(item),
    1
  );

export const getMaxGuestCount = (variation) => {
  const raw =
    variation?.maxGuests ||
    variation?.purchaseLimits?.max ||
    variation?.maxPurchase ||
    variation?.capacityRemaining ||
    0;
  const max = Math.floor(Number(raw) || 0);
  return max > 0 ? max : null;
};

export const getResourceGroupRoomLimit = (group) =>
  Math.max(1, Number(group?.maxResourcesPerBooking || group?.requiredCount || 1) || 1);

export const getAvailableResourceOptions = (group) =>
  (group?.options || []).filter((option) => option?.isAvailable && option?.slotId);

export const getVariationAvailabilitySummary = (variation, session) => {
  if (isVariationUnavailable(variation)) return variation?.unavailableReason || "Unavailable";

  const remaining = Math.max(
    0,
    Number(session?.capacityRemaining ?? variation?.capacityRemaining ?? 0) || 0
  );
  const label =
    variation?.availabilityLabel ||
    session?.availabilityLabel ||
    (remaining === 1 ? "spot" : "spots");
  return `${remaining} ${label.replace(/\s+left$/i, "")} left`;
};

export const chooseResourceSlots = (group, guestCount = 1) => {
  const explicit = (group?.selectedSlotIds || group?.candidateSlotIds || [])
    .map(String)
    .filter(Boolean);
  if (explicit.length) return explicit;

  const roomLimit = getResourceGroupRoomLimit(group);
  const available = getAvailableResourceOptions(group)
    .sort((left, right) => {
      const leftCap = Number(left.availableCapacity) || 0;
      const rightCap = Number(right.availableCapacity) || 0;
      if (leftCap !== rightCap) return leftCap - rightCap;
      return String(left.resourceName || "").localeCompare(String(right.resourceName || ""));
    });

  const singleFit = available.find((option) => Number(option.availableCapacity || 0) >= guestCount);
  if (singleFit) return [String(singleFit.slotId)];

  return [...available]
    .sort((left, right) => (Number(right.availableCapacity) || 0) - (Number(left.availableCapacity) || 0))
    .slice(0, roomLimit)
    .map((option) => String(option.slotId));
};

export const getResourceGroupKey = (variation, group) =>
  `${variation?.variationId || "variation"}:${group?.groupKey || `${group?.fromTime || ""}:${group?.toTime || ""}`}`;

export const getVariationSlotIds = (variation) => {
  const resourceIds = (variation?.resources || [])
    .map((resource) => resource?.slotId)
    .filter(Boolean);
  const groupIds = (variation?.resourceGroups || [])
    .flatMap((group) => group?.options || [])
    .map((option) => option?.slotId)
    .filter(Boolean);
  return [...resourceIds, ...groupIds].map(String);
};

export const sessionMatchesCartLine = (session, variationId, slotIds, timeRange) => {
  const variations = session?.variations || [];
  const matchingVariation = variations.find((variation) =>
    normalizeVariationId(variation.variationId) === normalizeVariationId(variationId)
  );
  const candidates = matchingVariation ? [matchingVariation] : variations;
  const slotMatch =
    slotIds.length > 0 &&
    candidates.some((variation) => {
      const variationSlotIds = new Set(getVariationSlotIds(variation));
      return slotIds.some((slotId) => variationSlotIds.has(String(slotId)));
    });
  if (slotMatch) return true;
  return Boolean(timeRange && timeRangeFromSession(session) === timeRange);
};

export const buildResourceSelectionsFromSlotIds = (variation, slotIds, guestCount) => {
  if (!slotIds.length) return buildDefaultResourceSelections(variation, guestCount);
  const selected = new Set(slotIds.map(String));
  const selections = {};
  for (const group of variation?.resourceGroups || []) {
    const key = getResourceGroupKey(variation, group);
    const ids = (group.options || [])
      .map((option) => option?.slotId)
      .filter((slotId) => selected.has(String(slotId)))
      .map(String);
    selections[key] = ids.length ? ids : chooseResourceSlots(group, guestCount);
  }
  return selections;
};

export const buildChoiceDraftsFromItem = (variation, guestCount, item) => {
  const groups = getChoiceGroups(variation, guestCount);
  const savedSelections = item?.choiceSelections || {};
  return groups.reduce((acc, group) => {
    const saved =
      savedSelections[group.key] ||
      savedSelections[`${variation.variationId}:${group.key}`] ||
      null;
    if (Array.isArray(saved)) {
      acc[`${variation.variationId}:${group.key}`] = saved;
    }
    return acc;
  }, {});
};

export const getSelectedResourceSlots = (variation, resourceSelections, guestCount) => {
  const groups = variation?.resourceGroups || [];
  if (groups.length) {
    return groups.flatMap((group) => {
      const key = getResourceGroupKey(variation, group);
      const availableIds = new Set(
        (group.options || [])
          .filter((option) => option?.isAvailable)
          .map((option) => String(option.slotId))
      );
      return (resourceSelections[key] || chooseResourceSlots(group, guestCount))
        .map(String)
        .filter((slotId) => availableIds.has(slotId));
    });
  }

  return (variation?.resources || [])
    .map((resource) => resource.slotId)
    .filter(Boolean)
    .map(String);
};

export const buildDefaultResourceSelections = (variation, guestCount) => {
  const selections = {};
  for (const group of variation?.resourceGroups || []) {
    selections[getResourceGroupKey(variation, group)] = chooseResourceSlots(group, guestCount);
  }
  return selections;
};

// ── Cart-line builder (shared by dialog + auto-assign) ─────────────
// Produces the cart-line shape the rest of the app expects (slotId,
// selectedDate, timeRange, bundleInclusions, choiceSelections, qty, meta).
export const buildScheduledLine = ({
  item,
  section,
  selectedDate,
  session,
  variation,
  guestCount,
  slotIds,
  resourceSelections,
  resolvedChoiceSelections = {},
  hasChoiceGroups = false,
}) => {
  const timeRange = timeRangeFromSession(session);
  // Keep the clean section title separate from the displayed `meta`. Editing a
  // line (Change time) re-runs this builder; if we derived the title from the
  // previous `meta` it would prepend the old "title - date - time" onto the new
  // one and compound on every edit. Sourcing from `item.sectionTitle` keeps it
  // stable across re-schedules.
  const sectionTitle = section?.title || item.sectionTitle || item.sub || "";
  return {
    ...item,
    sectionTitle,
    variationId: variation.variationId,
    variationName: variation.name,
    price: Number(variation.cost ?? variation.price ?? item.price ?? 0),
    pricingMode: variation.pricingMode || item.pricingMode || null,
    includedGuests: variation.includedGuests ?? item.includedGuests ?? null,
    additionalPersonPrice: variation.additionalPersonPrice ?? item.additionalPersonPrice ?? null,
    minGuests: variation.minGuests ?? item.minGuests ?? null,
    maxGuests: variation.maxGuests ?? item.maxGuests ?? null,
    slotId: slotIds.length > 1 ? slotIds.map(Number) : Number(slotIds[0]),
    selectedDate,
    timeRange,
    bundleInclusions: hasChoiceGroups
      ? buildResolvedInclusions(variation, resolvedChoiceSelections)
      : variation.itemsIncluded || [],
    choiceSelections: resolvedChoiceSelections,
    resourceSelections,
    qty: guestCount,
    meta: [sectionTitle, formatShortDate(selectedDate), timeRange]
      .filter(Boolean)
      .join(" - "),
  };
};

// ── Auto-assign (POS quick checkout) ───────────────────────────────
// True when a session can actually be sold right now.
export const isSessionBookable = (session) => {
  const hasVariation = (session?.variations || []).some((variation) => !isVariationUnavailable(variation));
  return !session?.isBooked && Number(session?.capacityRemaining || 0) > 0 && hasVariation;
};

const toMinutes = (value) => {
  const [h, m] = String(value).split(":").map((n) => Number(n));
  if (!Number.isFinite(h)) return null;
  return h * 60 + (Number.isFinite(m) ? m : 0);
};

const sessionStartMinutes = (session) => {
  const v = toMinutes(getStartTime(session));
  return v == null ? Number.POSITIVE_INFINITY : v;
};

const sessionEndMinutes = (session) => {
  // Unknown end → treat as "plenty of time left" so we don't wrongly
  // exclude a slot just because the API didn't give us an end time.
  const v = toMinutes(getEndTime(session));
  return v == null ? Number.POSITIVE_INFINITY : v;
};

// Pick the slot a walk-in customer most likely wants.
//
// Business rule (movie-hall "late seating" style):
//   1. A slot already running can still be sold if:
//        • elapsed   (now - start) <= graceMinutes      ("just started")
//        • AND, ONLY when a minimum is configured (minRemainingMinutes > 0),
//          remaining (end - now) >= minRemainingMinutes ("worth it").
//      If minRemainingMinutes is 0/unset, the remaining-time rule is OFF and
//      only the join window applies.
//      Among running joinable slots, prefer the most-recently-started one
//      (most time left). This beats the next upcoming slot so a walk-in
//      starts immediately.
//   2. Otherwise, the soonest upcoming slot (start in the future).
//   3. Otherwise nothing today → caller falls back to the manual picker.
//
// graceMinutes defaults to 15; minRemainingMinutes defaults to 0 (disabled)
// when not supplied — managers opt in by setting a positive value.
export const pickNearestSession = (
  sessions,
  nowMinutes,
  { graceMinutes = 15, minRemainingMinutes = 0 } = {}
) => {
  const grace = Number.isFinite(graceMinutes) ? graceMinutes : 15;
  const minRemaining = Number.isFinite(minRemainingMinutes) ? minRemainingMinutes : 0;

  const bookable = (sessions || []).filter(isSessionBookable).map((session) => ({
    session,
    start: sessionStartMinutes(session),
    end: sessionEndMinutes(session),
  }));
  if (!bookable.length) return null;

  // 1. Running & joinable. Min-remaining only enforced when configured (>0).
  const runningJoinable = bookable
    .filter(
      (entry) =>
        entry.start <= nowMinutes &&
        nowMinutes - entry.start <= grace &&
        (minRemaining <= 0 || entry.end - nowMinutes >= minRemaining)
    )
    .sort((a, b) => b.start - a.start); // latest start = most time remaining
  if (runningJoinable.length) return runningJoinable[0].session;

  // 2. Soonest upcoming.
  const upcoming = bookable
    .filter((entry) => entry.start > nowMinutes)
    .sort((a, b) => a.start - b.start);
  if (upcoming.length) return upcoming[0].session;

  // 3. Nothing sellable right now.
  return null;
};

// Whether a session can still be sold/selected at `nowMinutes` for TODAY:
//   • future start                → always selectable
//   • currently running           → within graceMinutes of its start, AND
//                                   (only if minRemainingMinutes > 0) with at
//                                   least that much time left before it ends
//   • long-started / nearly-over  → not selectable (it's "past")
// minRemainingMinutes of 0/unset disables the remaining-time rule (join
// window only). Used by the manual picker; future DATES bypass this entirely.
export const isSessionSelectableNow = (
  session,
  nowMinutes,
  { graceMinutes = 15, minRemainingMinutes = 0 } = {}
) => {
  const grace = Number.isFinite(graceMinutes) ? graceMinutes : 15;
  const minRemaining = Number.isFinite(minRemainingMinutes) ? minRemainingMinutes : 0;
  const start = sessionStartMinutes(session);
  const end = sessionEndMinutes(session);
  if (start > nowMinutes) return true;
  if (nowMinutes - start > grace) return false;
  if (minRemaining > 0 && end - nowMinutes < minRemaining) return false;
  return true;
};

// Whether a session is still pickable by hand for TODAY: true unless it has
// already ENDED. Unlike isSessionSelectableNow (which enforces the join-grace
// + min-remaining AUTO rules), the MANUAL picker always lets a cashier select
// a currently-running slot at their discretion — the grace/min-remaining
// settings gate the auto-assign flow only, not manual selection.
export const isSessionNotEnded = (session, nowMinutes) =>
  sessionEndMinutes(session) > nowMinutes;

export const pickDefaultVariation = (session, item) => {
  const variations = session?.variations || [];
  return (
    variations.find(
      (variation) =>
        normalizeVariationId(variation.variationId) === normalizeVariationId(item?.variationId) &&
        !isVariationUnavailable(variation)
    ) ||
    variations.find((variation) => !isVariationUnavailable(variation)) ||
    variations[0] ||
    null
  );
};

// Given a date's availability sessions, build a ready-to-cart line for the
// nearest bookable slot — picking sensible defaults for variation, guest
// count, resources and (party) choices. Returns null when nothing on the
// date can be sold, so the caller can fall back to the manual picker.
export const autoScheduleLine = ({
  item,
  section,
  sessions,
  selectedDate,
  nowMinutes,
  graceMinutes,
  minRemainingMinutes,
}) => {
  const session = pickNearestSession(sessions, nowMinutes, { graceMinutes, minRemainingMinutes });
  if (!session) return null;

  const variation = pickDefaultVariation(session, item);
  if (!variation) return null;

  const guestCount = clampCartQuantity(
    {
      ...item,
      minGuests: variation.minGuests ?? item?.minGuests ?? null,
      maxGuests: variation.maxGuests ?? item?.maxGuests ?? null,
    },
    getDefaultGuestCount(variation, item)
  );
  const resourceSelections = buildDefaultResourceSelections(variation, guestCount);
  const slotIds = getSelectedResourceSlots(variation, resourceSelections, guestCount);
  if (!slotIds.length) return null;

  // Default each party choice group to its first option so the line clears
  // the choice gate. The cashier can fine-tune later via "Change time".
  const choiceGroups = getChoiceGroups(variation, guestCount);
  const resolvedChoiceSelections = choiceGroups.reduce((acc, group) => {
    const first = group.items[0];
    acc[group.key] = Array.from({ length: group.choiceQuantity }, () =>
      first ? getChoiceItemKey(first) : ""
    );
    return acc;
  }, {});

  return buildScheduledLine({
    item,
    section,
    selectedDate,
    session,
    variation,
    guestCount,
    slotIds,
    resourceSelections,
    resolvedChoiceSelections,
    hasChoiceGroups: choiceGroups.length > 0,
  });
};
