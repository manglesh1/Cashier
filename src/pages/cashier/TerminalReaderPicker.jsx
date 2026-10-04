import React, { useEffect, useRef, useState } from "react";
import { useGetTerminalReadersQuery } from "../../features/payments/terminalApi";
import { Icon } from "./Icon";

export default function TerminalReaderPicker({ posDeviceId, locationId, currency, preferredId, autoUseDefault = false, onSelect, onClose }) {
  const [selection, setSelection] = useState(null);
  const onSelectRef = useRef(onSelect);
  useEffect(() => { onSelectRef.current = onSelect; }, [onSelect]);
  const { currentData, isFetching, error, refetch } = useGetTerminalReadersQuery(
    { posDeviceId, locationId, currency },
    { skip: !posDeviceId, pollingInterval: 15000, skipPollingIfUnfocused: true, refetchOnMountOrArgChange: true },
  );
  const readers = currentData?.data?.readers || [];
  const defaultId = preferredId || currentData?.data?.defaultTerminalId;
  const preferred = readers.find(r => String(r.terminalId) === String(defaultId));
  const selectedId = selection ?? String(preferred?.terminalId || "");
  const selected = readers.find(r => String(r.terminalId) === selectedId);
  const problem = !posDeviceId ? "Pair this POS station before taking card payments."
    : error ? error?.data?.message || "Could not refresh the card readers."
      : !isFetching && !readers.length ? "No card readers configured for this POS station." : null;

  useEffect(() => {
    if (!autoUseDefault || !posDeviceId) return;
    let closed = false;
    // Use a fresh response, never the payment panel's cached default.
    refetch().unwrap().then(response => {
      const id = preferredId || response?.data?.defaultTerminalId;
      const reader = response?.data?.readers?.find(row => String(row.terminalId) === String(id));
      if (!closed && reader?.selectable) onSelectRef.current(reader);
    }).catch(() => { /* The picker displays the query error; refresh never starts a charge. */ });
    return () => { closed = true; };
  }, [autoUseDefault, posDeviceId, preferredId, refetch]);

  return <div style={{ textAlign: "left" }}>
    <h2 style={{ fontSize: 20, margin: "0 0 16px" }}>Choose card reader</h2>
    <div style={{ display: "flex", gap: 8, alignItems: "end" }}>
      <label style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: 700 }}>
        Card reader
        <select aria-label="Card reader" value={selectedId} onChange={event => setSelection(event.target.value)}
          disabled={!readers.length || isFetching}
          style={{ display: "block", width: "100%", minHeight: 44, marginTop: 6, border: "1px solid #CBD5E1", borderRadius: 6, padding: 8, background: "white", color: "#111827", fontSize: 14 }}>
          <option value="">{isFetching ? "Loading readers..." : readers.length ? "Select a reader" : "No readers"}</option>
          {readers.map(reader => <option key={reader.terminalId} value={reader.terminalId} disabled={!reader.selectable}>
            {reader.displayName}{reader.isDefault ? " (default)" : ""} - {reader.availabilityLabel}
          </option>)}
        </select>
      </label>
      <button type="button" className="a-btn" title="Refresh reader availability" aria-label="Refresh reader availability"
        disabled={!posDeviceId || isFetching} onClick={() => refetch()} style={{ width: 44, height: 44, padding: 0, justifyContent: "center", flexShrink: 0 }}>
        <Icon name="refresh-cw" size={18} />
      </button>
    </div>
    {selected && <div style={{ marginTop: 12, fontSize: 13, overflowWrap: "anywhere" }}>
      <div>{[selected.model, selected.serialNumber].filter(Boolean).join(" / ") || `Terminal ${selected.providerTerminalId}`}</div>
      <div role="status" style={{ color: selected.selectable ? "#475569" : "#B91C1C", marginTop: 6 }}>{selected.availabilityLabel}</div>
    </div>}
    {problem && <p role="alert" style={{ color: "#B91C1C", fontSize: 13 }}>{problem}</p>}
    {!problem && !preferred && !selection && !isFetching && <p role="status" style={{ fontSize: 13, color: "#B91C1C" }}>
      {preferredId ? "The selected reader is no longer available." : currentData?.data?.defaultReaderIssue || "No default reader configured."}
    </p>}
    <div style={{ display: "flex", gap: 8, marginTop: 20 }}>
      <button type="button" className="a-btn" onClick={onClose} style={{ flex: 1, justifyContent: "center", minHeight: 44 }}>Close</button>
      <button type="button" className="a-btn a-btn--primary" disabled={!!problem || isFetching || !selected?.selectable}
        onClick={() => onSelect(selected)} style={{ flex: 1, justifyContent: "center", minHeight: 44 }}>
        <Icon name="credit-card" size={16} /> Use reader
      </button>
    </div>
  </div>;
}
