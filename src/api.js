/*
  Talks to the Django API using the session cookie.

  The two sides model the same data differently: the SPA nests bonds inside
  panels and uses camelCase, the API stores bonds flat with a panel FK and
  snake_case. Everything in here is that translation, kept in one place so the
  components keep working with the shape they already expect.
*/

const BASE = "/api";

function cookie(name) {
  const hit = document.cookie
    .split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith(name + "="));
  return hit ? decodeURIComponent(hit.slice(name.length + 1)) : null;
}

async function request(path, { method = "GET", body } = {}) {
  const headers = { "Content-Type": "application/json" };

  if (method !== "GET") {
    const token = cookie("csrftoken");
    if (token) headers["X-CSRFToken"] = token;
  }

  const res = await fetch(BASE + path, {
    method,
    headers,
    credentials: "same-origin",
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  if (res.status === 204) return null;

  let data = null;
  try {
    data = await res.json();
  } catch (e) {
    // some errors come back as HTML; fall through to the status check
  }

  if (!res.ok) {
    const err = new Error((data && data.detail) || `${method} ${path} failed (${res.status})`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

/* ---------- auth ---------- */

export const whoami = () => request("/whoami/");
export const login = (username, password) =>
  request("/login/", { method: "POST", body: { username, password } });
export const logout = () => request("/logout/", { method: "POST" });

/* ---------- shape translation ---------- */

const num = (x) => (x === null || x === undefined || x === "" ? 0 : Number(x));

function bondIn(b) {
  // API bond -> SPA bond
  return {
    id: b.id,
    symbol: b.symbol,
    isin: b.isin,
    name: b.name || "",
    issuer: b.issuer || "ACL",
    coupon: num(b.coupon),
    maturity: b.maturity,
    lastCpn: b.last_coupon || "",
    ytmAsk: num(b.ytm_ask),
    ytmBid: num(b.ytm_bid),
    sellQty: num(b.sell_qty),
    buyQty: num(b.buy_qty),
    putSell: b.put_sell,
    putBuy: b.put_buy,
    mm: b.market_maker || null,
    retired: b.retired,
  };
}

function bondOut(b, panelId) {
  // SPA bond -> API bond. Empty lastCpn must go as null, not "".
  return {
    panel: panelId,
    symbol: b.symbol,
    isin: b.isin,
    name: b.name || "",
    issuer: b.issuer || "ACL",
    coupon: num(b.coupon),
    maturity: b.maturity,
    last_coupon: b.lastCpn ? b.lastCpn : null,
    ytm_ask: num(b.ytmAsk),
    ytm_bid: num(b.ytmBid),
    sell_qty: Math.round(num(b.sellQty)),
    buy_qty: Math.round(num(b.buyQty)),
    put_sell: !!b.putSell,
    put_buy: !!b.putBuy,
    market_maker: b.mm || "",
  };
}

function panelIn(p) {
  return {
    id: p.id,
    name: p.name,
    kind: p.kind,
    currency: p.currency,
    isBase: p.is_base,
    fxBuy: num(p.fx_buy),
    fxSell: num(p.fx_sell),
    bonds: (p.bonds || []).filter((b) => !b.retired).map(bondIn),
  };
}

/* ---------- reads ---------- */

export async function loadPanels() {
  const data = await request("/panels/");
  const list = Array.isArray(data) ? data : data.results || [];
  return list.map(panelIn);
}

/* ---------- writes ---------- */

export const createPanel = (p) =>
  request("/panels/", {
    method: "POST",
    body: {
      name: p.name,
      kind: p.kind || "bond",
      currency: p.currency,
      is_base: p.currency === "UGX",
      fx_buy: num(p.fxBuy) || 1,
      fx_sell: num(p.fxSell) || 1,
    },
  }).then(panelIn);

export const updatePanel = (id, p) =>
  request(`/panels/${id}/`, {
    method: "PATCH",
    body: { fx_buy: num(p.fxBuy), fx_sell: num(p.fxSell) },
  });

export const deletePanel = (id) => request(`/panels/${id}/`, { method: "DELETE" });

export const createBond = (b, panelId) =>
  request("/bonds/", { method: "POST", body: bondOut(b, panelId) }).then(bondIn);

export const updateBond = (id, b, panelId) =>
  request(`/bonds/${id}/`, { method: "PATCH", body: bondOut(b, panelId) });

// Instruments are never hard-deleted — retiring keeps historical runs readable.
export const retireBond = (id) =>
  request(`/bonds/${id}/`, { method: "PATCH", body: { retired: true } });

/* ---------- runs ---------- */

export const createRun = (valuationDate, settleDays, reason) =>
  request("/run/", {
    method: "POST",
    body: { valuation_date: valuationDate, settle_days: settleDays, reason },
  });

export const loadRuns = () =>
  request("/runs/").then((d) => (Array.isArray(d) ? d : d.results || []));
