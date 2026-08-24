import React, { useEffect, useMemo, useState } from "react";
import { useGetAvailabilityQuery } from "../../features/bookings/bookingApi";
import { Icon } from "./Icon";
import {
  clampCartQuantity,
  getCartLineSubtotal,
  getDefaultCartQuantity,
} from "./cartPricing";
import {
  addDays,
  buildChoiceDraftsFromItem,
  buildDefaultResourceSelections,
  buildResourceSelectionsFromSlotIds,
  buildScheduledLine,
  chooseResourceSlots,
  formatDateValue,
  formatShortDate,
  getChoiceGroups,
  getChoiceItemKey,
  getDefaultGuestCount,
  getIncludedItemSummary,
  getInclusionLabel,
  getMaxGuestCount,
  getResourceGroupKey,
  getResourceGroupRoomLimit,
  getSelectedResourceSlots,
  getStartTime,
  getVariationAvailabilitySummary,
  getVariationSlotIds,
  isSessionNotEnded,
  isVariationUnavailable,
  normalizeSlotIds,
  normalizeVariationId,
  sessionMatchesCartLine,
  timeRangeFromSession,
} from "./scheduleHelpers";
import { formatTime12Hour, formatTimeText12Hour } from "../../lib/time";

export function ScheduleRequiredDialog({ item, section, onClose, onAdd }) {
  const initialDate = item?.selectedDate || item?.date || formatDateValue(new Date());
  const [selectedDate, setSelectedDate] = useState(initialDate);
  const [selectedSession, setSelectedSession] = useState(null);
  const [selectedVariationId, setSelectedVariationId] = useState(normalizeVariationId(item?.variationId));
  const [guestCountByVariation, setGuestCountByVariation] = useState({});
  const [choiceSelectionDrafts, setChoiceSelectionDrafts] = useState({});
  const [resourceSelections, setResourceSelections] = useState({});
  const [openResourceGroup, setOpenResourceGroup] = useState(null);
  const [hydratedExistingKey, setHydratedExistingKey] = useState("");

  const activityId = item?.activityId;
  const { data, isFetching, error } = useGetAvailabilityQuery(
    { date: selectedDate, activityId },
    { skip: !activityId }
  );

  const sessionsData = data?.data || data || {};
  const sessions = Array.isArray(sessionsData.sessions) ? sessionsData.sessions : [];

  // For TODAY, offer every slot that hasn't ENDED yet — future slots AND
  // currently-running ones — so a cashier can manually put a walk-in into an
  // ongoing slot at their discretion. The join-grace / min-remaining settings
  // intentionally do NOT apply here; they gate only the auto-assign flow
  // (CashierApp.autoAssignAndAdd). Other dates show every slot. Grid uses
  // `visibleSessions`; matching/hydration keeps the full `sessions` list.
  const isToday = selectedDate === formatDateValue(new Date());
  const nowMinutes = (() => { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); })();
  const visibleSessions = isToday
    ? sessions.filter((s) => isSessionNotEnded(s, nowMinutes))
    : sessions;

  useEffect(() => {
    const slotIds = normalizeSlotIds(item?.slotId);
    if (!slotIds.length || !sessions.length) return;

    const key = `${item?.id || ""}:${selectedDate}:${item?.variationId || ""}:${slotIds.join(",")}`;
    if (hydratedExistingKey === key) return;

    const session =
      sessions.find((candidate) =>
        sessionMatchesCartLine(candidate, item?.variationId, slotIds, item?.timeRange)
      ) || null;
    if (!session) return;

    const variation =
      (session.variations || []).find((candidate) =>
        normalizeVariationId(candidate.variationId) === normalizeVariationId(item?.variationId)
      ) ||
      (session.variations || []).find((candidate) =>
        getVariationSlotIds(candidate).some((slotId) => slotIds.includes(String(slotId)))
      ) ||
      (session.variations || [])[0] ||
      null;
    if (!variation) return;

    const count = clampCartQuantity(
      {
        ...item,
        minGuests: variation.minGuests ?? item?.minGuests ?? null,
        maxGuests: variation.maxGuests ?? item?.maxGuests ?? null,
      },
      item?.qty || getDefaultGuestCount(variation, item)
    );

    setSelectedSession(session);
    setSelectedVariationId(normalizeVariationId(variation.variationId));
    setGuestCountByVariation({ [variation.variationId]: count });
    setResourceSelections(
      item?.resourceSelections && Object.keys(item.resourceSelections).length
        ? item.resourceSelections
        : buildResourceSelectionsFromSlotIds(variation, slotIds, count)
    );
    setChoiceSelectionDrafts(buildChoiceDraftsFromItem(variation, count, item));
    setOpenResourceGroup(null);
    setHydratedExistingKey(key);
  }, [hydratedExistingKey, item, selectedDate, sessions]);
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
  const choiceGroups = useMemo(
    () => selectedVariation ? getChoiceGroups(selectedVariation, guestCount) : [],
    [selectedVariation, guestCount]
  );
  const choiceSelections = useMemo(() => {
    if (!choiceGroups.length || !selectedVariation) return {};
    return choiceGroups.reduce((acc, group) => {
      const key = `${selectedVariation.variationId}:${group.key}`;
      const firstItem = group.items[0];
      const existing = choiceSelectionDrafts[key] || [];
      acc[key] = Array.from({ length: group.choiceQuantity }, (_, index) =>
        Object.prototype.hasOwnProperty.call(existing, index)
          ? existing[index]
          : firstItem ? getChoiceItemKey(firstItem) : ""
      );
      return acc;
    }, {});
  }, [choiceGroups, choiceSelectionDrafts, selectedVariation]);
  const choiceReady = !choiceGroups.some((group) =>
    (choiceSelections[`${selectedVariation?.variationId}:${group.key}`] || []).filter(Boolean).length !== group.choiceQuantity
  );
  const readyToAdd = Boolean(selectedSession && selectedVariation && slotIds.length > 0 && guestCount > 0 && choiceReady);
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
    setChoiceSelectionDrafts({});
    setOpenResourceGroup(null);
  };

  const handleVariationPick = (variation) => {
    if (isVariationUnavailable(variation)) return;
    const nextCount =
      guestCountByVariation[variation.variationId] || getDefaultGuestCount(variation, item);
    setSelectedVariationId(normalizeVariationId(variation.variationId));
    setGuestCountByVariation({ [variation.variationId]: nextCount });
    setResourceSelections(buildDefaultResourceSelections(variation, nextCount));
    setChoiceSelectionDrafts({});
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
    const resolvedChoiceSelections = choiceGroups.reduce((acc, group) => {
      acc[group.key] = choiceSelections[`${selectedVariation.variationId}:${group.key}`] || [];
      return acc;
    }, {});
    const nextItem = buildScheduledLine({
      item,
      section,
      selectedDate,
      session: selectedSession,
      variation: selectedVariation,
      guestCount,
      slotIds,
      resourceSelections,
      resolvedChoiceSelections,
      hasChoiceGroups: choiceGroups.length > 0,
    });
    onAdd?.(nextItem, section);
    onClose?.();
  };

  const handleChoiceSelect = (group, index, itemKey) => {
    if (!selectedVariation) return;
    const key = `${selectedVariation.variationId}:${group.key}`;
    setChoiceSelectionDrafts((prev) => {
      const current = prev[key] || [];
      const next = Array.from({ length: group.choiceQuantity }, (_, idx) => current[idx] || "");
      next[index] = itemKey;
      return { ...prev, [key]: next };
    });
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
                  setChoiceSelectionDrafts({});
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
            ) : visibleSessions.length === 0 ? (
              <EmptyState
                icon="calendar-x"
                title={isToday && sessions.length > 0 ? "No more slots today" : "No slots found"}
                text={isToday && sessions.length > 0
                  ? "Today's remaining slots have passed. Pick another day."
                  : "This product has no active slots on this date."}
              />
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(132px, 1fr))", gap: 10 }}>
                {visibleSessions.map((session) => {
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
                      <div style={{ fontWeight: 900, color: "var(--ink-900)" }}>{formatTime12Hour(getStartTime(session))}</div>
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
                  const availabilitySummary = getVariationAvailabilitySummary(variation, selectedSession);
                  const includedItems = getIncludedItemSummary(variation, lineQty);
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
                          {availabilitySummary && (
                            <div style={{ marginTop: 3, color: unavailable ? "var(--ink-500)" : "var(--ink-600)", fontSize: 12, fontWeight: 700, lineHeight: 1.35 }}>
                              {availabilitySummary}
                            </div>
                          )}
                          {includedItems.length > 0 && (
                            <div style={{ marginTop: 8 }}>
                              <div style={{ fontSize: 10, fontWeight: 900, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--ink-500)", marginBottom: 5 }}>
                                Includes
                              </div>
                              <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
                                {includedItems.slice(0, 5).map((includedItem) => (
                                  <span
                                    key={includedItem.key}
                                    style={{
                                      padding: "3px 7px",
                                      borderRadius: 999,
                                      background: "var(--aero-orange-50)",
                                      color: "var(--aero-orange-700)",
                                      border: "1px solid var(--aero-orange-100)",
                                      fontSize: 11,
                                      fontWeight: 800,
                                    }}
                                  >
                                    {includedItem.quantity} x {includedItem.label}
                                  </span>
                                ))}
                                {includedItems.length > 5 && (
                                  <span style={{ fontSize: 11, fontWeight: 800, color: "var(--ink-500)", alignSelf: "center" }}>
                                    +{includedItems.length - 5} more
                                  </span>
                                )}
                              </div>
                            </div>
                          )}
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
                                    <div className="eyebrow" style={{ fontSize: 10 }}>{formatTimeText12Hour(`${(group.fromTime || "").slice(0, 5)} - ${(group.toTime || "").slice(0, 5)}`)}</div>
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

                      {active && choiceGroups.length > 0 && (
                        <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
                          {choiceGroups.map((group) => {
                            const selectionKey = `${variation.variationId}:${group.key}`;
                            const current = choiceSelections[selectionKey] || [];
                            return (
                              <div key={group.key} style={{ border: "1px solid var(--ink-100)", borderRadius: 12, padding: 10, background: "var(--ink-50)" }}>
                                <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", marginBottom: 8 }}>
                                  <div>
                                    <div className="eyebrow" style={{ fontSize: 10 }}>Choose {group.label}</div>
                                    <div style={{ fontWeight: 850, color: "var(--ink-800)", fontSize: 13 }}>
                                      Select {group.choiceQuantity}
                                    </div>
                                  </div>
                                  <span style={{ fontSize: 11, fontWeight: 900, color: current.filter(Boolean).length === group.choiceQuantity ? "var(--color-success)" : "var(--aero-orange-700)" }}>
                                    {current.filter(Boolean).length}/{group.choiceQuantity}
                                  </span>
                                </div>
                                <div style={{ display: "grid", gap: 6 }}>
                                  {group.items.map((choiceItem) => {
                                    const itemKey = getChoiceItemKey(choiceItem);
                                    const selectedCount = current.filter((selectedKey) => selectedKey === itemKey).length;
                                    const canIncrease = current.filter(Boolean).length < group.choiceQuantity || group.choiceQuantity === 1;
                                    return (
                                      <div key={itemKey} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, background: "white", border: "1px solid var(--ink-100)", borderRadius: 10, padding: "8px 10px" }}>
                                        <div style={{ minWidth: 0 }}>
                                          <div style={{ fontSize: 12, fontWeight: 850, color: "var(--ink-900)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                            {getInclusionLabel(choiceItem)}
                                          </div>
                                        </div>
                                        <div style={{ display: "grid", gridTemplateColumns: "30px 30px 30px", overflow: "hidden", border: "1px solid var(--ink-200)", borderRadius: 8, flex: "0 0 auto" }}>
                                          <button
                                            type="button"
                                            onClick={() => {
                                              const index = current.lastIndexOf(itemKey);
                                              if (index === -1) return;
                                              handleChoiceSelect(group, index, "");
                                            }}
                                            disabled={selectedCount <= 0}
                                            style={{ border: 0, background: "var(--ink-50)", fontWeight: 900, cursor: selectedCount <= 0 ? "not-allowed" : "pointer", opacity: selectedCount <= 0 ? 0.45 : 1 }}
                                          >
                                            -
                                          </button>
                                          <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", background: "white", fontSize: 12, fontWeight: 900 }}>
                                            {selectedCount}
                                          </span>
                                          <button
                                            type="button"
                                            onClick={() => {
                                              if (!canIncrease) return;
                                              const nextIndex = current.findIndex((selectedKey) => !selectedKey);
                                              handleChoiceSelect(group, nextIndex === -1 ? 0 : nextIndex, itemKey);
                                            }}
                                            disabled={!canIncrease}
                                            style={{ border: 0, background: "white", fontWeight: 900, cursor: !canIncrease ? "not-allowed" : "pointer", opacity: !canIncrease ? 0.45 : 1 }}
                                          >
                                            +
                                          </button>
                                        </div>
                                      </div>
                                    );
                                  })}
                                </div>
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
                <div style={{ marginTop: 4, color: "var(--ink-600)", fontWeight: 700 }}>{formatTimeText12Hour(timeRangeFromSession(selectedSession))}</div>
                <div style={{ marginTop: 14, display: "grid", gap: 8 }}>
                  <SummaryRow label="Option" value={selectedVariation?.name || "-"} />
                  <SummaryRow label="Available" value={selectedVariation ? getVariationAvailabilitySummary(selectedVariation, selectedSession) : "-"} />
                  <SummaryRow label="Guests" value={guestCount} />
                  <SummaryRow label="Slots" value={slotIds.length || "-"} />
                  <SummaryRow label="Line total" value={selectedLine ? `$${getCartLineSubtotal(selectedLine).toFixed(2)}` : "-"} accent="var(--ink-900)" />
                </div>
                {selectedVariation && getIncludedItemSummary(selectedVariation, guestCount).length > 0 && (
                  <div style={{ marginTop: 14 }}>
                    <div className="eyebrow" style={{ fontSize: 10, marginBottom: 7 }}>Includes</div>
                    <div style={{ display: "grid", gap: 6 }}>
                      {getIncludedItemSummary(selectedVariation, guestCount).slice(0, 6).map((includedItem) => (
                        <div key={includedItem.key} style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: 12 }}>
                          <span style={{ color: "var(--ink-600)", fontWeight: 750 }}>{includedItem.label}</span>
                          <span style={{ color: "var(--ink-900)", fontWeight: 900 }}>{includedItem.quantity}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
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
              {normalizeSlotIds(item?.slotId).length ? "Update cart" : "Add to cart"}
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
