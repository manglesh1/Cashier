import React, { useMemo, useState } from "react";
import { useGetAvailabilityQuery } from "../../features/bookings/bookingApi";
import { Icon } from "./Icon";
import {
  clampCartQuantity,
  getCartLineSubtotal,
  getDefaultCartQuantity,
  positiveInt,
} from "./cartPricing";

const formatDateValue = (date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const addDays = (date, days) => {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
};

const formatShortDate = (dateValue) =>
  new Date(`${dateValue}T00:00:00`).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });

const timeRangeFromSession = (session) =>
  session?.displayName || session?.name || [session?.fromTime, session?.toTime].filter(Boolean).join(" - ");

const getStartTime = (session) => String(timeRangeFromSession(session) || "").split(" - ")[0] || "";

const getEndTime = (session) => String(timeRangeFromSession(session) || "").split(" - ")[1] || "";

const normalizeVariationId = (value) => String(value || "");

const isVariationUnavailable = (variation) =>
  variation?.isAvailable === false ||
  (Array.isArray(variation?.resourceGroups) &&
    variation.resourceGroups.some((group) => group?.isAvailable === false));

const getDefaultGuestCount = (variation, item) =>
  positiveInt(
    variation?.includedGuests ||
      variation?.minGuests ||
      item?.includedGuests ||
      item?.minGuests ||
      getDefaultCartQuantity(item),
    1
  );

const getMaxGuestCount = (variation) => {
  const raw =
    variation?.maxGuests ||
    variation?.purchaseLimits?.max ||
    variation?.maxPurchase ||
    variation?.capacityRemaining ||
    0;
  const max = Math.floor(Number(raw) || 0);
  return max > 0 ? max : null;
};

const getResourceGroupRoomLimit = (group) =>
  Math.max(1, Number(group?.maxResourcesPerBooking || group?.requiredCount || 1) || 1);

const chooseResourceSlots = (group, guestCount = 1) => {
  const explicit = (group?.selectedSlotIds || group?.candidateSlotIds || [])
    .map(String)
    .filter(Boolean);
  if (explicit.length) return explicit;

  const roomLimit = getResourceGroupRoomLimit(group);
  const available = (group?.options || [])
    .filter((option) => option?.isAvailable && option?.slotId)
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

const getResourceGroupKey = (variation, group) =>
  `${variation?.variationId || "variation"}:${group?.groupKey || `${group?.fromTime || ""}:${group?.toTime || ""}`}`;

const getSelectedResourceSlots = (variation, resourceSelections, guestCount) => {
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

const buildDefaultResourceSelections = (variation, guestCount) => {
  const selections = {};
  for (const group of variation?.resourceGroups || []) {
    selections[getResourceGroupKey(variation, group)] = chooseResourceSlots(group, guestCount);
  }
  return selections;
};

export function ScheduleRequiredDialog({ item, section, onClose, onAdd }) {
  const [selectedDate, setSelectedDate] = useState(formatDateValue(new Date()));
  const [selectedSession, setSelectedSession] = useState(null);
  const [selectedVariationId, setSelectedVariationId] = useState(normalizeVariationId(item?.variationId));
  const [guestCountByVariation, setGuestCountByVariation] = useState({});
  const [resourceSelections, setResourceSelections] = useState({});
  const [openResourceGroup, setOpenResourceGroup] = useState(null);

  const activityId = item?.activityId;
  const { data, isFetching, error } = useGetAvailabilityQuery(
    { date: selectedDate, activityId },
    { skip: !activityId }
  );

  const sessionsData = data?.data || data || {};
  const sessions = Array.isArray(sessionsData.sessions) ? sessionsData.sessions : [];
  const selectedVariation = useMemo(() => {
    const variations = selectedSession?.variations || [];
    if (!variations.length) return null;
    return (
      variations.find((variation) => normalizeVariationId(variation.variationId) === selectedVariationId) ||
      variations.find((variation) => !isVariationUnavailable(variation)) ||
      variations[0]
    );
  }, [selectedSession, selectedVariationId]);

  const guestCount = selectedVariation
    ? guestCountByVariation[selectedVariation.variationId] || getDefaultGuestCount(selectedVariation, item)
    : getDefaultCartQuantity(item);
  const maxGuestCount = selectedVariation ? getMaxGuestCount(selectedVariation) : null;
  const slotIds = selectedVariation
    ? getSelectedResourceSlots(selectedVariation, resourceSelections, guestCount)
    : [];
  const readyToAdd = Boolean(selectedSession && selectedVariation && slotIds.length > 0 && guestCount > 0);
  const selectedLine = selectedVariation
    ? {
        ...item,
        price: Number(selectedVariation.cost ?? selectedVariation.price ?? item.price ?? 0),
        pricingMode: selectedVariation.pricingMode || item.pricingMode || null,
        includedGuests: selectedVariation.includedGuests ?? item.includedGuests ?? null,
        additionalPersonPrice: selectedVariation.additionalPersonPrice ?? item.additionalPersonPrice ?? null,
        minGuests: selectedVariation.minGuests ?? item.minGuests ?? null,
        maxGuests: selectedVariation.maxGuests ?? item.maxGuests ?? null,
        qty: guestCount,
      }
    : null;

  const dateOptions = Array.from({ length: 14 }, (_, index) => {
    const date = addDays(new Date(), index);
    return {
      value: formatDateValue(date),
      label: index === 0 ? "Today" : date.toLocaleDateString("en-US", { weekday: "short" }),
      sub: date.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
    };
  });

  const handleSessionPick = (session) => {
    const variations = session?.variations || [];
    const preferred =
      variations.find((variation) => normalizeVariationId(variation.variationId) === normalizeVariationId(item?.variationId)) ||
      variations.find((variation) => !isVariationUnavailable(variation)) ||
      variations[0];
    const defaultCount = getDefaultGuestCount(preferred, item);
    setSelectedSession(session);
    setSelectedVariationId(normalizeVariationId(preferred?.variationId));
    setGuestCountByVariation(preferred ? { [preferred.variationId]: defaultCount } : {});
    setResourceSelections(preferred ? buildDefaultResourceSelections(preferred, defaultCount) : {});
    setOpenResourceGroup(null);
  };

  const handleVariationPick = (variation) => {
    if (isVariationUnavailable(variation)) return;
    const nextCount =
      guestCountByVariation[variation.variationId] || getDefaultGuestCount(variation, item);
    setSelectedVariationId(normalizeVariationId(variation.variationId));
    setGuestCountByVariation({ [variation.variationId]: nextCount });
    setResourceSelections(buildDefaultResourceSelections(variation, nextCount));
    setOpenResourceGroup(null);
  };

  const updateGuestCount = (delta) => {
    if (!selectedVariation) return;
    setGuestCountByVariation((prev) => {
      const current = prev[selectedVariation.variationId] || getDefaultGuestCount(selectedVariation, item);
      const nextLine = {
        ...item,
        minGuests: selectedVariation.minGuests ?? item.minGuests ?? null,
        maxGuests: selectedVariation.maxGuests ?? item.maxGuests ?? null,
      };
      const next = clampCartQuantity(nextLine, current + delta);
      if (maxGuestCount && next > maxGuestCount) return prev;
      setResourceSelections(buildDefaultResourceSelections(selectedVariation, next));
      return { [selectedVariation.variationId]: next };
    });
  };

  const handleResourceSelect = (variation, group, option) => {
    if (!option?.isAvailable || !option?.slotId) return;
    const key = getResourceGroupKey(variation, group);
    const roomLimit = getResourceGroupRoomLimit(group);
    const slotId = String(option.slotId);
    setResourceSelections((prev) => {
      const current = (prev[key] || chooseResourceSlots(group, guestCount)).map(String);
      if (roomLimit <= 1) return { ...prev, [key]: [slotId] };
      if (current.includes(slotId)) {
        return { ...prev, [key]: current.filter((id) => id !== slotId) };
      }
      const next = current.length >= roomLimit ? [...current.slice(1), slotId] : [...current, slotId];
      return { ...prev, [key]: next };
    });
  };

  const handleAdd = () => {
    if (!readyToAdd || !selectedVariation) return;
    const timeRange = timeRangeFromSession(selectedSession);
    const nextItem = {
      ...item,
      variationId: selectedVariation.variationId,
      variationName: selectedVariation.name,
      price: Number(selectedVariation.cost ?? selectedVariation.price ?? item.price ?? 0),
      pricingMode: selectedVariation.pricingMode || item.pricingMode || null,
      includedGuests: selectedVariation.includedGuests ?? item.includedGuests ?? null,
      additionalPersonPrice: selectedVariation.additionalPersonPrice ?? item.additionalPersonPrice ?? null,
      minGuests: selectedVariation.minGuests ?? item.minGuests ?? null,
      maxGuests: selectedVariation.maxGuests ?? item.maxGuests ?? null,
      slotId: slotIds.length > 1 ? slotIds.map(Number) : Number(slotIds[0]),
      selectedDate,
      timeRange,
      bundleInclusions: selectedVariation.itemsIncluded || [],
      qty: guestCount,
      meta: [section?.title || item.sub, formatShortDate(selectedDate), timeRange]
        .filter(Boolean)
        .join(" - "),
    };
    onAdd?.(nextItem, section);
    onClose?.();
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 60,
        background: "rgba(0,0,0,0.35)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 18,
      }}
      onMouseDown={onClose}
    >
      <div
        style={{
          width: "min(980px, 100%)",
          maxHeight: "min(820px, calc(100vh - 36px))",
          overflow: "hidden",
          background: "var(--ink-0)",
          border: "2px solid var(--ink-800)",
          borderRadius: 18,
          boxShadow: "0 8px 0 var(--ink-800)",
          display: "flex",
          flexDirection: "column",
        }}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div style={{ padding: 18, display: "flex", gap: 14, borderBottom: "1px solid var(--ink-100)" }}>
          <div
            style={{
              width: 48,
              height: 48,
              borderRadius: 14,
              background: "var(--aero-orange-50)",
              color: "var(--aero-orange-600)",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              flex: "0 0 auto",
            }}
          >
            <Icon name="calendar-clock" size={25} />
          </div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div className="eyebrow">Schedule sale</div>
            <h2 style={{ margin: "3px 0 4px", fontFamily: "var(--font-display)", fontSize: 26 }}>
              {item.name}
            </h2>
            <p style={{ margin: 0, color: "var(--ink-600)", lineHeight: 1.45 }}>
              Pick the date, live slot, guests, and resource before this goes to cart.
            </p>
          </div>
          <button type="button" className="a-btn a-btn--ghost a-btn--sm" onClick={onClose}>
            x
          </button>
        </div>

        <div style={{ overflow: "auto", padding: 18, display: "grid", gap: 18 }}>
          <div style={{ display: "flex", gap: 10, overflowX: "auto", paddingBottom: 2 }}>
            {dateOptions.map((date) => (
              <button
                key={date.value}
                type="button"
                onClick={() => {
                  setSelectedDate(date.value);
                  setSelectedSession(null);
                  setSelectedVariationId(normalizeVariationId(item?.variationId));
                  setGuestCountByVariation({});
                  setResourceSelections({});
                  setOpenResourceGroup(null);
                }}
                style={{
                  all: "unset",
                  cursor: "pointer",
                  minWidth: 88,
                  padding: "10px 12px",
                  borderRadius: 14,
                  border: "1.5px solid",
                  borderColor: selectedDate === date.value ? "var(--ink-800)" : "var(--ink-200)",
                  background: selectedDate === date.value ? "var(--ink-800)" : "var(--ink-0)",
                  color: selectedDate === date.value ? "white" : "var(--ink-800)",
                  textAlign: "center",
                  boxShadow: selectedDate === date.value ? "0 4px 0 var(--ink-900)" : "none",
                  flex: "0 0 auto",
                }}
              >
                <div style={{ fontWeight: 900, fontSize: 13 }}>{date.label}</div>
                <div style={{ fontSize: 12, opacity: 0.75 }}>{date.sub}</div>
              </button>
            ))}
          </div>

          <section>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, marginBottom: 10 }}>
              <h3 style={{ margin: 0, fontFamily: "var(--font-display)", fontSize: 20 }}>Time</h3>
              <span className="eyebrow">{formatShortDate(selectedDate)}</span>
            </div>
            {isFetching ? (
              <EmptyState icon="loader" title="Checking availability" text="Loading live slots for this date..." />
            ) : error ? (
              <EmptyState icon="triangle-alert" title="Availability unavailable" text="Try another date or refresh the POS." />
            ) : sessions.length === 0 ? (
              <EmptyState icon="calendar-x" title="No slots found" text="This product has no active slots on this date." />
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(132px, 1fr))", gap: 10 }}>
                {sessions.map((session) => {
                  const active = selectedSession === session;
                  const hasVariation = (session.variations || []).some((variation) => !isVariationUnavailable(variation));
                  const available = !session.isBooked && Number(session.capacityRemaining || 0) > 0 && hasVariation;
                  return (
                    <button
                      key={`${session.date || selectedDate}-${session.name}`}
                      type="button"
                      disabled={!available}
                      onClick={() => available && handleSessionPick(session)}
                      style={{
                        all: "unset",
                        cursor: available ? "pointer" : "not-allowed",
                        padding: "12px 10px",
                        borderRadius: 14,
                        border: "1.5px solid",
                        borderColor: active ? "var(--aero-orange-600)" : "var(--ink-200)",
                        background: active ? "var(--aero-orange-50)" : available ? "var(--ink-0)" : "var(--ink-50)",
                        opacity: available ? 1 : 0.6,
                      }}
                    >
                      <div style={{ fontWeight: 900, color: "var(--ink-900)" }}>{getStartTime(session)}</div>
                      <div style={{ fontSize: 12, color: "var(--ink-500)", marginTop: 3 }}>
                        {Number(session.capacityRemaining || 0)} {session.availabilityLabel || "spots left"}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </section>

          {selectedSession && (
            <section style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.35fr) minmax(280px, .65fr)", gap: 16 }}>
              <div style={{ minWidth: 0, display: "grid", gap: 12 }}>
                <h3 style={{ margin: 0, fontFamily: "var(--font-display)", fontSize: 20 }}>Guests and resources</h3>
                {(selectedSession.variations || []).map((variation) => {
                  const active = normalizeVariationId(variation.variationId) === normalizeVariationId(selectedVariation?.variationId);
                  const unavailable = isVariationUnavailable(variation);
                  const lineQty = active ? guestCount : getDefaultGuestCount(variation, item);
                  const priceLine = {
                    ...item,
                    productType: item.productType,
                    price: Number(variation.cost ?? variation.price ?? item.price ?? 0),
                    pricingMode: variation.pricingMode || item.pricingMode || null,
                    includedGuests: variation.includedGuests ?? item.includedGuests ?? null,
                    additionalPersonPrice: variation.additionalPersonPrice ?? item.additionalPersonPrice ?? null,
                    minGuests: variation.minGuests ?? item.minGuests ?? null,
                    maxGuests: variation.maxGuests ?? item.maxGuests ?? null,
                    qty: lineQty,
                  };
                  return (
                    <div
                      key={variation.variationId}
                      style={{
                        border: "1.5px solid",
                        borderColor: active ? "var(--aero-orange-500)" : "var(--ink-200)",
                        borderRadius: 14,
                        padding: 14,
                        background: unavailable ? "var(--ink-50)" : "var(--ink-0)",
                        opacity: unavailable ? 0.68 : 1,
                      }}
                    >
                      <div style={{ display: "flex", gap: 14, alignItems: "center" }}>
                        <button
                          type="button"
                          disabled={unavailable}
                          onClick={() => handleVariationPick(variation)}
                          style={{
                            all: "unset",
                            cursor: unavailable ? "not-allowed" : "pointer",
                            flex: 1,
                            minWidth: 0,
                          }}
                        >
                          <div style={{ fontWeight: 900, fontSize: 16, color: "var(--ink-900)" }}>{variation.name}</div>
                          <div style={{ marginTop: 3, color: unavailable ? "var(--ink-500)" : "var(--aero-orange-700)", fontSize: 12, fontWeight: 800 }}>
                            {unavailable ? variation.unavailableReason || "Unavailable" : `$${getCartLineSubtotal(priceLine).toFixed(2)}`}
                          </div>
                        </button>
                        {active && (
                          <div style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "4px 7px", background: "var(--ink-50)", borderRadius: 999 }}>
                            <button type="button" onClick={() => updateGuestCount(-1)} className="a-btn a-btn--ghost a-btn--sm">-</button>
                            <span style={{ minWidth: 28, textAlign: "center", fontWeight: 900 }}>{guestCount}</span>
                            <button type="button" onClick={() => updateGuestCount(1)} disabled={maxGuestCount && guestCount >= maxGuestCount} className="a-btn a-btn--ghost a-btn--sm">+</button>
                          </div>
                        )}
                      </div>

                      {active && (variation.resourceGroups || []).length > 0 && (
                        <div style={{ marginTop: 12, display: "grid", gap: 8 }}>
                          {(variation.resourceGroups || []).map((group) => {
                            const key = getResourceGroupKey(variation, group);
                            const selectedIds = new Set((resourceSelections[key] || chooseResourceSlots(group, guestCount)).map(String));
                            const selectedNames = (group.options || [])
                              .filter((option) => selectedIds.has(String(option.slotId)))
                              .map((option) => option.resourceName)
                              .filter(Boolean);
                            const isOpen = openResourceGroup === key;
                            return (
                              <div key={key} style={{ border: "1px solid var(--ink-100)", borderRadius: 12, padding: 10, background: "var(--ink-50)" }}>
                                <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
                                  <div>
                                    <div className="eyebrow" style={{ fontSize: 10 }}>{(group.fromTime || "").slice(0, 5)} - {(group.toTime || "").slice(0, 5)}</div>
                                    <div style={{ fontWeight: 800, color: "var(--ink-800)" }}>{selectedNames.join(", ") || "Select resource"}</div>
                                  </div>
                                  <button type="button" className="a-btn a-btn--ghost a-btn--sm" onClick={() => setOpenResourceGroup(isOpen ? null : key)}>
                                    {isOpen ? "Done" : "Edit"}
                                  </button>
                                </div>
                                {isOpen && (
                                  <div style={{ marginTop: 10, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 8 }}>
                                    {(group.options || []).map((option) => {
                                      const selected = selectedIds.has(String(option.slotId));
                                      return (
                                        <button
                                          key={option.slotId || option.resourceId}
                                          type="button"
                                          disabled={!option.isAvailable}
                                          onClick={() => handleResourceSelect(variation, group, option)}
                                          style={{
                                            all: "unset",
                                            cursor: option.isAvailable ? "pointer" : "not-allowed",
                                            border: "1.5px solid",
                                            borderColor: selected ? "var(--aero-orange-600)" : "var(--ink-200)",
                                            borderRadius: 10,
                                            padding: "9px 10px",
                                            background: selected ? "var(--aero-orange-50)" : "white",
                                            opacity: option.isAvailable ? 1 : 0.55,
                                          }}
                                        >
                                          <div style={{ fontWeight: 800 }}>{option.resourceName}</div>
                                          <div style={{ fontSize: 12, color: "var(--ink-500)" }}>
                                            {option.isAvailable ? `Up to ${Number(option.availableCapacity || 0)} guests` : "Unavailable"}
                                          </div>
                                        </button>
                                      );
                                    })}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              <aside style={{ border: "1.5px solid var(--ink-200)", borderRadius: 14, padding: 14, alignSelf: "start", background: "var(--ink-50)" }}>
                <div className="eyebrow">Selection</div>
                <div style={{ marginTop: 6, fontWeight: 900, fontSize: 18 }}>{formatShortDate(selectedDate)}</div>
                <div style={{ marginTop: 4, color: "var(--ink-600)", fontWeight: 700 }}>{timeRangeFromSession(selectedSession)}</div>
                <div style={{ marginTop: 14, display: "grid", gap: 8 }}>
                  <SummaryRow label="Option" value={selectedVariation?.name || "-"} />
                  <SummaryRow label="Guests" value={guestCount} />
                  <SummaryRow label="Slots" value={slotIds.length || "-"} />
                  <SummaryRow label="Line total" value={selectedLine ? `$${getCartLineSubtotal(selectedLine).toFixed(2)}` : "-"} accent="var(--ink-900)" />
                </div>
              </aside>
            </section>
          )}
        </div>

        <div style={{ padding: 18, borderTop: "1px solid var(--ink-100)", display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
          <div style={{ color: "var(--ink-500)", fontWeight: 700 }}>
            {readyToAdd ? "Ready to add to cart" : "Select an available slot to continue"}
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <button type="button" className="a-btn a-btn--ghost" onClick={onClose}>Cancel</button>
            <button type="button" className="a-btn a-btn--primary" disabled={!readyToAdd} onClick={handleAdd}>
              Add to cart
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function EmptyState({ icon, title, text }) {
  return (
    <div style={{ border: "1.5px dashed var(--ink-200)", borderRadius: 14, padding: 28, textAlign: "center", color: "var(--ink-500)" }}>
      <Icon name={icon} size={28} style={{ margin: "0 auto 8px", color: "var(--ink-400)" }} />
      <div style={{ fontWeight: 900, color: "var(--ink-800)" }}>{title}</div>
      <div style={{ marginTop: 4, fontSize: 13 }}>{text}</div>
    </div>
  );
}

function SummaryRow({ label, value, accent }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
      <span style={{ color: "var(--ink-500)", fontWeight: 700 }}>{label}</span>
      <span style={{ color: accent || "var(--ink-800)", fontWeight: 900, textAlign: "right" }}>{value}</span>
    </div>
  );
}
