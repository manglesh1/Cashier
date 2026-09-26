import React, { useState, useMemo } from "react";
import { useGetActiveOrdersQuery, useUpdateOrderStatusMutation } from "../../features/ordering/orderingApi";
import { Icon } from "./Icon";
import { toast } from "sonner";

export default function LiveOrdersOverlay({ onClose }) {
  const { data: ordersData, isLoading } = useGetActiveOrdersQuery(undefined, { pollingInterval: 10000 });
  const [updateStatus] = useUpdateOrderStatusMutation();

  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [historyPage, setHistoryPage] = useState(1);
  const [searchQuery, setSearchQuery] = useState("");
  const HISTORY_PAGE_SIZE = 15;

  const [activePage, setActivePage] = useState(1);
  const [activeSearchQuery, setActiveSearchQuery] = useState("");
  const ACTIVE_PAGE_SIZE = 12;

  // New Filters
  const [activeFilterTable, setActiveFilterTable] = useState("");
  const [activeFilterDate, setActiveFilterDate] = useState("");
  const [historyFilterTable, setHistoryFilterTable] = useState("");
  const [historyFilterDate, setHistoryFilterDate] = useState("");
  const [historyFilterStatus, setHistoryFilterStatus] = useState("");

  const orders = ordersData?.data || [];

  const allTables = useMemo(() => {
    const tables = new Set();
    orders.forEach(o => {
      if (o.table?.tableNumber) tables.add(o.table.tableNumber);
    });
    return Array.from(tables).sort((a,b) => a - b);
  }, [orders]);
  
  const groupOrders = (ordersList) => {
    const timeThresholdMs = 15 * 60 * 1000; // 15 mins
    const groups = [];
    ordersList.forEach(order => {
      const group = groups.find(g => {
        const timeDiff = Math.abs(new Date(order.createdAt) - new Date(g.createdAt));
        return (
          g.table?.id === order.table?.id &&
          g.status === order.status &&
          g.paymentStatus === order.paymentStatus &&
          timeDiff <= timeThresholdMs
        );
      });

      if (group) {
        group.id = Array.isArray(group.id) ? [...group.id, order.id] : [group.id, order.id];
        group.totalAmount = Number(group.totalAmount) + Number(order.totalAmount);
        group.items = [...(group.items || []), ...(order.items || [])];
        if (new Date(order.createdAt) < new Date(group.createdAt)) {
          group.createdAt = order.createdAt;
        }
      } else {
        groups.push({
          ...order,
          id: [order.id],
          items: [...(order.items || [])],
        });
      }
    });
    return groups;
  };

  // Active Orders (Not Delivered or Not Paid)
  const activeOrders = useMemo(() => {
    const active = orders
      .filter(o => o.status !== "DELIVERED" || o.paymentStatus !== "PAID")
      .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt)); // Oldest first
    
    return groupOrders(active);
  }, [orders]);

  const filteredActiveOrders = useMemo(() => {
    return activeOrders.filter(o => {
      const q = activeSearchQuery.toLowerCase();
      const tableStr = String(o.table?.tableNumber || "");
      const orderIdStr = Array.isArray(o.id) ? o.id.join(" ") : String(o.id || "");
      const itemsStr = (o.items || []).map(i => (i.inventoryItem?.name || i.variation?.name || "")).join(" ").toLowerCase();
      
      const matchesSearch = !q || tableStr.includes(q) || orderIdStr.includes(q) || itemsStr.includes(q);
      const matchesTable = !activeFilterTable || String(o.table?.tableNumber) === activeFilterTable;
      
      let matchesDate = true;
      if (activeFilterDate) {
        const d = new Date(o.createdAt); const orderDate = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        matchesDate = orderDate === activeFilterDate;
      }

      return matchesSearch && matchesTable && matchesDate;
    });
  }, [activeOrders, activeSearchQuery, activeFilterTable, activeFilterDate]);

  const activeTotalPages = Math.max(1, Math.ceil(filteredActiveOrders.length / ACTIVE_PAGE_SIZE));
  const activeStart = (activePage - 1) * ACTIVE_PAGE_SIZE;
  const paginatedActiveOrders = filteredActiveOrders.slice(activeStart, activeStart + ACTIVE_PAGE_SIZE);

  // Past Orders
  const pastOrders = useMemo(() => {
    const past = orders
      .filter(o => o.status === "DELIVERED" && o.paymentStatus === "PAID")
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)); // Newest first for history
    
    return groupOrders(past);
  }, [orders]);

  const filteredPastOrders = useMemo(() => {
    return pastOrders.filter(o => {
      const q = searchQuery.toLowerCase();
      const tableStr = String(o.table?.tableNumber || "");
      const orderIdStr = Array.isArray(o.id) ? o.id.join(" ") : String(o.id || "");
      const itemsStr = (o.items || []).map(i => (i.inventoryItem?.name || i.variation?.name || "")).join(" ").toLowerCase();
      const statusStr = String(o.status || "").toLowerCase();
      const paymentStr = String(o.paymentStatus || "").toLowerCase();
      
      const matchesSearch = !q || tableStr.includes(q) || orderIdStr.includes(q) || itemsStr.includes(q) || statusStr.includes(q) || paymentStr.includes(q);
      const matchesTable = !historyFilterTable || String(o.table?.tableNumber) === historyFilterTable;
      
      let matchesDate = true;
      if (historyFilterDate) {
        const d = new Date(o.createdAt); const orderDate = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        matchesDate = orderDate === historyFilterDate;
      }
      
      let matchesStatus = true;
      if (historyFilterStatus) {
        matchesStatus = o.status === historyFilterStatus || o.paymentStatus === historyFilterStatus;
      }

      return matchesSearch && matchesTable && matchesDate && matchesStatus;
    });
  }, [pastOrders, searchQuery, historyFilterTable, historyFilterDate, historyFilterStatus]);

  const historyTotalPages = Math.max(1, Math.ceil(filteredPastOrders.length / HISTORY_PAGE_SIZE));
  const historyStart = (historyPage - 1) * HISTORY_PAGE_SIZE;
  const paginatedPastOrders = filteredPastOrders.slice(historyStart, historyStart + HISTORY_PAGE_SIZE);

  const handleUpdate = async (ids, updates) => {
    try {
      const idArray = Array.isArray(ids) ? ids : [ids];
      await Promise.all(idArray.map(id => updateStatus({ id, ...updates }).unwrap()));
      toast.success("Order updated");
    } catch (err) {
      console.error(err);
      toast.error("Failed to update order");
    }
  };

  const OrderCard = ({ order }) => {
    const isPaid = order.paymentStatus === "PAID";
    const isDelivered = order.status === "DELIVERED";
    const totalQty = order.items?.reduce((sum, i) => sum + i.quantity, 0) || 0;

    // Calculate elapsed time for active orders
    const elapsedMs = new Date() - new Date(order.createdAt);
    const elapsedMins = Math.floor(elapsedMs / 60000);
    const isUrgent = elapsedMins >= 15; // Mark as urgent if waiting more than 15 mins

    return (
      <div style={{
        border: "1px solid var(--ink-200)", borderRadius: 12, overflow: "hidden", display: "flex", flexDirection: "column",
        background: isPaid && isDelivered ? "var(--ink-50)" : "white",
        opacity: isPaid && isDelivered ? 0.7 : 1,
        boxShadow: isUrgent && !isDelivered ? "0 0 0 2px var(--alert-500)" : "none"
      }}>
        <div style={{ background: "var(--ink-800)", color: "white", padding: 16, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <h3 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>Table {order.table?.tableNumber || "?"}</h3>
            <div style={{ fontSize: 17, fontWeight: 700, color: isUrgent ? "var(--alert-300)" : "var(--ink-200)", marginTop: 4, display: "flex", alignItems: "center", gap: 4 }}>
              <Icon name="clock" size={14} />
              {new Date(order.createdAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true })}
              <span style={{ fontSize: 12, fontWeight: 600, opacity: 0.8, marginLeft: 4 }}>({elapsedMins}m ago)</span>
            </div>
          </div>
          <div style={{ textAlign: "right" }}>
            <span style={{ fontSize: 18, fontWeight: 800 }}>${Number(order.totalAmount).toFixed(2)}</span>
            <div style={{ fontSize: 12, color: "var(--ink-300)", marginTop: 4 }}>{totalQty} items</div>
          </div>
        </div>

        <div style={{ padding: 16, flex: 1 }}>
          <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {order.items?.map((item, idx) => (
              <li key={idx} style={{ display: "flex", justifyContent: "space-between", fontSize: 14, fontWeight: 600, borderBottom: "1px solid var(--ink-100)", paddingBottom: 8, marginBottom: 8 }}>
                <span style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <span style={{ background: "var(--ink-100)", color: "var(--ink-700)", padding: "2px 6px", borderRadius: 4, fontWeight: 800 }}>{item.quantity}x</span> 
                  {item.inventoryItem?.name || item.variation?.name || "Unknown"}
                </span>
                <span style={{ color: "var(--ink-500)" }}>${Number(item.unitPrice).toFixed(2)}</span>
              </li>
            ))}
          </ul>
        </div>

        <div style={{ padding: 16, background: "var(--ink-50)", borderTop: "1px solid var(--ink-100)", display: "flex", gap: 8, marginTop: "auto" }}>
          <button
            disabled={isPaid}
            onClick={() => handleUpdate(order.id, { paymentStatus: "PAID" })}
            className="a-btn"
            style={{
              flex: 1, padding: "10px", borderRadius: 8, fontWeight: 800, fontSize: 14,
              background: isPaid ? "var(--success-100)" : "white",
              color: isPaid ? "var(--success-700)" : "var(--ink-800)",
              border: isPaid ? "none" : "1px solid var(--ink-200)",
              cursor: isPaid ? "not-allowed" : "pointer"
            }}
          >
            {isPaid ? "PAID" : "Mark Paid"}
          </button>
          
          <button
            disabled={isDelivered}
            onClick={() => handleUpdate(order.id, { status: "DELIVERED" })}
            className="a-btn"
            style={{
              flex: 1, padding: "10px", borderRadius: 8, fontWeight: 800, fontSize: 14,
              background: isDelivered ? "var(--success-100)" : "var(--ink-800)",
              color: isDelivered ? "var(--success-700)" : "white",
              border: "none",
              cursor: isDelivered ? "not-allowed" : "pointer"
            }}
          >
            {isDelivered ? "SERVED" : "Serve"}
          </button>
        </div>
      </div>
    );
  };

  return (
    <>
    <div style={{
      position: "fixed", inset: 0, zIndex: 1000,
      background: "var(--ink-25)", display: "flex", flexDirection: "column"
    }}>
      <header style={{
        height: 72, background: "var(--ink-0)", borderBottom: "1px solid var(--ink-100)",
        display: "flex", alignItems: "center", padding: "0 28px", gap: 20, flexShrink: 0,
      }}>
        <div style={{ flex: 1 }}>
          <h1 style={{ margin: 0, fontFamily: "var(--font-display)", fontWeight: 800, fontSize: 26, letterSpacing: "-.02em" }}>Live QR Orders</h1>
        </div>
        
        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <div style={{ width: 220 }}>
            <input 
              type="text" 
              placeholder="Search orders..." 
              value={activeSearchQuery}
              onChange={e => { setActiveSearchQuery(e.target.value); setActivePage(1); }}
              style={{ width: "100%", padding: "8px 16px", borderRadius: 20, border: "1.5px solid var(--ink-200)", fontSize: 14, outline: "none" }}
            />
          </div>
          <select 
            value={activeFilterTable} 
            onChange={e => { setActiveFilterTable(e.target.value); setActivePage(1); }}
            style={{ padding: "8px 12px", borderRadius: 12, border: "1.5px solid var(--ink-200)", fontSize: 14, outline: "none", background: "white" }}
          >
            <option value="">All Tables</option>
            {allTables.map(t => <option key={t} value={t}>Table {t}</option>)}
          </select>
          <input 
            type="date"
            value={activeFilterDate}
            onChange={e => { setActiveFilterDate(e.target.value); setActivePage(1); }}
            style={{ padding: "8px 12px", borderRadius: 12, border: "1.5px solid var(--ink-200)", fontSize: 14, outline: "none", background: "white" }}
          />
        </div>

        <button onClick={() => setIsHistoryOpen(true)} className="a-btn" style={{ height: 40, padding: "0 16px", borderRadius: 20, background: "var(--ink-800)", color: "white", display: "flex", alignItems: "center", justifyContent: "center", border: "none", cursor: "pointer", gap: 8, fontWeight: 700 }}>
          <Icon name="history" size={16} /> Order History
        </button>
        <button onClick={onClose} className="a-btn" style={{
          height: 40, padding: "0 16px", borderRadius: 20, background: "var(--ink-100)", color: "var(--ink-800)",
          display: "flex", alignItems: "center", justifyContent: "center", border: "none", cursor: "pointer", gap: 8, fontWeight: 700
        }}>
          <Icon name="chevron-left" size={20} /> Go back
        </button>
      </header>

      <div style={{ flex: 1, overflowY: "auto", padding: 28, display: "flex", flexDirection: "column" }}>
        {isLoading ? (
          <div style={{ padding: 40, textAlign: "center", color: "var(--ink-500)" }}>Loading...</div>
        ) : (
          <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
            <h2 style={{ fontSize: 20, fontWeight: 800, color: "var(--ink-800)", marginBottom: 16, display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ width: 12, height: 12, borderRadius: "50%", background: "var(--alert-500)", display: "inline-block" }}></span>
              Active Orders ({filteredActiveOrders.length})
            </h2>
            
            <div style={{ flex: 1 }}>
              {filteredActiveOrders.length === 0 ? (
                <div style={{ background: "white", border: "1px solid var(--ink-200)", borderRadius: 12, padding: 48, textAlign: "center", color: "var(--ink-500)" }}>
                  No active orders right now matching your filters.
                </div>
              ) : (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 16 }}>
                  {paginatedActiveOrders.map(order => (
                    <OrderCard key={Array.isArray(order.id) ? order.id[0] : order.id} order={order} />
                  ))}
                </div>
              )}
            </div>

            {activeTotalPages > 1 && (
              <div style={{ marginTop: 24, paddingTop: 24, borderTop: "1px solid var(--ink-200)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: 14, color: "var(--ink-500)" }}>
                  Showing {activeStart + 1}–{Math.min(activeStart + ACTIVE_PAGE_SIZE, filteredActiveOrders.length)} of {filteredActiveOrders.length} active orders
                </span>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <button onClick={() => setActivePage(p => Math.max(1, p - 1))} disabled={activePage === 1} style={{ padding: "8px 16px", borderRadius: 8, border: "1px solid var(--ink-200)", background: activePage === 1 ? "var(--ink-50)" : "white", color: "var(--ink-800)", cursor: activePage === 1 ? "not-allowed" : "pointer", fontWeight: 700 }}>← Prev</button>
                  <span style={{ fontSize: 14, fontWeight: 700, padding: "0 8px" }}>Page {activePage} of {activeTotalPages}</span>
                  <button onClick={() => setActivePage(p => Math.min(activeTotalPages, p + 1))} disabled={activePage === activeTotalPages} style={{ padding: "8px 16px", borderRadius: 8, border: "1px solid var(--ink-200)", background: activePage === activeTotalPages ? "var(--ink-50)" : "white", color: "var(--ink-800)", cursor: activePage === activeTotalPages ? "not-allowed" : "pointer", fontWeight: 700 }}>Next →</button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>

    {isHistoryOpen && (
      <div style={{ position: "fixed", inset: 0, zIndex: 1100, background: "white", display: "flex", flexDirection: "column" }}>
        <header style={{ height: 72, background: "var(--ink-0)", borderBottom: "1px solid var(--ink-100)", display: "flex", alignItems: "center", padding: "0 28px", gap: 20, flexShrink: 0 }}>
          <div style={{ flex: 1 }}>
            <h1 style={{ margin: 0, fontFamily: "var(--font-display)", fontWeight: 800, fontSize: 26, letterSpacing: "-.02em" }}>Order History</h1>
          </div>
          <button onClick={() => setIsHistoryOpen(false)} className="a-btn" style={{ height: 40, padding: "0 16px", borderRadius: 20, background: "var(--ink-100)", color: "var(--ink-800)", display: "flex", alignItems: "center", justifyContent: "center", border: "none", cursor: "pointer", gap: 8, fontWeight: 700 }}>
            <Icon name="x" size={20} /> Close
          </button>
        </header>
        <div style={{ padding: 28, flex: 1, overflowY: "auto", display: "flex", flexDirection: "column" }}>
          
          <div style={{ marginBottom: 24, display: "flex", flexWrap: "wrap", gap: 16 }}>
            <div style={{ flex: 1, minWidth: 250 }}>
              <input 
                type="text" 
                placeholder="Search by Order ID, Item name..." 
                value={searchQuery}
                onChange={e => { setSearchQuery(e.target.value); setHistoryPage(1); }}
                style={{ width: "100%", padding: "12px 16px", borderRadius: 12, border: "1.5px solid var(--ink-200)", fontSize: 16, outline: "none", boxShadow: "0 2px 4px rgba(0,0,0,0.05)" }}
              />
            </div>
            
            <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
              <select 
                value={historyFilterTable} 
                onChange={e => { setHistoryFilterTable(e.target.value); setHistoryPage(1); }}
                style={{ padding: "12px 16px", borderRadius: 12, border: "1.5px solid var(--ink-200)", fontSize: 14, outline: "none", background: "white", boxShadow: "0 2px 4px rgba(0,0,0,0.05)" }}
              >
                <option value="">All Tables</option>
                {allTables.map(t => <option key={t} value={t}>Table {t}</option>)}
              </select>

              <select 
                value={historyFilterStatus} 
                onChange={e => { setHistoryFilterStatus(e.target.value); setHistoryPage(1); }}
                style={{ padding: "12px 16px", borderRadius: 12, border: "1.5px solid var(--ink-200)", fontSize: 14, outline: "none", background: "white", boxShadow: "0 2px 4px rgba(0,0,0,0.05)" }}
              >
                <option value="">All Statuses</option>
                <option value="DELIVERED">Delivered</option>
                <option value="PAID">Paid</option>
                <option value="UNPAID">Unpaid</option>
              </select>

              <input 
                type="date"
                value={historyFilterDate}
                onChange={e => { setHistoryFilterDate(e.target.value); setHistoryPage(1); }}
                style={{ padding: "12px 16px", borderRadius: 12, border: "1.5px solid var(--ink-200)", fontSize: 14, outline: "none", background: "white", boxShadow: "0 2px 4px rgba(0,0,0,0.05)" }}
              />
            </div>
          </div>
          
          <div style={{ flex: 1, overflowX: "auto" }}>
            {filteredPastOrders.length === 0 ? (
              <div style={{ padding: 48, textAlign: "center", color: "var(--ink-500)", border: "1px solid var(--ink-200)", borderRadius: 12 }}>
                No past orders found.
              </div>
            ) : (
              <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left", fontSize: 14 }}>
                <thead style={{ background: "var(--ink-50)", color: "var(--ink-500)", borderBottom: "2px solid var(--ink-200)" }}>
                  <tr>
                    <th style={{ padding: "12px 16px", fontWeight: 700 }}>Order #</th>
                    <th style={{ padding: "12px 16px", fontWeight: 700 }}>Time</th>
                    <th style={{ padding: "12px 16px", fontWeight: 700 }}>Table</th>
                    <th style={{ padding: "12px 16px", fontWeight: 700 }}>Items</th>
                    <th style={{ padding: "12px 16px", fontWeight: 700 }}>Total</th>
                    <th style={{ padding: "12px 16px", fontWeight: 700 }}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {paginatedPastOrders.map(order => (
                    <tr key={Array.isArray(order.id) ? order.id[0] : order.id} style={{ borderBottom: "1px solid var(--ink-100)" }}>
                      <td style={{ padding: "16px", fontWeight: 600 }}>#{Array.isArray(order.id) ? order.id.join(', #') : order.id}</td>
                      <td style={{ padding: "16px", color: "var(--ink-500)", fontSize: 16, fontWeight: 700 }}>{new Date(order.createdAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true })}</td>
                      <td style={{ padding: "16px", fontWeight: 600 }}>Table {order.table?.tableNumber || "?"}</td>
                      <td style={{ padding: "16px" }}>
                        {order.items?.map((i, idx) => (
                          <div key={idx} style={{ fontSize: 13, marginBottom: 4 }}>
                            <span style={{ fontWeight: 800, color: "var(--ink-800)" }}>{i.quantity}x</span> {i.inventoryItem?.name || i.variation?.name || "Unknown"}
                          </div>
                        ))}
                      </td>
                      <td style={{ padding: "16px", fontWeight: 800 }}>${Number(order.totalAmount).toFixed(2)}</td>
                      <td style={{ padding: "16px" }}>
                        <span style={{ display: "inline-block", background: "var(--success-100)", color: "var(--success-700)", padding: "4px 8px", borderRadius: 4, fontSize: 12, fontWeight: 800, marginRight: 8 }}>
                          {order.paymentStatus}
                        </span>
                        <span style={{ display: "inline-block", background: "var(--ink-100)", color: "var(--ink-700)", padding: "4px 8px", borderRadius: 4, fontSize: 12, fontWeight: 800 }}>
                          {order.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {historyTotalPages > 1 && (
            <div style={{ marginTop: 24, paddingTop: 24, borderTop: "1px solid var(--ink-200)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontSize: 14, color: "var(--ink-500)" }}>
                Showing {historyStart + 1}–{Math.min(historyStart + HISTORY_PAGE_SIZE, filteredPastOrders.length)} of {filteredPastOrders.length} orders
              </span>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <button onClick={() => setHistoryPage(p => Math.max(1, p - 1))} disabled={historyPage === 1} style={{ padding: "8px 16px", borderRadius: 8, border: "1px solid var(--ink-200)", background: historyPage === 1 ? "var(--ink-50)" : "white", color: "var(--ink-800)", cursor: historyPage === 1 ? "not-allowed" : "pointer", fontWeight: 700 }}>← Prev</button>
                <span style={{ fontSize: 14, fontWeight: 700, padding: "0 8px" }}>Page {historyPage} of {historyTotalPages}</span>
                <button onClick={() => setHistoryPage(p => Math.min(historyTotalPages, p + 1))} disabled={historyPage === historyTotalPages} style={{ padding: "8px 16px", borderRadius: 8, border: "1px solid var(--ink-200)", background: historyPage === historyTotalPages ? "var(--ink-50)" : "white", color: "var(--ink-800)", cursor: historyPage === historyTotalPages ? "not-allowed" : "pointer", fontWeight: 700 }}>Next →</button>
              </div>
            </div>
          )}
        </div>
      </div>
    )}
    </>
  );
}
