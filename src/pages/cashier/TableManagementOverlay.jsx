import React, { useState } from "react";
import { useGetTablesQuery, useGenerateTablesMutation, useDeleteTableMutation } from "../../features/ordering/orderingApi";
import { QRCodeSVG } from "qrcode.react";
import { Icon } from "./Icon";

export default function TableManagementOverlay({ onClose }) {
  const { data: tableData, isLoading } = useGetTablesQuery();
  const [generateTables] = useGenerateTablesMutation();
  const [deleteTable] = useDeleteTableMutation();

  const [tableCount, setTableCount] = useState(10);
  const tables = tableData?.data || [];

  const handleGenerateTables = async () => {
    if (!tableCount || tableCount < 1) return;
    try {
      await generateTables(tableCount).unwrap();
      setTableCount("");
      alert("Tables generated successfully!");
    } catch (err) {
      console.error(err);
      alert(`Error generating tables: ${err.message || err.data?.error || JSON.stringify(err)}`);
    }
  };

  const handlePrintQR = (table) => {
    const printWindow = window.open('', '', 'width=600,height=600');
    const qrUrl = `${window.location.origin}${table.qrCodeUrl}`;
    printWindow.document.write(`
      <html>
        <head>
          <title>Print QR - Table ${table.tableNumber}</title>
          <style>
            body { font-family: sans-serif; display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; margin: 0; }
            h1 { margin-bottom: 20px; font-size: 32px; }
            .qr-container { padding: 40px; border: 4px solid #000; border-radius: 20px; }
            p { margin-top: 20px; font-size: 18px; color: #555; }
          </style>
        </head>
        <body>
          <h1>Table ${table.tableNumber}</h1>
          <div class="qr-container">
            <img src="https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(qrUrl)}" alt="QR Code" />
          </div>
          <p>Scan to view menu and order!</p>
          <script>
            window.onload = () => { setTimeout(() => { window.print(); window.close(); }, 500); };
          </script>
        </body>
      </html>
    `);
    printWindow.document.close();
  };

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 1000,
      background: "var(--ink-25)", display: "flex", flexDirection: "column"
    }}>
      <header style={{
        height: 72, background: "var(--ink-0)", borderBottom: "1px solid var(--ink-100)",
        display: "flex", alignItems: "center", padding: "0 28px", gap: 20, flexShrink: 0,
      }}>
        <div style={{ flex: 1 }}>
          <h1 style={{ margin: 0, fontFamily: "var(--font-display)", fontWeight: 800, fontSize: 26, letterSpacing: "-.02em" }}>Table QR Codes</h1>
        </div>
        <button onClick={onClose} className="a-btn" style={{
          height: 40, padding: "0 16px", borderRadius: 20, background: "var(--ink-100)", color: "var(--ink-800)",
          display: "flex", alignItems: "center", justifyContent: "center", border: "none", cursor: "pointer", gap: 8, fontWeight: 700
        }}>
          <Icon name="chevron-left" size={20} /> Go back
        </button>
      </header>

      <div style={{ flex: 1, overflowY: "auto", padding: 28 }}>
        <div style={{ display: "flex", gap: 16, marginBottom: 32, alignItems: "flex-end", background: "white", padding: 16, borderRadius: 12, border: "1px solid var(--ink-100)" }}>
          <div style={{ flex: 1, maxWidth: 300 }}>
            <label style={{ display: "block", fontSize: 13, fontWeight: 700, marginBottom: 8, color: "var(--ink-600)" }}>Generate Tables (Quantity)</label>
            <input type="number" min="1" max="100" value={tableCount} onChange={e => setTableCount(Number(e.target.value))}
              style={{ width: "100%", padding: "10px 12px", border: "1.5px solid var(--ink-200)", borderRadius: 8, fontSize: 15, outline: "none" }}
            />
          </div>
          <button onClick={handleGenerateTables} disabled={!tableCount || tableCount < 1} className="a-btn a-btn--primary" style={{ height: 44, padding: "0 24px" }}>
            Generate
          </button>
        </div>

        {isLoading ? (
          <div style={{ padding: 40, textAlign: "center", color: "var(--ink-500)" }}>Loading...</div>
        ) : tables.length === 0 ? (
          <div style={{ padding: 40, textAlign: "center", color: "var(--ink-500)" }}>No tables created yet.</div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(250px, 1fr))", gap: 24 }}>
            {tables.map(table => {
              const origin = window.location.origin.replace("5173", "5172").replace("5174", "5172");
              const fullUrl = `${origin}${table.qrCodeUrl}`;
              return (
                <div key={table.id} style={{
                  background: "white", border: "1px solid var(--ink-100)", borderRadius: 16, padding: 24,
                  display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center"
                }}>
                  <h3 style={{ margin: "0 0 16px 0", fontSize: 20, fontWeight: 800 }}>Table {table.tableNumber}</h3>
                  <div style={{ padding: 12, border: "1px solid var(--ink-100)", borderRadius: 12, marginBottom: 8 }}>
                    <QRCodeSVG value={fullUrl} size={150} level="H" />
                  </div>
                  <a href={fullUrl} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: "var(--primary-600)", textDecoration: "underline", marginBottom: 16, wordBreak: "break-all" }}>
                    {fullUrl}
                  </a>
                  <div style={{ display: "flex", gap: 8, width: "100%", marginTop: "auto" }}>
                    <button onClick={() => handlePrintQR(table)} className="a-btn" style={{ flex: 1, background: "var(--ink-50)", border: "none", color: "var(--ink-800)" }}>
                      Print
                    </button>
                    <button onClick={() => { if(window.confirm('Delete table?')) deleteTable(table.id) }} className="a-btn" style={{ flex: 1, background: "var(--alert-50)", border: "none", color: "var(--alert-600)" }}>
                      Delete
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
