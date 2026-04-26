// Helper for opening pages in the sibling Admin app from the cashier.
// Set VITE_ADMIN_URL in .env to point at the manager app
// (e.g. http://localhost:5173). Defaults to localhost dev port.

const ADMIN_URL = import.meta.env.VITE_ADMIN_URL || "http://localhost:5173";

export const openInAdmin = (path) => {
  const url = `${ADMIN_URL.replace(/\/$/, "")}${path.startsWith("/") ? path : `/${path}`}`;
  window.open(url, "_blank", "noopener,noreferrer");
};

export const adminBookingDetailUrl = (bookingMasterId, query = "") => {
  const q = query ? `&${query.replace(/^[?&]/, "")}` : "";
  return `${ADMIN_URL.replace(/\/$/, "")}/reservations/confirmation?book_id=${bookingMasterId}${q}`;
};
