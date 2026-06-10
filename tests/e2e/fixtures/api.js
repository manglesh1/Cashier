// API fixtures — talk to the live admin API (default :5171) to seed
// the data each smoke test needs: a SKU, a paid booking that produces
// a redemption token, etc.
//
// Auth: superadmin login. The token is reused across tests via the
// shared module-level cache below.

const API_BASE_URL = process.env.API_BASE_URL || "http://localhost:5171/api";
const ADMIN_EMAIL = process.env.CASHIER_E2E_ADMIN_EMAIL || "superadmin@aerosports.com";
const ADMIN_PASSWORD = process.env.CASHIER_E2E_ADMIN_PASSWORD || "supersecurepassword";
// Default location 4 = superadmin's first location, which is what the
// Cashier app scopes its API calls to after the admin logs in. If your
// dev environment has a different mapping, override via env var.
const LOCATION_ID = Number(process.env.CASHIER_LOCATION_ID || 4);

let _adminToken = null;

export function uniq(prefix = "e2e") {
  return `${prefix}_${Date.now()}_${Math.floor(Math.random() * 100000)}`;
}

export async function apiFetch(path, options = {}) {
  const headers = {
    "Content-Type": "application/json",
    ...(options.headers || {}),
  };
  if (_adminToken && !headers.Authorization) {
    headers.Authorization = `Bearer ${_adminToken}`;
  }
  const res = await fetch(`${API_BASE_URL}${path}`, { ...options, headers });
  const text = await res.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { status: res.status, body };
}

export async function adminLogin() {
  if (_adminToken) return _adminToken;
  const res = await fetch(`${API_BASE_URL}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
  });
  if (res.status !== 200) {
    throw new Error(`Admin login failed: HTTP ${res.status}`);
  }
  const json = await res.json();
  _adminToken = json.token;
  if (!_adminToken) throw new Error("Admin login returned no token");
  return _adminToken;
}

export { LOCATION_ID, API_BASE_URL };

// ── Catalog SKU helpers ─────────────────────────────────────────────

export async function createGiftCardSku({ price = 25, initialBalance = 25 } = {}) {
  await adminLogin();
  const { status, body } = await apiFetch(
    `/gift-cards?locationId=${LOCATION_ID}`,
    {
      method: "POST",
      body: JSON.stringify({
        name: `E2E-GC ${uniq()}`,
        description: "Playwright smoke gift card SKU",
        price,
        initialBalance,
        taxAtSale: false,
      }),
    }
  );
  if (status !== 201) {
    throw new Error(`createGiftCardSku failed: ${status} ${JSON.stringify(body)}`);
  }
  return body.data;
}

export async function createMembershipSku({ price = 5 } = {}) {
  await adminLogin();
  const { status, body } = await apiFetch(
    `/memberships?locationId=${LOCATION_ID}`,
    {
      method: "POST",
      body: JSON.stringify({
        name: `E2E-Member ${uniq()}`,
        description: "Playwright smoke membership SKU",
        price,
        daysValidFromPurchase: 30,
        includeAllActivities: true,
        autoRenew: false,
      }),
    }
  );
  if (status !== 201) {
    throw new Error(`createMembershipSku failed: ${status} ${JSON.stringify(body)}`);
  }
  return body.data;
}

export async function createVoucherPackSku({
  price = 12,
  // Stock-item inclusions mint Entitlements (single-press redeem,
  // no slot scheduling needed). Defaults to Grip Socks (activityId=6,
  // variationId=8) from the seeded catalog.
  stockActivityId = 6,
  stockVariationId = 8,
} = {}) {
  await adminLogin();
  const { status, body } = await apiFetch(
    `/voucher-packs?locationId=${LOCATION_ID}`,
    {
      method: "POST",
      body: JSON.stringify({
        name: `E2E-Pack ${uniq()}`,
        description: "Playwright smoke voucher pack",
        validityDays: 60,
        price,
        itemsIncluded: [
          {
            activityId: stockActivityId,
            variationId: stockVariationId,
            productType: "stock_item",
            qty: 2,
            perUnit: "per_booking",
            listedPrice: price / 2,
          },
        ],
        allowPartialRefund: false,
        allowTransfer: true,
        allowCrossLocation: false,
        redemptionUse: "multiple_bookings",
      }),
    }
  );
  if (status !== 201) {
    throw new Error(`createVoucherPackSku failed: ${status} ${JSON.stringify(body)}`);
  }
  return body.data;
}

// ── Booking + artifact creation ─────────────────────────────────────

// Purchase a gift card via the admin API. Returns { bookingId, code }.
// Pays the booking in full so the card is redeemable / lookupable.
export async function buyGiftCard({ amount = 25 } = {}) {
  await adminLogin();
  const sku = await createGiftCardSku({ price: amount, initialBalance: amount });
  const buy = await apiFetch(`/bookings?locationId=${LOCATION_ID}`, {
    method: "POST",
    body: JSON.stringify({
      guestInfo: {
        guestName: "E2E GC Buyer",
        guestEmail: `gc_${uniq()}@e2e.local`,
        guestPhone: "555-0103",
      },
      activityIds: [sku.activityId],
      pricingSummary: { subtotalAmount: amount, grandTotal: amount },
      deferWaiverEnforcement: true,
    }),
  });
  if (buy.status !== 201) {
    throw new Error(`gift card purchase failed: ${buy.status} ${JSON.stringify(buy.body)}`);
  }
  const bookingId = buy.body.data.bookingId;
  const code = buy.body.data.giftCard.code;
  // Pay in full so the lookup endpoint returns 200 (not 402).
  const pay = await apiFetch(`/bookings/${bookingId}?locationId=${LOCATION_ID}`, {
    method: "PUT",
    body: JSON.stringify({
      sessions: [],
      amountPaid: amount,
      paymentMethod: "cash",
      paymentRemarks: "E2E pay-in-full",
      actor: "admin",
    }),
  });
  if (pay.status !== 200) {
    throw new Error(`gift card pay-in-full failed: ${pay.status}`);
  }
  return { bookingId, code };
}

// Buy a 2-person membership bundle (the bulk path on the admin
// controller); returns the booking + the FIRST membership's
// redemptionToken so the cashier scan can resolve a guest.
export async function buyMembershipBundle() {
  await adminLogin();
  const sku = await createMembershipSku({ price: 5 });
  const variationId = sku.variationId || sku.tiers?.[0]?.variationId || null;
  const buy = await apiFetch(`/bookings?locationId=${LOCATION_ID}`, {
    method: "POST",
    body: JSON.stringify({
      guestInfo: {
        guestName: "E2E Member Payer",
        guestEmail: `member_${uniq()}@e2e.local`,
        guestPhone: "555-0101",
      },
      memberships: [
        {
          activityId: sku.activityId,
          variationId,
          guestInfo: {
            guestName: "E2E Member Holder",
            guestEmail: `holder_${uniq()}@e2e.local`,
          },
        },
        {
          activityId: sku.activityId,
          variationId,
          guestInfo: {
            guestName: "E2E Member Spouse",
            guestEmail: `spouse_${uniq()}@e2e.local`,
          },
        },
      ],
      amountPaid: Number(sku.price) * 2,
      paymentMethod: "cash",
      deferWaiverEnforcement: true,
    }),
  });
  if (buy.status !== 201) {
    throw new Error(`membership purchase failed: ${buy.status} ${JSON.stringify(buy.body)}`);
  }
  const bookingId = buy.body.data.bookingId;
  const firstMember = buy.body.data.memberships?.[0];
  if (!firstMember?.redemptionToken) {
    throw new Error("Membership purchase did not return a redemption token");
  }
  return {
    bookingId,
    membershipId: firstMember.membershipId,
    redemptionToken: firstMember.redemptionToken,
    guestEmail: buy.body.data.memberships?.[0]?.guestEmail || null,
  };
}

// Buy a voucher pack; returns the booking + entitlement redemption
// token. Pays the booking in full afterwards because the voucher-pack
// short-circuit in bookingController doesn't pass amountPaid through
// to purchaseVoucherPack (the booking lands unpaid otherwise, and the
// /customers/:id/redeemable endpoint filters to paid bookings).
export async function buyVoucherPack({ price = 12 } = {}) {
  await adminLogin();
  const sku = await createVoucherPackSku({ price });
  const buy = await apiFetch(`/bookings?locationId=${LOCATION_ID}`, {
    method: "POST",
    body: JSON.stringify({
      guestInfo: {
        guestName: "E2E Pack Buyer",
        guestEmail: `pack_${uniq()}@e2e.local`,
        guestPhone: "555-0102",
      },
      activityIds: [sku.activityId],
      pricingSummary: { subtotalAmount: price, grandTotal: price },
      deferWaiverEnforcement: true,
    }),
  });
  if (buy.status !== 201) {
    throw new Error(`voucher pack purchase failed: ${buy.status} ${JSON.stringify(buy.body)}`);
  }
  const bookingId = buy.body.data.bookingId;

  // Pay the booking in full so the entitlement shows up in the
  // customer's redeemables.
  const pay = await apiFetch(`/bookings/${bookingId}?locationId=${LOCATION_ID}`, {
    method: "PUT",
    body: JSON.stringify({
      sessions: [],
      amountPaid: price,
      paymentMethod: "cash",
      paymentRemarks: "E2E pay-in-full",
      actor: "admin",
    }),
  });
  if (pay.status !== 200) {
    throw new Error(`voucher pack pay-in-full failed: ${pay.status}`);
  }

  return {
    bookingId,
    redemptionToken:
      buy.body.data.entitlements?.[0]?.redemptionToken ||
      buy.body.data.vouchers?.[0]?.redemptionToken ||
      buy.body.data.bookingItems?.[0]?.redemptionToken ||
      null,
    entitlementId: buy.body.data.entitlements?.[0]?.entitlementId || null,
    initialRemainingQty:
      buy.body.data.entitlements?.[0]?.remainingQty ?? null,
  };
}

// Create an UNPAID membership purchase. Returns the booking + buyer
// guest details so the spec can search /find by email and reach a
// booking with a payable balance (Take Payment button enabled).
export async function buyUnpaidMembership() {
  await adminLogin();
  const sku = await createMembershipSku({ price: 12 });
  const variationId = sku.variationId || sku.tiers?.[0]?.variationId || null;
  const buyerEmail = `unpaid_${uniq()}@e2e.local`;
  const buy = await apiFetch(`/bookings?locationId=${LOCATION_ID}`, {
    method: "POST",
    body: JSON.stringify({
      guestInfo: {
        guestName: "E2E Unpaid Payer",
        guestEmail: buyerEmail,
        guestPhone: "555-0104",
      },
      activityIds: [sku.activityId],
      variationId,
      pricingSummary: { subtotalAmount: 12, grandTotal: 12 },
      deferWaiverEnforcement: true,
      // No amountPaid → booking lands unpaid with balance = total.
    }),
  });
  if (buy.status !== 201) {
    throw new Error(`unpaid membership purchase failed: ${buy.status} ${JSON.stringify(buy.body)}`);
  }
  return {
    bookingId: buy.body.data.bookingId,
    bookingNumber: buy.body.data.bookingNumber,
    buyerEmail,
  };
}

// Fetch the dedicated booking-tickets endpoint so the spec can pull a
// real ticket code (`AS-T-*`) to feed the scanner path. The booking
// detail GET doesn't surface ticketCode directly; the per-booking
// tickets route does.
export async function getFirstTicketCode(bookingId) {
  await adminLogin();
  const { status, body } = await apiFetch(
    `/bookings/${bookingId}/tickets?locationId=${LOCATION_ID}`,
    { method: "GET" }
  );
  if (status !== 200) return null;
  const tickets = body?.data || body?.tickets || [];
  if (!Array.isArray(tickets)) return null;
  const code = tickets.find((t) => t.ticketCode)?.ticketCode;
  return code || null;
}
