// PayPal Orders API for donations. Settings come from .env:
//   PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET (required to take online donations)
//   PAYPAL_ENV: "sandbox" (default, test money only) or "live"
const crypto = require("crypto");

function paypalConfig() {
  const env = (process.env.PAYPAL_ENV || "sandbox").toLowerCase() === "live" ? "live" : "sandbox";
  return {
    env,
    baseUrl: env === "live" ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com",
    clientId: process.env.PAYPAL_CLIENT_ID || "",
    clientSecret: process.env.PAYPAL_CLIENT_SECRET || "",
  };
}

function paypalIsConfigured() {
  const config = paypalConfig();
  return Boolean(config.clientId && config.clientSecret);
}

// Access token, reused until shortly before it expires.
let cachedToken = null;

async function accessToken() {
  if (cachedToken && Date.now() < cachedToken.expiresAt - 60000) return cachedToken.value;
  const config = paypalConfig();
  const response = await fetch(`${config.baseUrl}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: "Basic " + Buffer.from(`${config.clientId}:${config.clientSecret}`).toString("base64"),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.access_token) throw new Error(`PayPal login failed (HTTP ${response.status})`);
  cachedToken = { value: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
  return cachedToken.value;
}

async function paypalRequest(method, pathname, body) {
  const config = paypalConfig();
  const token = await accessToken();
  const response = await fetch(config.baseUrl + pathname, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "PayPal-Request-Id": crypto.randomUUID(),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const issue = data.details && data.details[0] ? data.details[0].issue : data.name || `HTTP ${response.status}`;
    throw new Error(`PayPal error: ${issue}`);
  }
  return data;
}

// Creates a PayPal order for one donation. The donation id is sent as custom_id so the capture can be matched to it.
async function createDonationOrder({ amountCents, donationId }) {
  const order = await paypalRequest("POST", "/v2/checkout/orders", {
    intent: "CAPTURE",
    purchase_units: [
      {
        custom_id: String(donationId),
        description: "Donation to Worship On The Mountain",
        amount: { currency_code: "USD", value: (amountCents / 100).toFixed(2) },
      },
    ],
  });
  return order.id;
}

// Captures an order the donor has approved. Returns what PayPal reports, for the server to check against its own record.
async function captureDonationOrder(orderId) {
  const order = await paypalRequest("POST", `/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`, {});
  const unit = order.purchase_units && order.purchase_units[0];
  const capture = unit && unit.payments && unit.payments.captures && unit.payments.captures[0];
  return {
    status: order.status,
    customId: unit && unit.custom_id ? unit.custom_id : "",
    amountCents: capture ? Math.round(Number(capture.amount.value) * 100) : 0,
    currency: capture ? capture.amount.currency_code : "",
  };
}

module.exports = { paypalConfig, paypalIsConfigured, createDonationOrder, captureDonationOrder };
