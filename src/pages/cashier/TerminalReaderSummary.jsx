import React, { useState } from "react";
import { useGetTerminalReadersQuery } from "../../features/payments/terminalApi";
import TerminalReaderPicker from "./TerminalReaderPicker";
import { Icon } from "./Icon";

export default function TerminalReaderSummary({ posDeviceId, locationId, overrideId, onChange, locked }) {
  const [changing, setChanging] = useState(false);
  const { currentData, error, isFetching } = useGetTerminalReadersQuery(
    { posDeviceId, locationId },
    { skip: !posDeviceId || locked, refetchOnMountOrArgChange: true, pollingInterval: 15000, skipPollingIfUnfocused: true },
  );
  const data = currentData?.data;
  const reader = data?.readers?.find(row => String(row.terminalId) === String(overrideId || data.defaultTerminalId));
  return <div style={{ marginTop: 10, fontSize: 12, fontWeight: 400, overflowWrap: "anywhere" }}>
    <div style={{ fontWeight: 700 }}>Card reader</div>
    <div>{locked ? "Reader selection locked" : reader?.displayName || (isFetching ? "Loading reader..." : "No default reader available")}</div>
    {!locked && reader && <div>{[reader.model, reader.serialNumber].filter(Boolean).join(" / ") || reader.providerTerminalId}</div>}
    {!locked && <div style={{ marginTop: 4 }}>{error ? "Could not load reader settings." : reader?.availabilityLabel || data?.defaultReaderIssue}</div>}
    <button type="button" className="a-btn" disabled={locked || !posDeviceId}
      onClick={() => setChanging(true)} style={{ marginTop: 8, minHeight: 36, fontSize: 12 }}>
      <Icon name="credit-card" size={14} /> Change reader
    </button>
    {overrideId && !locked && <button type="button" className="a-btn" onClick={() => onChange(null)}
      style={{ marginTop: 8, minHeight: 36, fontSize: 12 }}>Use Admin default</button>}
    {changing && !locked && <div role="dialog" aria-modal="true" aria-label="Change card reader"
      style={{ position: "fixed", inset: 0, zIndex: 1300, background: "rgba(8,12,20,.55)", display: "grid", placeItems: "center", padding: 16 }}>
      <div style={{ background: "white", padding: 24, borderRadius: 8, width: 380, maxWidth: "100%", boxSizing: "border-box", maxHeight: "calc(100dvh - 32px)", overflowY: "auto" }}>
        <TerminalReaderPicker posDeviceId={posDeviceId} locationId={locationId} preferredId={overrideId}
          onSelect={selected => { onChange(selected.terminalId); setChanging(false); }} onClose={() => setChanging(false)} />
      </div>
    </div>}
  </div>;
}
