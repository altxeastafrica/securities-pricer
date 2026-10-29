import React, { useState, useEffect, useMemo, useRef } from "react";
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ReferenceDot, BarChart, Bar, ScatterChart, Scatter, Cell, ZAxis,
} from "recharts";
import { Plus, Trash2, Download, Building2, Camera, ChevronDown, X, Settings2, CheckSquare, Square, CalendarClock, Layers } from "lucide-react";
import * as api from "./api.js";

/* ==================================================================
   ALTX SECURITIES PRICER — v4  (bonds + equities)
   Bond engine ported cell-for-cell from Workbook_20260707.xlsx (validated 4dp).
   Equity DR pricing: underlying × FX ÷ conversion ratio (± markup).
================================================================== */
const MS = 86400000, PERIOD = 182;
const uid = () => Math.random().toString(36).slice(2, 9);
const parseD = (s) => { if (!s) return null; const [y, m, d] = s.split("-").map(Number); return Date.UTC(y, m - 1, d); };
const fmtD = (ms) => (ms == null ? "–" : new Date(ms).toISOString().slice(0, 10));
const daysBetween = (a, b) => Math.round((b - a) / MS);

/* ---- bond math ---- */
function excelPV(rate, nper, pmt, fv) { if (rate === 0) return -(pmt * nper + fv); return -(pmt * (1 - Math.pow(1 + rate, -nper)) / rate + fv * Math.pow(1 + rate, -nper)); }
function couponDates(valMs, matMs, anchorMs) {
  if (anchorMs != null) {
    // explicit coupon date from the bond's own calendar — used exactly as stated
    return { nextCoupon: anchorMs + PERIOD * MS, lastCoupon: anchorMs };
  }
  let nc = matMs; while (nc - PERIOD * MS > valMs) nc -= PERIOD * MS;
  return { nextCoupon: nc, lastCoupon: nc - PERIOD * MS };
}
function price(v, m, coupon, ytm, anchor) {
  if (v == null || m == null || m <= v) return null;
  const DTM = daysBetween(v, m), H = DTM / PERIOD, { nextCoupon, lastCoupon } = couponDates(v, m, anchor);
  const accrued = (daysBetween(lastCoupon, v) / PERIOD) * (coupon / 2), clean = -excelPV(ytm / 2, H, coupon / 2, 100);
  return { DTM, H, accrued, clean, dirty: clean + accrued, nextCoupon, lastCoupon, daysToNext: daysBetween(v, nextCoupon), tenor: DTM / 365, periodsWhole: Math.floor(DTM / PERIOD) };
}
function riskMetrics(v, m, coupon, ytm, anchor) {
  const p = price(v, m, coupon, ytm, anchor); if (!p) return null;
  const r = ytm / 2, c = coupon / 2, tau = p.daysToNext / PERIOD, n = p.periodsWhole + 1;
  let pv = 0, ds = 0, cs = 0;
  for (let i = 0; i < n; i++) { const t = tau + i, cf = c + (i === n - 1 ? 100 : 0), df = Math.pow(1 + r, -t), x = cf * df; pv += x; ds += t * x; cs += t * (t + 1) * x; }
  const macY = (ds / pv) / 2; return { ...p, modDur: macY / (1 + r), convexity: (cs / pv) / Math.pow(1 + r, 2) / 4 };
}
function cashflows(v, m, coupon) { const o = []; let d = m; while (d > v) { o.push(d); d -= PERIOD * MS; } o.sort((a, b) => a - b); return o.map((dt) => ({ date: fmtD(dt), year: new Date(dt).getUTCFullYear(), coupon: +(coupon / 2).toFixed(3), principal: dt === m ? 100 : 0 })); }


const nf = (x, dp = 4) => (x == null || isNaN(x) ? "–" : x.toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp }));
const pf = (x, dp = 3) => (x == null || isNaN(x) ? "–" : (x * 100).toFixed(dp) + "%");
const qf = (x) => (x == null || isNaN(x) ? "0" : Math.round(x).toLocaleString("en-US"));

/* ---------- seeds ---------- */
const SEED_TODAY = new Date().toISOString().slice(0, 10);   // defaults to the real current date
const DEFAULT_MM = "0000001065BIKU800";
const UG_SEED = [
  ["UGB08261662","UG12J2708269",16.625,"2026-08-27",0.102,0.1065,0,50000],["UGB05271600","UG12J0605277",16,"2027-05-06",0.1135,0.12,0,50000],
  ["UGB01281412","UG12J1301280",14.125,"2028-01-13",0.1195,0.1235,20000,50000],["UGB08291425","UG0000001327",14.25,"2029-08-23",0.1295,0.133,11838,50000],
  ["UGB04311700","UG12K0304317",17,"2031-04-03",0.144,0.15,20213,50000],["UGB03321637","UG12K0403325",16.375,"2032-03-04",0.142,0.1465,0,50000],
  ["UGB05321500","UG12J2005328",15,"2032-05-20",0.143,0.148,0,50000],["UGB02331437","UG12K0302337",14.375,"2033-02-03",0.1455,0.15,21941,50000],
  ["UGB06341425","UG12K2206346",14.25,"2034-06-22",0.15,0.155,0,50000],["UGB11351625","UG12K0811352",16.25,"2035-11-08",0.153,0.158,0,50000],
  ["UGB05371600","UG12K1405378",15.8,"2037-05-14",0.153,0.16,11586,50000],["UGB06391580","UG12K2306393",16.8,"2039-06-23",0.157,0.162,5882,50000],
  ["UGB11401750","UG12L0111405",17.8,"2040-11-01",0.157,0.162,21170,50000],["UGB08421850","UG12L1308420",18.5,"2042-08-14",0.158,0.163,0,50000],
  ["UGB06431500","UG12L1806433",15,"2043-06-18",0.159,0.164,17174,50000],
];
const KE_SEED = [
  ["GKB04281200","KE4000003808",12,"2028-04-10",0.182,0.187,0,50,"2026-04-14"],
  ["GKB12281250","KE5000009216",12.502,"2028-12-04",0.182,0.187,0,50,"2026-06-09"],
  ["GKB05331265","KE5000008325",12.65,"2033-05-09",0.169,0.174,100,50,"2025-05-19"],
  ["GKB10361393","KE8000005218",13.938,"2036-10-27",0.125,0.13,0,50,"2026-05-12"],
  ["GKB05401374","KE8000002322",13.742,"2040-05-21",0.12,0.13,100,50,"2026-06-09"],
  ["GKB01411296","KE7000007877",12.965,"2041-01-28",0.12,0.13,50,50,"2026-02-17"],
];
const mkBond = (r) => ({ id: uid(), symbol: r[0], isin: r[1], name: "", issuer: "ACL", coupon: r[2], maturity: r[3], ytmAsk: r[4], ytmBid: r[5], sellQty: r[6], buyQty: r[7], lastCpn: r[8] || "", putSell: true, putBuy: true, mm: null });
const initialPanels = () => ([
  { id: uid(), name: "UG Bonds", kind: "bond", currency: "UGX", isBase: true, fxBuy: 1, fxSell: 1, bonds: UG_SEED.map(mkBond) },
  { id: uid(), name: "KE Bonds", kind: "bond", currency: "KES", isBase: false, fxBuy: 29.002, fxSell: 29.124, bonds: KE_SEED.map(mkBond) },
]);

/* ---------- column registries ---------- */
const BOND_COLS = [
  { id: "sel", w: 34, type: "c", align: "c", always: true },
  { id: "symbol", w: 128, label: "SYMBOL", type: "in", align: "l", always: true },
  { id: "isin", w: 124, label: "ISIN", type: "in", align: "l", def: false },
  { id: "issuer", w: 70, label: "ISSUER", type: "in", align: "l", def: false },
  { id: "coupon", w: 86, label: "COUPON %", type: "in", align: "l", def: false },
  { id: "maturity", w: 150, label: "MATURITY", type: "in", align: "l", def: true },
  { id: "lastc", w: 132, label: "LAST CPN", type: "in", align: "l", def: true },
  { id: "nextc", w: 124, label: "NEXT CPN", type: "tx", align: "l", def: true },
  { id: "tenor", w: 76, label: "TENOR y", type: "num", align: "l", def: false },
  { id: "dtm", w: 66, label: "DTM", type: "num", align: "l", def: false },
  { id: "ytmAsk", w: 92, label: "YTM ASK %", type: "in", align: "l", cls: "ask", def: true },
  { id: "ytmBid", w: 92, label: "YTM BID %", type: "in", align: "l", cls: "bid", def: true },
  { id: "accrued", w: 86, label: "ACCRUED", type: "num", align: "l", def: true },
  { id: "cleanA", w: 92, label: "CLEAN ASK", type: "num", align: "l", cls: "ask", def: false },
  { id: "dirtyA", w: 94, label: "DIRTY ASK", type: "num", align: "l", cls: "ask", def: true },
  { id: "cleanB", w: 92, label: "CLEAN BID", type: "num", align: "l", cls: "bid", def: false },
  { id: "dirtyB", w: 94, label: "DIRTY BID", type: "num", align: "l", cls: "bid", def: true },
  { id: "postA", w: 98, label: "POST ASK*", type: "num", align: "l", def: true },
  { id: "postB", w: 98, label: "POST BID*", type: "num", align: "l", def: true },
  { id: "dur", w: 84, label: "MOD DUR", type: "num", align: "l", def: true },
  { id: "cvx", w: 84, label: "CONVEX", type: "num", align: "l", def: false },
  { id: "cy", w: 84, label: "CUR YLD", type: "num", align: "l", def: false },
  { id: "spread", w: 82, label: "SPREAD", type: "num", align: "l", def: false },
  { id: "mm", w: 138, label: "MARKET MAKER", type: "in", align: "l", def: false },
  { id: "sellQty", w: 98, label: "SELL QTY", type: "in", align: "l", cls: "ask", def: true },
  { id: "buyQty", w: 98, label: "BUY QTY", type: "in", align: "l", cls: "bid", def: true },
  { id: "put", w: 100, label: "PUT UP", type: "c", align: "c", always: true },
  { id: "del", w: 42, type: "c", align: "c", always: true },
];
const colsFor = () => BOND_COLS;
const TOGGLE_BOND = BOND_COLS.filter((c) => !c.always && c.label);
const DEFAULT_COLVIS = { bond: Object.fromEntries(TOGGLE_BOND.map((c) => [c.id, c.def !== false])) };

const DEFAULT_SETTINGS = {
  defaultMM: DEFAULT_MM, marketMakers: [DEFAULT_MM],
  market: "ALTX", inst: "Common Stock", series: "XX", orderType: "Limit", product: "ALTX", validity: "Day", source: "Settled",
  priceDp: 3, settleDays: 0, cols: JSON.parse(JSON.stringify(DEFAULT_COLVIS)),
};

/* ---------- batch ---------- */
const BATCH_COLS = ["BUY/SELL","MARKET","CLIENT","INST TYPE","SYMBOL","SERIES","EXP DATE","OPT TYPE","STRIKE PRICE","ORDER TYPE","PRICE","TRIGGER PRICE","QTY","DISC. QTY","PRODUCT","VALIDITY","SOURCE"];
const postAsk = (p, d) => d == null ? null : d * p.fxSell;
const postBid = (p, d) => d == null ? null : d * p.fxBuy;
function buildBatch(panels, valMs, S) {
  const sells = [], buys = [];
  panels.forEach((panel) => panel.bonds.forEach((b) => {
    const client = b.mm || S.defaultMM;
    const meta = { _kind: panel.kind, _panel: panel.name };
    let askPx = null, bidPx = null, ccy = panel.currency;
    const a = price(valMs, parseD(b.maturity), b.coupon, b.ytmAsk, parseD(b.lastCpn)), d = price(valMs, parseD(b.maturity), b.coupon, b.ytmBid, parseD(b.lastCpn));
    askPx = a ? postAsk(panel, a.dirty) : null; bidPx = d ? postBid(panel, d.dirty) : null; ccy = "UGX";
    const row = (side, px, qty) => ({ ...meta, _ccy: ccy, "BUY/SELL": side, MARKET: S.market, CLIENT: client, "INST TYPE": S.inst, SYMBOL: b.symbol, SERIES: S.series, "EXP DATE": "", "OPT TYPE": "", "STRIKE PRICE": "", "ORDER TYPE": S.orderType, PRICE: px == null ? "" : +px.toFixed(S.priceDp), "TRIGGER PRICE": "", QTY: qty, "DISC. QTY": "", PRODUCT: S.product, VALIDITY: S.validity, SOURCE: S.source });
    if (b.putSell && askPx != null) sells.push(row("Sell", askPx, b.sellQty));
    if (b.putBuy && bidPx != null) buys.push(row("Buy", bidPx, b.buyQty));
  }));
  return [...sells, ...buys];
}
const toCSV = (rows) => [BATCH_COLS.join(","), ...rows.map((r) => BATCH_COLS.map((c) => r[c]).join(","))].join("\n");

/* ---------- persistence ---------- */
/* Panels, bonds and marks live in Postgres via the API. Only per-browser UI
   preferences (column visibility, batch template defaults) stay local. */
const store = {
  async load(k) { try { const r = localStorage.getItem(k); return r ? JSON.parse(r) : null; } catch (e) {} return null; },
  async save(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
};

const isNew = (id) => typeof id !== "number";
function normalize(panels) {
  panels.forEach((p) => { if (!p.kind) p.kind = "bond"; p.bonds.forEach((b) => { if (b.putSell === undefined) { b.putSell = true; b.putBuy = true; } if (b.mm === undefined) b.mm = null; if (b.lastCpn === undefined) b.lastCpn = ""; }); });
  return panels;
}
const COLORS = { accent: "#0E5A6B", accentD: "#0B4552", bid: "#0B7A4B", ask: "#B23A2E", ink: "#0F1620", muted: "#5B6673", line: "#E4E8EE" };
const tipStyle = { background: "#fff", border: `1px solid ${COLORS.line}`, borderRadius: 8, fontSize: 12, boxShadow: "0 6px 24px rgba(15,22,32,.08)" };

/* ================================================================== */
function Pricer({ user, onLogout }) {
  const [panels, setPanels] = useState(initialPanels);
  const [today, setToday] = useState(SEED_TODAY);
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [tab, setTab] = useState("single");
  const [snaps, setSnaps] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [modal, setModal] = useState(null); // {type:'addPanel'|'settings'|'addInst', panel?}
  const [syncing, setSyncing] = useState(false);
  const [syncErr, setSyncErr] = useState(null);
  const valMs = parseD(today) + settings.settleDays * MS;

  const savedRef = useRef(null);
  const timerRef = useRef(null);

  useEffect(() => { (async () => {
    const s = await store.load("altx_prefs_v1");
    if (s && s.settings) setSettings({ ...DEFAULT_SETTINGS, ...s.settings, cols: { bond: { ...DEFAULT_COLVIS.bond, ...(s.settings.cols?.bond || {}) } } });
    try {
      const fromApi = await api.loadPanels();
      setPanels(normalize(fromApi));
      savedRef.current = JSON.stringify(fromApi);
    } catch (e) {
      setSyncErr(e.message);
    }
    setLoaded(true);
  })(); }, []);

  useEffect(() => { if (loaded) store.save("altx_prefs_v1", { settings }); }, [settings, loaded]);

  /* Push changed bonds to the API, debounced so typing a yield doesn't fire a
     request per keystroke. Only what actually changed is sent. */
  useEffect(() => {
    if (!loaded || savedRef.current === null) return;
    if (JSON.stringify(panels) === savedRef.current) return;

    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(async () => {
      const before = JSON.parse(savedRef.current);
      const prev = new Map();
      before.forEach((p) => p.bonds.forEach((b) => prev.set(b.id, b)));

      setSyncing(true);
      try {
        for (const p of panels) {
          if (isNew(p.id)) continue;
          for (const b of p.bonds) {
            if (isNew(b.id)) { await api.createBond(b, p.id); continue; }
            const was = prev.get(b.id);
            if (!was || JSON.stringify(was) !== JSON.stringify(b)) {
              await api.updateBond(b.id, b, p.id);
            }
          }
        }
        const fresh = await api.loadPanels();
        setPanels(normalize(fresh));
        savedRef.current = JSON.stringify(fresh);
        setSyncErr(null);
      } catch (e) {
        setSyncErr(e.message);
      } finally {
        setSyncing(false);
      }
    }, 800);

    return () => clearTimeout(timerRef.current);
  }, [panels, loaded]);

  const updatePanel = (pid, patch) => setPanels((ps) => ps.map((p) => p.id === pid ? { ...p, ...patch } : p));
  const updateBond = (pid, bid, patch) => setPanels((ps) => ps.map((p) => p.id !== pid ? p : { ...p, bonds: p.bonds.map((b) => b.id === bid ? { ...b, ...patch } : b) }));
  const bulkUpdate = (pid, ids, fn) => setPanels((ps) => ps.map((p) => p.id !== pid ? p : { ...p, bonds: p.bonds.map((b) => ids.has(b.id) ? { ...b, ...(typeof fn === "function" ? fn(b) : fn) } : b) }));
  const bulkDelete = (pid, ids) => {
    ids.forEach((id) => { if (!isNew(id)) api.retireBond(id).catch((e) => setSyncErr(e.message)); });
    setPanels((ps) => ps.map((p) => p.id !== pid ? p : { ...p, bonds: p.bonds.filter((b) => !ids.has(b.id)) }));
  };
  const addInstrument = (pid, obj) => setPanels((ps) => ps.map((p) => p.id !== pid ? p : { ...p, bonds: [...p.bonds, { id: uid(), ...obj }] }));
  const delBond = (pid, bid) => {
    if (!isNew(bid)) api.retireBond(bid).catch((e) => setSyncErr(e.message));
    setPanels((ps) => ps.map((p) => p.id !== pid ? p : { ...p, bonds: p.bonds.filter((b) => b.id !== bid) }));
  };
  const delPanel = async (pid) => {
    setTab("single");
    try { if (!isNew(pid)) await api.deletePanel(pid); setPanels((ps) => ps.filter((p) => p.id !== pid)); }
    catch (e) { setSyncErr(e.message); }
  };
  const addPanel = async (name, kind, currency, fxBuy, fxSell) => {
    setModal(null);
    try {
      const np = await api.createPanel({ name, kind, currency, fxBuy, fxSell });
      setPanels((ps) => [...ps, np]);
      savedRef.current = null;
      const fresh = await api.loadPanels();
      setPanels(normalize(fresh)); savedRef.current = JSON.stringify(fresh);
      setTab(np.id);
    } catch (e) { setSyncErr(e.message); }
  };

  const batch = useMemo(() => buildBatch(panels, valMs, settings), [panels, valMs, settings]);
  const saveSnapshot = () => {
    const rows = [];
    panels.forEach((p) => p.bonds.forEach((b) => { const a = price(valMs, parseD(b.maturity), b.coupon, b.ytmAsk, parseD(b.lastCpn)), d = price(valMs, parseD(b.maturity), b.coupon, b.ytmBid, parseD(b.lastCpn)); rows.push({ symbol: b.symbol, kind: "bond", ytmAsk: b.ytmAsk, ytmBid: b.ytmBid, dirtyAsk: a ? +postAsk(p, a.dirty).toFixed(4) : null, dirtyBid: d ? +postBid(p, d.dirty).toFixed(4) : null }); }));
    const next = [...snaps.filter((s) => s.date !== today), { date: today, ts: Date.now(), rows }].sort((a, b) => a.date.localeCompare(b.date));
    setSnaps(next); store.save("altx_snaps", next);
  };
  const downloadRows = (rows, name) => { const blob = new Blob([toCSV(rows)], { type: "text/csv;charset=utf-8" }); const url = URL.createObjectURL(blob), a = document.createElement("a"); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url); };

  return (
    <div className="app">
      <style>{CSS}</style>
      <header className="top">
        <div className="brand"><div className="mark">ALTX</div><div><div className="title">Securities Pricer</div><div className="sub">Depository pricing &amp; batch order desk</div></div></div>
        <div className="controls">
          <label className="field"><span>Valuation date</span><input type="date" value={today} onChange={(e) => setToday(e.target.value)} /></label>
          {settings.settleDays !== 0 && <div className="settlebadge">settles {fmtD(valMs)} (T+{settings.settleDays})</div>}
          <button className="btn ghost" onClick={() => setModal({ type: "settings" })}><Settings2 size={15} /> Settings</button>
          <button className="btn ghost" onClick={saveSnapshot}><Camera size={15} /> Save snapshot</button>
          <button className="btn primary" onClick={() => setTab("batch")}><Layers size={15} /> Batch orders</button>
          <span className="syncbox">{syncErr ? <span className="syncerr" title={syncErr}>not saved</span> : syncing ? <span className="muted sm">saving…</span> : <span className="muted sm">saved</span>}</span>
          <span className="muted sm">{user.username}</span>
          <button className="btn ghost sm" onClick={onLogout}>Log out</button>
        </div>
      </header>

      <nav className="tabs">
        <button className={tab === "single" ? "tab on" : "tab"} onClick={() => setTab("single")}>Bond analytics</button>
        {panels.map((p) => <button key={p.id} className={tab === p.id ? "tab on" : "tab"} onClick={() => setTab(p.id)}>{p.name} <span className="pill">{p.bonds.length}</span></button>)}
        <button className="tab addp" onClick={() => setModal({ type: "addPanel" })}><Plus size={14} /> Panel</button>
        <button className={tab === "batch" ? "tab on batchtab" : "tab batchtab"} onClick={() => setTab("batch")}>Batch orders <span className="pill">{batch.length}</span></button>
      </nav>

      <main className="body">
        {tab === "single" && <SingleBond panels={panels} valMs={valMs} snaps={snaps} />}
        {panels.map((p) => tab === p.id && (
          <PanelTable key={p.id} panel={p} valMs={valMs} settings={settings} updatePanel={updatePanel} updateBond={updateBond} delBond={delBond} delPanel={delPanel} bulkUpdate={bulkUpdate} bulkDelete={bulkDelete} onAdd={() => setModal({ type: "addInst", panel: p })} />
        ))}
        {tab === "batch" && <BatchView batch={batch} settings={settings} panels={panels} download={downloadRows} today={today} />}
      </main>

      {modal?.type === "addPanel" && <AddPanel onAdd={addPanel} onClose={() => setModal(null)} />}
      {modal?.type === "settings" && <SettingsPanel settings={settings} setSettings={setSettings} setPanels={setPanels} onClose={() => setModal(null)} />}
      {modal?.type === "addInst" && <AddInstrument panel={modal.panel} settings={settings} onAdd={(obj) => { addInstrument(modal.panel.id, obj); setModal(null); }} onClose={() => setModal(null)} />}
    </div>
  );
}

/* ---------- cell renderers ---------- */
function renderBond(id, ctx) {
  const { b, a, d, postA, postB, mmOptions, up, toggle, selected, delBond, panel } = ctx;
  switch (id) {
    case "sel": return <button className="chk" onClick={() => toggle(b.id)}>{selected.has(b.id) ? <CheckSquare size={15} /> : <Square size={15} />}</button>;
    case "symbol": return <input className="ci sym" value={b.symbol} onChange={(e) => up({ symbol: e.target.value })} />;
    case "isin": return <input className="ci mono2" value={b.isin} onChange={(e) => up({ isin: e.target.value })} />;
    case "issuer": return <input className="ci" value={b.issuer || ""} onChange={(e) => up({ issuer: e.target.value })} />;
    case "coupon": return <input className="ci num" type="number" step="0.001" value={b.coupon} onChange={(e) => up({ coupon: +e.target.value })} />;
    case "maturity": return <input className="ci mono2" type="date" value={b.maturity} onChange={(e) => up({ maturity: e.target.value })} />;
    case "lastc": return <input className="ci mono2" type="date" value={b.lastCpn || (a ? fmtD(a.lastCoupon) : "")} onChange={(e) => up({ lastCpn: e.target.value })} title="Actual last coupon date. Blank = derived from maturity." />;
    case "nextc": return a ? <>{fmtD(a.nextCoupon)}<span className="daystag">{a.daysToNext}d</span></> : "–";
    case "tenor": return <span className="dim">{a ? nf(a.tenor, 2) : "–"}</span>;
    case "dtm": return <span className="dim">{a ? a.DTM : "–"}</span>;
    case "ytmAsk": return <input className="ci num" type="number" step="0.01" value={+(b.ytmAsk * 100).toFixed(4)} onChange={(e) => up({ ytmAsk: +e.target.value / 100 })} />;
    case "ytmBid": return <input className="ci num" type="number" step="0.01" value={+(b.ytmBid * 100).toFixed(4)} onChange={(e) => up({ ytmBid: +e.target.value / 100 })} />;
    case "accrued": return <span className="dim">{a ? nf(a.accrued, 3) : "–"}</span>;
    case "cleanA": return a ? nf(a.clean, 3) : "–";
    case "dirtyA": return <span className="str">{a ? nf(a.dirty, 3) : "–"}</span>;
    case "cleanB": return d ? nf(d.clean, 3) : "–";
    case "dirtyB": return <span className="str">{d ? nf(d.dirty, 3) : "–"}</span>;
    case "postA": return nf(postA, 3);
    case "postB": return nf(postB, 3);
    case "dur": return <span className="dim">{a ? nf(a.modDur, 3) : "–"}</span>;
    case "cvx": return <span className="dim">{a ? nf(a.convexity, 2) : "–"}</span>;
    case "cy": return <span className="dim">{a ? pf(b.coupon / a.dirty, 2) : "–"}</span>;
    case "spread": return <span className="dim">{a && d ? nf(a.dirty - d.dirty, 3) : "–"}</span>;
    case "mm": return <select className="ci mono2" value={b.mm || "Default"} onChange={(e) => up({ mm: e.target.value === "Default" ? null : e.target.value })}>{mmOptions.map((m) => <option key={m} value={m}>{m}</option>)}</select>;
    case "sellQty": return <input className="ci num" type="number" value={b.sellQty} onChange={(e) => up({ sellQty: +e.target.value })} />;
    case "buyQty": return <input className="ci num" type="number" value={b.buyQty} onChange={(e) => up({ buyQty: +e.target.value })} />;
    case "put": return putCell(b, up);
    case "del": return <button className="iconbtn" onClick={() => delBond(panel.id, b.id)}><Trash2 size={14} /></button>;
    default: return null;
  }
}
const putCell = (b, up) => (<><label className="mini-chk ask" title="Quote sell (ask)"><input type="checkbox" checked={b.putSell} onChange={(e) => up({ putSell: e.target.checked })} />S</label><label className="mini-chk bid" title="Quote buy (bid)"><input type="checkbox" checked={b.putBuy} onChange={(e) => up({ putBuy: e.target.checked })} />B</label></>);
const tdClass = (c) => c.type === "in" ? "pin" : c.type === "c" ? "c" : (c.type === "num" ? "num" : "tx") + (c.cls ? " " + c.cls : "");
const thClass = (c) => (c.align === "c" ? "c" : "l") + (c.cls ? " " + c.cls : "");

/* ================= panel table ================= */
function PanelTable({ panel, valMs, settings, updatePanel, updateBond, delBond, delPanel, bulkUpdate, bulkDelete, onAdd }) {
  const [selected, setSelected] = useState(new Set());
  const [bump, setBump] = useState(5);
  const S = settings, isEq = false;
  const ids = panel.bonds.map((b) => b.id);
  const allSel = ids.length > 0 && ids.every((i) => selected.has(i));
  const toggle = (id) => setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const clearSel = () => setSelected(new Set());
  const withSel = (fn) => bulkUpdate(panel.id, selected, fn);
  const shift = (sg) => withSel((b) => isEq ? { underPx: +(b.underPx * (1 + sg * bump / 10000)).toFixed(6) } : { ytmAsk: +(b.ytmAsk + sg * bump / 10000).toFixed(6), ytmBid: +(b.ytmBid + sg * bump / 10000).toFixed(6) });
  const mmOptions = ["Default", ...S.marketMakers];
  const vis = S.cols.bond || {};
  const cols = useMemo(() => colsFor().filter((c) => c.always || vis[c.id]), [vis]);
  const minW = cols.reduce((s, c) => s + c.w, 0);
  const render = renderBond;
  const gtc = cols.map((c) => c.w + "px").join(" ");

  return (
    <section>
      <div className="panelhead">
        <div><h2>{panel.name} <span className={"ccy " + panel.kind}>{isEq ? "equity" : panel.currency}</span></h2>
          <div className="muted sm">{isEq ? "Depository receipts · price = underlying × FX ÷ conversion ratio" : `Bonds · market maker ${S.defaultMM} (default) · settlement UGX`} · valuation {fmtD(valMs)}</div></div>
        <div className="panelctl">
          <div className="bumpbox"><span className="muted sm">Bump {isEq ? "px" : "yields"}</span><input type="number" value={bump} onChange={(e) => setBump(+e.target.value)} className="bumpin" /><span className="muted sm">bp</span>
            <button className="btn sm ghost" disabled={!selected.size} onClick={() => shift(-1)}>−</button><button className="btn sm ghost" disabled={!selected.size} onClick={() => shift(1)}>+</button></div>
          {!panel.isBase && !isEq && (<>
            <label className="field sm"><span>FX buy →UGX</span><input type="number" step="0.001" value={panel.fxBuy} onChange={(e) => updatePanel(panel.id, { fxBuy: +e.target.value })} /></label>
            <label className="field sm"><span>FX sell →UGX</span><input type="number" step="0.001" value={panel.fxSell} onChange={(e) => updatePanel(panel.id, { fxSell: +e.target.value })} /></label></>)}
          <button className="btn danger ghost sm" onClick={() => delPanel(panel.id)}><Trash2 size={14} /> Remove panel</button>
          <button className="btn primary sm" onClick={onAdd}><Plus size={14} /> Add {isEq ? "equity" : "bond"}</button>
        </div>
      </div>

      {selected.size > 0 && (
        <div className="bulkbar">
          <b>{selected.size} selected</b>
          <button className="chip" onClick={() => withSel({ putSell: true })}>Put up sell</button><button className="chip" onClick={() => withSel({ putSell: false })}>Pull sell</button>
          <button className="chip" onClick={() => withSel({ putBuy: true })}>Put up buy</button><button className="chip" onClick={() => withSel({ putBuy: false })}>Pull buy</button>
          <button className="chip" onClick={() => withSel({ putSell: false, putBuy: false })}>Pull all</button><span className="sep" />
          <select className="chipsel" onChange={(e) => { if (e.target.value) { withSel({ mm: e.target.value === "Default" ? null : e.target.value }); e.target.value = ""; } }} defaultValue=""><option value="" disabled>Set maker…</option>{mmOptions.map((m) => <option key={m} value={m}>{m}</option>)}</select>
          <span className="sep" /><button className="chip danger" onClick={() => { bulkDelete(panel.id, selected); clearSel(); }}>Delete</button><button className="chip ghost" onClick={clearSel}>Clear</button>
        </div>
      )}

      <div className="gwrap">
        <div className="grid2" style={{ minWidth: minW }}>
          <div className="grow ghead" style={{ gridTemplateColumns: gtc }}>
            {cols.map((c) => c.id === "sel"
              ? <div key="sel" className="gcell gc-c"><button className="chk" onClick={() => setSelected(allSel ? new Set() : new Set(ids))}>{allSel ? <CheckSquare size={15} /> : <Square size={15} />}</button></div>
              : c.id === "del" ? <div key="del" className="gcell gc-c" />
              : <div key={c.id} className={"gcell gh" + (c.align === "c" ? " gc-c" : "") + (c.cls ? " " + c.cls : "")}>{c.label}</div>)}
          </div>
          {panel.bonds.map((b) => {
            const a = !isEq ? riskMetrics(valMs, parseD(b.maturity), b.coupon, b.ytmAsk, parseD(b.lastCpn)) : null;
            const d = !isEq ? price(valMs, parseD(b.maturity), b.coupon, b.ytmBid, parseD(b.lastCpn)) : null;
            const ctx = { b, a, d, postA: a ? postAsk(panel, a.dirty) : null, postB: d ? postBid(panel, d.dirty) : null, panel, mmOptions, up: (patch) => updateBond(panel.id, b.id, patch), toggle, selected, delBond };
            const inactive = !b.putSell && !b.putBuy;
            return (
              <div key={b.id} className={"grow gbody" + (selected.has(b.id) ? " selrow2" : "") + (inactive ? " inactive" : "")} style={{ gridTemplateColumns: gtc }}>
                {cols.map((c) => <div key={c.id} className={"gcell " + (c.type === "c" ? "gc-c" : c.type === "in" ? "gc-in" : "gc-v" + (c.cls ? " " + c.cls : ""))}>{render(c.id, ctx)}</div>)}
              </div>
            );
          })}
          {panel.bonds.length === 0 && <div className="gempty">No {isEq ? "equities" : "bonds"} yet — click “Add {isEq ? "equity" : "bond"}”.</div>}
        </div>
      </div>
      <div className="footnote"><b>Put up:</b> tick <span className="ask">S</span> for sell (ask), <span className="bid">B</span> for buy (bid); untick both to pull for the day. {isEq ? <>· <b>Ask/Bid per unit</b> post in the quote currency shown.</> : <>· <b>Post ask/bid*</b> = settlement-currency prices sent to the batch.</>} · Toggle columns in <b>Settings</b>.</div>
    </section>
  );
}

/* ================= single bond analytics (bond panels only) ================= */
function SingleBond({ panels, valMs, snaps }) {
  const bondPanels = panels.filter((p) => p.kind === "bond");
  const all = bondPanels.flatMap((p) => p.bonds.map((b) => ({ ...b, panelName: p.name })));
  const [selId, setSelId] = useState(all[0]?.id);
  const sel = all.find((b) => b.id === selId) || all[0];
  if (!sel) return <div className="empty pad">Add a bond in a bond panel to use analytics.</div>;
  const ask = riskMetrics(valMs, parseD(sel.maturity), sel.coupon, sel.ytmAsk, parseD(sel.lastCpn));
  const bid = price(valMs, parseD(sel.maturity), sel.coupon, sel.ytmBid, parseD(sel.lastCpn));
  const pyCurve = useMemo(() => { const out = []; const base = sel.ytmAsk; for (let y = base - 0.05; y <= base + 0.05 + 1e-9; y += 0.0025) { const pr = price(valMs, parseD(sel.maturity), sel.coupon, y, parseD(sel.lastCpn)); if (pr) out.push({ ytm: +(y * 100).toFixed(2), dirty: +pr.dirty.toFixed(3) }); } return out; }, [sel, valMs]);
  const cf = useMemo(() => cashflows(valMs, parseD(sel.maturity), sel.coupon), [sel, valMs]);
  const scenarios = useMemo(() => { if (!ask) return []; const face = 100_000_000; return [-100, -50, -25, 0, 25, 50, 100].map((bps) => { const y = sel.ytmAsk + bps / 10000; const pr = price(valMs, parseD(sel.maturity), sel.coupon, y, parseD(sel.lastCpn)); const dp = pr ? pr.dirty - ask.dirty : 0; return { bps, ytm: y, dirty: pr ? pr.dirty : null, dPrice: dp, pnl: dp / 100 * face }; }); }, [sel, ask, valMs]);
  const hist = useMemo(() => snaps.map((s) => { const r = s.rows.find((x) => x.symbol === sel.symbol); return r ? { date: s.date, dirtyAsk: r.dirtyAsk, dirtyBid: r.dirtyBid, ytmAsk: +(r.ytmAsk * 100).toFixed(3) } : null; }).filter(Boolean), [snaps, sel]);
  const curveScatter = useMemo(() => all.map((b) => { const m = price(valMs, parseD(b.maturity), b.coupon, b.ytmAsk, parseD(b.lastCpn)); return m ? { yrs: +m.tenor.toFixed(2), ytm: +(b.ytmAsk * 100).toFixed(3), symbol: b.symbol, s: b.id === sel.id } : null; }).filter(Boolean), [all, valMs, sel]);
  const upcoming = useMemo(() => all.map((b) => { const m = price(valMs, parseD(b.maturity), b.coupon, b.ytmAsk, parseD(b.lastCpn)); return m ? { symbol: b.symbol, panel: b.panelName, date: fmtD(m.nextCoupon), days: m.daysToNext, amt: b.coupon / 2 } : null; }).filter(Boolean).sort((x, y) => x.days - y.days).slice(0, 12), [all, valMs]);
  const metrics = [["Clean (ask)", ask && nf(ask.clean, 3)], ["Dirty (ask)", ask && nf(ask.dirty, 3)], ["Clean (bid)", bid && nf(bid.clean, 3)], ["Dirty (bid)", bid && nf(bid.dirty, 3)], ["Accrued", ask && nf(ask.accrued, 3)], ["YTM ask / bid", pf(sel.ytmAsk, 2) + " / " + pf(sel.ytmBid, 2)], ["Current yield", ask && pf(sel.coupon / ask.dirty, 2)], ["Mod duration", ask && nf(ask.modDur, 3) + " y"], ["Convexity", ask && nf(ask.convexity, 2)], ["Last coupon", ask && fmtD(ask.lastCoupon)], ["Next coupon", ask && fmtD(ask.nextCoupon) + " (" + ask.daysToNext + "d)"], ["Tenor to mat.", ask && nf(ask.tenor, 2) + " y · " + ask.DTM + "d"]];
  return (
    <section className="single">
      <div className="selrow">
        <label className="field grow"><span>Bond</span><div className="selwrap"><select value={selId} onChange={(e) => setSelId(e.target.value)}>{bondPanels.map((p) => <optgroup key={p.id} label={p.name}>{p.bonds.map((b) => <option key={b.id} value={b.id}>{b.symbol} — {b.coupon}% {b.maturity}</option>)}</optgroup>)}</select><ChevronDown size={16} className="selchev" /></div></label>
        <div className="bondtag"><div className="bt-sym">{sel.symbol}</div><div className="bt-meta">{sel.panelName} · {sel.isin || "no ISIN"} · {sel.coupon}% · matures {sel.maturity}</div></div>
      </div>
      <div className="metrics">{metrics.map(([k, v]) => <div className="metric" key={k}><div className="mk">{k}</div><div className="mv mono">{v ?? "–"}</div></div>)}</div>
      <div className="charts">
        <div className="card"><div className="cardhd">Price / yield sensitivity <span className="muted sm">dirty vs YTM</span></div><ResponsiveContainer width="100%" height={230}><LineChart data={pyCurve} margin={{ top: 8, right: 16, bottom: 4, left: -8 }}><CartesianGrid stroke={COLORS.line} vertical={false} /><XAxis dataKey="ytm" tick={{ fontSize: 11, fill: COLORS.muted }} tickLine={false} axisLine={{ stroke: COLORS.line }} unit="%" /><YAxis tick={{ fontSize: 11, fill: COLORS.muted }} tickLine={false} axisLine={false} width={54} domain={["auto", "auto"]} /><Tooltip contentStyle={tipStyle} formatter={(v) => nf(v, 3)} labelFormatter={(l) => "YTM " + l + "%"} /><Line type="monotone" dataKey="dirty" stroke={COLORS.accent} strokeWidth={2} dot={false} />{ask && <ReferenceDot x={+(sel.ytmAsk * 100).toFixed(2)} y={+ask.dirty.toFixed(3)} r={4} fill={COLORS.ask} stroke="#fff" strokeWidth={1.5} />}</LineChart></ResponsiveContainer></div>
        <div className="card"><div className="cardhd">Cashflow schedule <span className="muted sm">per 100 face</span></div><ResponsiveContainer width="100%" height={230}><BarChart data={cf} margin={{ top: 8, right: 16, bottom: 4, left: -8 }}><CartesianGrid stroke={COLORS.line} vertical={false} /><XAxis dataKey="year" tick={{ fontSize: 11, fill: COLORS.muted }} tickLine={false} axisLine={{ stroke: COLORS.line }} interval="preserveStartEnd" /><YAxis tick={{ fontSize: 11, fill: COLORS.muted }} tickLine={false} axisLine={false} width={48} /><Tooltip contentStyle={tipStyle} formatter={(v, n) => [nf(v, 3), n === "coupon" ? "Coupon" : "Principal"]} labelFormatter={(l, p) => p?.[0]?.payload?.date || l} /><Bar dataKey="coupon" stackId="a" fill={COLORS.accent} /><Bar dataKey="principal" stackId="a" fill={COLORS.bid} radius={[2, 2, 0, 0]} /></BarChart></ResponsiveContainer></div>
        <div className="card"><div className="cardhd">Yield scenarios <span className="muted sm">P&amp;L per 100M face</span></div><table className="mini"><thead><tr><th>Δbps</th><th>YTM</th><th>Dirty</th><th>ΔPrice</th><th>P&amp;L (UGX)</th></tr></thead><tbody>{scenarios.map((s) => <tr key={s.bps} className={s.bps === 0 ? "hl" : ""}><td className={"mono " + (s.bps < 0 ? "g" : s.bps > 0 ? "r" : "")}>{s.bps > 0 ? "+" + s.bps : s.bps}</td><td className="mono dim">{pf(s.ytm, 2)}</td><td className="mono">{nf(s.dirty, 3)}</td><td className={"mono " + (s.dPrice > 0 ? "g" : s.dPrice < 0 ? "r" : "")}>{s.dPrice > 0 ? "+" : ""}{nf(s.dPrice, 3)}</td><td className={"mono " + (s.pnl > 0 ? "g" : s.pnl < 0 ? "r" : "")}>{s.pnl > 0 ? "+" : ""}{qf(s.pnl)}</td></tr>)}</tbody></table></div>
        <div className="card"><div className="cardhd">Market yield curve <span className="muted sm">YTM vs years</span></div><ResponsiveContainer width="100%" height={230}><ScatterChart margin={{ top: 8, right: 16, bottom: 4, left: -8 }}><CartesianGrid stroke={COLORS.line} /><XAxis type="number" dataKey="yrs" tick={{ fontSize: 11, fill: COLORS.muted }} tickLine={false} axisLine={{ stroke: COLORS.line }} unit="y" /><YAxis type="number" dataKey="ytm" tick={{ fontSize: 11, fill: COLORS.muted }} tickLine={false} axisLine={false} width={48} unit="%" domain={["auto", "auto"]} /><ZAxis range={[60, 60]} /><Tooltip contentStyle={tipStyle} cursor={{ strokeDasharray: "3 3" }} formatter={(v, n) => [n === "ytm" ? v + "%" : v + "y", n]} labelFormatter={() => ""} /><Scatter data={curveScatter}>{curveScatter.map((d, i) => <Cell key={i} fill={d.s ? COLORS.ask : COLORS.accent} />)}</Scatter></ScatterChart></ResponsiveContainer></div>
      </div>
      <div className="card wide"><div className="cardhd"><CalendarClock size={15} /> Upcoming coupon payments <span className="muted sm">soonest first</span></div><div className="tablewrap"><table className="grid"><thead><tr><th className="l">Symbol</th><th className="l">Panel</th><th className="l">Next coupon</th><th className="l">Days</th><th className="l">Coupon/100</th></tr></thead><tbody>{upcoming.map((u) => <tr key={u.symbol}><td className="tx mono">{u.symbol}</td><td className="tx dim sm">{u.panel}</td><td className="tx mono">{u.date}</td><td className="tx mono"><span className={u.days <= 14 ? "soon" : ""}>{u.days}d</span></td><td className="tx mono dim">{nf(u.amt, 3)}</td></tr>)}</tbody></table></div></div>
      {hist.length > 0 && <div className="card wide"><div className="cardhd">Price history <span className="muted sm">{sel.symbol} · {hist.length} snapshots</span></div><ResponsiveContainer width="100%" height={230}><LineChart data={hist} margin={{ top: 8, right: 16, bottom: 4, left: -8 }}><CartesianGrid stroke={COLORS.line} vertical={false} /><XAxis dataKey="date" tick={{ fontSize: 11, fill: COLORS.muted }} tickLine={false} axisLine={{ stroke: COLORS.line }} /><YAxis yAxisId="p" tick={{ fontSize: 11, fill: COLORS.muted }} tickLine={false} axisLine={false} width={54} domain={["auto", "auto"]} /><Tooltip contentStyle={tipStyle} /><Line yAxisId="p" type="monotone" dataKey="dirtyAsk" name="Post ask" stroke={COLORS.ask} strokeWidth={2} dot={{ r: 2 }} /><Line yAxisId="p" type="monotone" dataKey="dirtyBid" name="Post bid" stroke={COLORS.bid} strokeWidth={2} dot={{ r: 2 }} /></LineChart></ResponsiveContainer></div>}
    </section>
  );
}

/* ================= batch composer ================= */
function BatchView({ batch, settings, panels, download, today }) {
    const [fSide, setFSide] = useState("all");
  const [fPanel, setFPanel] = useState("all");
  const [fMM, setFMM] = useState("all");
  const filtered = batch.filter((r) => (fSide === "all" || r["BUY/SELL"] === fSide) && (fPanel === "all" || r._panel === fPanel) && (fMM === "all" || r.CLIENT === fMM));
  const makers = [...new Set(batch.map((r) => r.CLIENT))];
  const label = () => { const parts = []; if (fPanel !== "all") parts.push(fPanel.replace(/\s+/g, "")); if (fSide !== "all") parts.push(fSide.toLowerCase() + "s"); if (fMM !== "all") parts.push("mm"); return parts.length ? parts.join("_") : "all"; };
  const dl = () => download(filtered, `batch_${label()}_${today}.csv`);
  const preset = (s, p) => { setFSide(s); setFPanel(p || "all"); setFMM("all"); };
  const sells = filtered.filter((r) => r["BUY/SELL"] === "Sell").length, buys = filtered.length - sells;

  return (
    <section>
      <div className="panelhead"><div><h2>Batch orders <span className="ccy">read-only</span></h2><div className="muted sm">Pick a slice and download. The main file is “All”. Prices &amp; makers pulled live.</div></div></div>
      <div className="presets">
        <span className="muted sm">Quick files:</span>
        <button className="chip" onClick={() => preset("all")}>All</button>
        <button className="chip" onClick={() => preset("Sell")}>All sells</button>
        <button className="chip" onClick={() => preset("Buy")}>All buys</button>
      </div>
      <div className="filterbar">
        <label className="field sm"><span>Side</span><select value={fSide} onChange={(e) => setFSide(e.target.value)}><option value="all">Both</option><option value="Sell">Sells</option><option value="Buy">Buys</option></select></label>
        <label className="field sm"><span>Panel</span><select value={fPanel} onChange={(e) => setFPanel(e.target.value)}><option value="all">All</option>{panels.map((p) => <option key={p.id} value={p.name}>{p.name}</option>)}</select></label>
        <label className="field sm"><span>Market maker</span><select value={fMM} onChange={(e) => setFMM(e.target.value)}><option value="all">All</option>{makers.map((m) => <option key={m} value={m}>{m}</option>)}</select></label>
        <div className="dlbox"><div className="dlcount"><b className="mono">{filtered.length}</b> orders · <span className="ask">{sells} sells</span> · <span className="bid">{buys} buys</span></div><button className="btn primary" onClick={dl} disabled={!filtered.length}><Download size={15} /> Download this file</button></div>
      </div>
      <div className="tablewrap"><table className="grid ro"><thead><tr>{BATCH_COLS.map((c) => <th key={c} className="l">{c}</th>)}</tr></thead><tbody>{filtered.map((r, i) => <tr key={i} className={r["BUY/SELL"] === "Sell" ? "sellrow" : "buyrow"}>{BATCH_COLS.map((c) => <td key={c} className={"tx mono" + (c === "BUY/SELL" ? (r[c] === "Sell" ? " ask b" : " bid b") : "") + (c === "PRICE" ? " str" : "")}>{r[c] === "" ? <span className="dim">·</span> : c === "PRICE" ? nf(r[c], settings.priceDp) : c === "QTY" ? qf(r[c]) : r[c]}</td>)}</tr>)}{!filtered.length && <tr><td colSpan={BATCH_COLS.length} className="empty">Nothing matches this filter.</td></tr>}</tbody></table></div>
      <div className="footnote">Bonds post in UGX (ask × FX-sell, bid × FX-buy); equities post per unit in their quote currency. CLIENT is each instrument's market maker or the default. Filter above, then download exactly that slice.</div>
    </section>
  );
}

/* ================= settings ================= */
function SettingsPanel({ settings, setSettings, setPanels, onClose }) {
  const S = settings;
  const set = (patch) => setSettings((s) => ({ ...s, ...patch }));
  const setCol = (kind, id, v) => setSettings((s) => ({ ...s, cols: { ...s.cols, [kind]: { ...s.cols[kind], [id]: v } } }));
  const [newMM, setNewMM] = useState("");
  const addMM = () => { const v = newMM.trim(); if (v && !S.marketMakers.includes(v)) set({ marketMakers: [...S.marketMakers, v] }); setNewMM(""); };
  const applyMMtoAll = () => setPanels((ps) => ps.map((p) => ({ ...p, bonds: p.bonds.map((b) => ({ ...b, mm: null })) })));
  const tf = (k, label) => <label className="field"><span>{label}</span><input value={S[k]} onChange={(e) => set({ [k]: e.target.value })} /></label>;
  const colKind = "bond";
  const list = TOGGLE_BOND;
  return (
    <div className="modalbg" onClick={onClose}><div className="modal wide2" onClick={(e) => e.stopPropagation()}>
      <div className="modalhd"><Settings2 size={16} /> Settings <button className="iconbtn" onClick={onClose}><X size={16} /></button></div>
      <div className="setgrid">
        <div className="setsec">
          <h4>Market makers</h4>
          <label className="field"><span>Default maker</span><select value={S.defaultMM} onChange={(e) => set({ defaultMM: e.target.value })}>{S.marketMakers.map((m) => <option key={m}>{m}</option>)}</select></label>
          <div className="mmlist">{S.marketMakers.map((m) => <div key={m} className="mmrow"><span className="mono">{m}</span>{S.marketMakers.length > 1 && <button className="iconbtn" onClick={() => set({ marketMakers: S.marketMakers.filter((x) => x !== m) })}><X size={14} /></button>}</div>)}</div>
          <div className="frow"><input className="flatin" placeholder="Add maker e.g. 0000001065ROCKU800" value={newMM} onChange={(e) => setNewMM(e.target.value)} /><button className="btn sm" onClick={addMM}><Plus size={13} /> Add</button></div>
          <button className="btn ghost sm" onClick={applyMMtoAll}>Reset every instrument to default</button>
        </div>
        <div className="setsec">
          <h4>Batch template</h4>
          <div className="frow2">{tf("market", "Market")}{tf("orderType", "Order type")}</div><div className="frow2">{tf("inst", "Instrument type")}{tf("series", "Series")}</div>
          <div className="frow2">{tf("product", "Product")}{tf("validity", "Validity")}</div>
          <div className="frow2">{tf("source", "Source")}<label className="field"><span>Price decimals</span><input type="number" min="0" max="6" value={S.priceDp} onChange={(e) => set({ priceDp: +e.target.value })} /></label></div>
          <label className="field"><span>Settlement offset (days from valuation)</span><input type="number" min="0" max="5" value={S.settleDays} onChange={(e) => set({ settleDays: +e.target.value })} /></label>
        </div>
        <div className="setsec">
          <h4>Visible columns </h4>
          <div className="muted sm">SYMBOL, PUT UP and row controls are always shown.</div>
          <div className="colgrid">{list.map((c) => <label key={c.id} className="togrow"><input type="checkbox" checked={!!S.cols[colKind][c.id]} onChange={(e) => setCol(colKind, c.id, e.target.checked)} /> {c.label}</label>)}</div>
        </div>
      </div>
      <div className="modalft"><button className="btn primary" onClick={onClose}>Done</button></div>
    </div></div>
  );
}

/* ================= add instrument ================= */
function AddInstrument({ panel, settings, onAdd, onClose }) {
  const isEq = false;
  const [f, setF] = useState({ symbol: "", isin: "", issuer: "ACL", coupon: 15, maturity: fmtD(parseD(SEED_TODAY) + 365 * 5 * MS), lastCpn: "", ytmAsk: 15, ytmBid: 15.5, sellQty: 0, buyQty: 50000, mm: "" });
  const set = (k, v) => setF((s) => ({ ...s, [k]: v }));
  const submit = () => {
    const base = { putSell: true, putBuy: true, mm: f.mm || null };
    onAdd({ ...base, symbol: f.symbol, isin: f.isin, issuer: f.issuer, name: "", coupon: +f.coupon, maturity: f.maturity, lastCpn: f.lastCpn || "", ytmAsk: +f.ytmAsk / 100, ytmBid: +f.ytmBid / 100, sellQty: +f.sellQty, buyQty: +f.buyQty });
  };
  const fld = (k, label, props = {}) => <label className="field"><span>{label}</span><input value={f[k]} onChange={(e) => set(k, e.target.value)} {...props} /></label>;
  return (
    <div className="modalbg" onClick={onClose}><div className="modal wide2" onClick={(e) => e.stopPropagation()}>
      <div className="modalhd">{isEq ? <Building2 size={16} /> : <Layers size={16} />} Add {isEq ? "equity (depository receipt)" : "bond"} to {panel.name} <button className="iconbtn" onClick={onClose}><X size={16} /></button></div>
      {(
        <div className="setgrid three">
          {fld("symbol", "Symbol / Code", { placeholder: "UGB08261662" })}{fld("isin", "ISIN (underlying)", { placeholder: "UG12J2708269" })}{fld("issuer", "Issuer", { placeholder: "ACL" })}
          {fld("coupon", "Coupon %", { type: "number", step: "0.001" })}{fld("maturity", "Maturity", { type: "date" })}{fld("lastCpn", "Last coupon date (blank = derive)", { type: "date" })}
          {fld("ytmAsk", "YTM ask %", { type: "number", step: "0.01" })}{fld("ytmBid", "YTM bid %", { type: "number", step: "0.01" })}<label className="field"><span>Market maker</span><select value={f.mm} onChange={(e) => set("mm", e.target.value)}><option value="">Default</option>{settings.marketMakers.map((m) => <option key={m} value={m}>{m}</option>)}</select></label>
          {fld("sellQty", "Sell qty", { type: "number" })}{fld("buyQty", "Buy qty", { type: "number" })}<div />
        </div>
      )}
      <div className="modalft"><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary" disabled={!f.symbol} onClick={submit}>Add {isEq ? "equity" : "bond"}</button></div>
    </div></div>
  );
}

/* ================= add panel ================= */
function AddPanel({ onAdd, onClose }) {
  const [name, setName] = useState(""), [ccy, setCcy] = useState("UGX"), [fxB, setFxB] = useState("1"), [fxS, setFxS] = useState("1");
  return (
    <div className="modalbg" onClick={onClose}><div className="modal" onClick={(e) => e.stopPropagation()}>
      <div className="modalhd"><Building2 size={16} /> Add panel <button className="iconbtn" onClick={onClose}><X size={16} /></button></div>
      <label className="field"><span>Panel name</span><input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. TZ Bonds" /></label>
      <label className="field"><span>Settlement / base currency</span><input value={ccy} onChange={(e) => setCcy(e.target.value)} placeholder="UGX" /></label>
      {ccy !== "UGX" && <div className="frow2"><label className="field"><span>FX buy → UGX</span><input type="number" step="0.0001" value={fxB} onChange={(e) => setFxB(e.target.value)} /></label><label className="field"><span>FX sell → UGX</span><input type="number" step="0.0001" value={fxS} onChange={(e) => setFxS(e.target.value)} /></label></div>}
      <div className="modalft"><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary" disabled={!name} onClick={() => onAdd(name, "bond", ccy || "UGX", fxB, fxS)}>Add panel</button></div>
    </div></div>
  );
}

/* ================= styles ================= */
const CSS = `
:root{--bg:#F6F7F9;--surface:#fff;--ink:#0F1620;--muted:#5B6673;--line:#E4E8EE;--accent:#0E5A6B;--accent-d:#0B4552;--bid:#0B7A4B;--ask:#B23A2E;--gut:11px;}
*{box-sizing:border-box}
.app{font-family:Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:var(--ink);background:var(--bg);min-height:100vh;font-size:13px}
.mono{font-family:ui-monospace,"SF Mono",Menlo,Consolas,monospace;font-variant-numeric:tabular-nums}
h2{font-size:17px;margin:0;font-weight:650;letter-spacing:-.01em}
h4{margin:0 0 4px;font-size:12px;text-transform:uppercase;letter-spacing:.04em;color:var(--accent);display:flex;align-items:center;justify-content:space-between}
.muted{color:var(--muted)}.sm{font-size:11.5px}.dim{color:var(--muted)}.g{color:var(--bid)}.r{color:var(--ask)}.str{font-weight:600}.b{font-weight:600}

.top{display:flex;justify-content:space-between;align-items:center;gap:16px;padding:14px 22px;background:var(--surface);border-bottom:1px solid var(--line);position:sticky;top:0;z-index:20;flex-wrap:wrap}
.brand{display:flex;align-items:center;gap:12px}
.mark{font-family:ui-monospace,monospace;font-weight:700;letter-spacing:.06em;background:var(--accent);color:#fff;padding:8px 10px;border-radius:8px;font-size:14px}
.title{font-weight:680;font-size:16px}.sub{color:var(--muted);font-size:11.5px}
.controls{display:flex;align-items:flex-end;gap:10px;flex-wrap:wrap}
.settlebadge{font-size:11px;background:#fdf6e6;color:#8a6d1f;border:1px solid #efe0b8;border-radius:6px;padding:5px 8px;font-family:ui-monospace,monospace}

.field{display:flex;flex-direction:column;gap:3px;font-size:11px;color:var(--muted)}
.field.sm{font-size:10.5px}.field.grow{flex:1;min-width:260px}
.field span{font-weight:500;letter-spacing:.02em;text-transform:uppercase;font-size:10px}
.field input,.field select{font-family:inherit;font-size:13px;color:var(--ink);border:1px solid var(--line);background:var(--surface);border-radius:7px;padding:7px 9px;outline:none}
.field input:focus,.field select:focus{border-color:var(--accent);box-shadow:0 0 0 3px rgba(14,90,107,.1)}

.btn{display:inline-flex;align-items:center;gap:7px;font-family:inherit;font-size:12.5px;font-weight:550;border-radius:8px;padding:8px 13px;border:1px solid var(--line);background:var(--surface);color:var(--ink);cursor:pointer;transition:.12s;white-space:nowrap}
.btn:hover{border-color:#c9d0d9}.btn.sm{padding:6px 10px;font-size:12px}
.btn.primary{background:var(--accent);border-color:var(--accent);color:#fff}.btn.primary:hover{background:var(--accent-d)}
.btn.primary:disabled,.btn:disabled{opacity:.4;cursor:not-allowed}
.btn.ghost{background:transparent}.btn.danger{color:var(--ask);border-color:#f0d4d0}.btn.danger:hover{background:#fdf3f2}
.iconbtn{border:none;background:transparent;color:var(--muted);cursor:pointer;padding:5px;border-radius:6px;display:inline-flex}.iconbtn:hover{background:#f0f2f5;color:var(--ask)}
.chk{border:none;background:transparent;color:var(--accent);cursor:pointer;padding:2px;display:inline-flex}

.tabs{display:flex;gap:4px;padding:8px 18px 0;background:var(--surface);border-bottom:1px solid var(--line);position:sticky;top:63px;z-index:15;flex-wrap:wrap}
.tab{display:inline-flex;align-items:center;gap:7px;font-size:12.5px;font-weight:550;color:var(--muted);background:transparent;border:1px solid transparent;border-bottom:none;border-radius:8px 8px 0 0;padding:9px 14px;cursor:pointer;margin-bottom:-1px;font-family:inherit}
.tab:hover{color:var(--ink);background:#eff1f4}.tab.on{color:var(--accent);background:var(--bg);border-color:var(--line);border-bottom:1px solid var(--bg)}
.tab.addp{color:var(--accent)}.tab.batchtab{margin-left:auto}
.pill{font-family:ui-monospace,monospace;font-size:10.5px;background:#eef1f4;color:var(--muted);border-radius:20px;padding:1px 7px;font-weight:600}
.pill.equity{background:#e9f0ec;color:var(--bid)}.tab.on .pill{background:#dcebee;color:var(--accent)}

.body{padding:20px 22px 60px}.pad{padding:40px}.empty{text-align:center;color:var(--muted);padding:26px}
.panelhead{display:flex;justify-content:space-between;align-items:flex-end;gap:16px;margin-bottom:12px;flex-wrap:wrap}
.panelctl{display:flex;align-items:flex-end;gap:10px;flex-wrap:wrap}
.ccy{font-family:ui-monospace,monospace;font-size:11px;font-weight:600;color:var(--accent);background:#dcebee;padding:2px 8px;border-radius:6px;margin-left:6px}
.ccy.equity{color:var(--bid);background:#e2efe8}
.loginwrap{min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px}
.logincard{background:#fff;border:1px solid var(--line);border-radius:14px;padding:28px;width:340px;display:flex;flex-direction:column;gap:14px;box-shadow:0 10px 40px rgba(15,22,32,.06)}
.logincard .brand{margin-bottom:6px}
.loginerr{color:var(--ask);font-size:13px}
.syncbox{margin-left:8px}
.syncerr{color:var(--ask);font-size:12px;font-weight:600}
.bumpbox{display:flex;align-items:center;gap:6px;border:1px solid var(--line);border-radius:8px;padding:5px 8px;background:var(--surface)}
.bumpin{width:52px;font-family:ui-monospace,monospace;text-align:right;border:1px solid var(--line);border-radius:5px;padding:4px 6px;font-size:12px}

.bulkbar{display:flex;align-items:center;gap:8px;flex-wrap:wrap;background:#eef6f7;border:1px solid #cfe4e8;border-radius:10px;padding:8px 12px;margin-bottom:10px;font-size:12.5px}
.bulkbar b{color:var(--accent-d)}
.chip{font-family:inherit;font-size:12px;border:1px solid #c4dbdf;background:#fff;color:var(--accent-d);border-radius:7px;padding:5px 10px;cursor:pointer}
.chip:hover{background:#f4fafb}.chip.danger{color:var(--ask);border-color:#f0d4d0}.chip.ghost{color:var(--muted);border-color:var(--line)}
.chipsel{font-family:inherit;font-size:12px;border:1px solid #c4dbdf;border-radius:7px;padding:5px 8px;background:#fff;color:var(--accent-d)}
.sep{width:1px;height:20px;background:#cfe4e8}

/* ---- aligned grid: header sits directly above each column; inputs are boxed ---- */
.tablewrap{overflow-x:auto;border:1px solid var(--line);border-radius:10px;background:var(--surface)}
table.grid{border-collapse:collapse;width:100%;font-size:12px}
table.grid th{background:#fafbfc;color:var(--muted);font-weight:600;font-size:10px;letter-spacing:.02em;text-transform:uppercase;height:34px;padding:0 var(--gut);text-align:left;border-bottom:1px solid var(--line);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
table.grid th.c{text-align:center;padding:0}
table.grid th.ask{color:var(--ask)}table.grid th.bid{color:var(--bid)}
table.grid td{height:36px;border-bottom:1px solid #eef1f4;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;vertical-align:middle}
table.grid td.num,table.grid td.tx{padding:0 var(--gut);text-align:left;font-family:ui-monospace,monospace;font-variant-numeric:tabular-nums}
table.grid td.tx{font-family:inherit}
table.grid td.c{padding:0 4px;text-align:center}
table.grid td.pin{padding:3px 3px}
table.grid td.ask{color:var(--ask)}table.grid td.bid{color:var(--bid)}
table.grid tr:last-child td{border-bottom:none}
table.grid tbody tr:hover{background:#fafcfd}
tr.inactive{opacity:.45}tr.inactive:hover{opacity:.8}
tr.selrow2{outline:2px solid var(--accent);outline-offset:-2px}
.daystag{font-size:9.5px;color:var(--muted);margin-left:6px;background:#f0f2f5;border-radius:8px;padding:0 5px}
.soon{color:var(--ask);font-weight:600}

/* boxed inputs: header aligns to the box's left edge */
.ci{width:100%;height:30px;border:0;box-shadow:inset 0 0 0 1px var(--line);border-radius:6px;background:#fff;padding:0 8px;font-family:inherit;font-size:12px;color:var(--ink);outline:none;text-align:left}
.ci:hover{box-shadow:inset 0 0 0 1px #c9d2db}
.ci:focus{box-shadow:inset 0 0 0 2px var(--accent)}
.ci.num{font-family:ui-monospace,monospace;font-variant-numeric:tabular-nums}
.ci.sym{font-family:ui-monospace,monospace;font-weight:600}
.ci.mono2{font-family:ui-monospace,monospace;font-size:11px}
.mini-chk{display:inline-flex;align-items:center;gap:2px;font-size:10px;font-weight:600;cursor:pointer;margin:0 4px}
.mini-chk.ask{color:var(--ask)}.mini-chk.bid{color:var(--bid)}.mini-chk input{margin:0;accent-color:currentColor;cursor:pointer}
/* ---- CSS-grid panel: header and every row share ONE column template — cannot drift ---- */
.gwrap{overflow-x:auto;border:1px solid var(--line);border-radius:10px;background:var(--surface)}
.grid2{width:max-content}
.grow{display:grid;align-items:stretch}
.ghead{background:#fafbfc;border-bottom:1px solid var(--line);position:sticky;top:0;z-index:1}
.gbody{border-bottom:1px solid #eef1f4}
.gbody:last-child{border-bottom:none}
.gbody:hover{background:#fafcfd}
.gbody.inactive{opacity:.45}.gbody.inactive:hover{opacity:.8}
.gbody.selrow2{outline:2px solid var(--accent);outline-offset:-2px}
.gcell{display:flex;align-items:center;height:36px;overflow:hidden;white-space:nowrap;min-width:0}
.gh{padding:0 11px;font-size:10px;font-weight:600;letter-spacing:.02em;text-transform:uppercase;color:var(--muted)}
.gh.ask{color:var(--ask)}.gh.bid{color:var(--bid)}
.gc-v{padding:0 11px;font-family:ui-monospace,monospace;font-variant-numeric:tabular-nums;font-size:12px;overflow:hidden;text-overflow:ellipsis;display:block;line-height:36px}
.gc-v.ask{color:var(--ask)}.gc-v.bid{color:var(--bid)}
.gc-in{padding:0 3px}
.gc-c{justify-content:center;padding:0 4px}
.gempty{padding:26px;text-align:center;color:var(--muted)}
.footnote{font-size:11px;color:var(--muted);margin-top:10px;line-height:1.6}.footnote b{color:var(--ink)}.footnote .ask{color:var(--ask)}.footnote .bid{color:var(--bid)}

.single{display:flex;flex-direction:column;gap:18px}
.selrow{display:flex;gap:16px;align-items:flex-end;flex-wrap:wrap}
.selwrap{position:relative}.selwrap select{appearance:none;width:100%;font-size:14px;padding:9px 34px 9px 11px;border:1px solid var(--line);border-radius:8px;background:#fff;font-family:inherit;cursor:pointer}
.selchev{position:absolute;right:10px;top:11px;color:var(--muted);pointer-events:none}
.bondtag{background:var(--surface);border:1px solid var(--line);border-radius:10px;padding:10px 16px;min-width:260px}
.bt-sym{font-family:ui-monospace,monospace;font-weight:700;font-size:16px;color:var(--accent)}.bt-meta{color:var(--muted);font-size:11.5px;margin-top:2px}
.metrics{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:1px;background:var(--line);border:1px solid var(--line);border-radius:10px;overflow:hidden}
.metric{background:var(--surface);padding:11px 14px}.mk{font-size:10.5px;color:var(--muted);text-transform:uppercase;letter-spacing:.03em;font-weight:600}.mv{font-size:15px;margin-top:3px;font-weight:600}
.charts{display:grid;grid-template-columns:1fr 1fr;gap:16px}
.card{background:var(--surface);border:1px solid var(--line);border-radius:12px;padding:14px 16px 8px}.card.wide{grid-column:1/-1}
.cardhd{font-size:13px;font-weight:600;margin-bottom:10px;display:flex;gap:8px;align-items:center;flex-wrap:wrap}.cardhd .muted{font-weight:400}
table.mini{width:100%;border-collapse:collapse;font-size:12px}
table.mini th{color:var(--muted);font-weight:600;font-size:10.5px;text-transform:uppercase;text-align:right;padding:6px 8px;border-bottom:1px solid var(--line)}
table.mini td{text-align:right;padding:6px 8px;border-bottom:1px solid #eef1f4}table.mini tr.hl{background:#f4f8f9;font-weight:600}table.mini tr:last-child td{border-bottom:none}

.presets{display:flex;align-items:center;gap:7px;flex-wrap:wrap;margin-bottom:12px}
.filterbar{display:flex;align-items:flex-end;gap:12px;flex-wrap:wrap;background:var(--surface);border:1px solid var(--line);border-radius:10px;padding:12px 14px;margin-bottom:14px}
.filterbar .field{min-width:130px}
.dlbox{margin-left:auto;display:flex;align-items:center;gap:12px}.dlcount{font-size:12px;color:var(--muted)}.dlcount .ask{color:var(--ask)}.dlcount .bid{color:var(--bid)}
table.ro td{font-size:11.5px}table.ro tr.sellrow{background:#fdfafa}table.ro tr.buyrow{background:#fafdfb}
table.ro td.ask.b{color:var(--ask)}table.ro td.bid.b{color:var(--bid)}

.modalbg{position:fixed;inset:0;background:rgba(15,22,32,.4);display:flex;align-items:center;justify-content:center;z-index:50;padding:20px;overflow:auto}
.modal{background:#fff;border-radius:14px;padding:20px;width:420px;max-width:100%;display:flex;flex-direction:column;gap:14px;box-shadow:0 20px 60px rgba(0,0,0,.25)}
.modal.wide2{width:880px}
.modalhd{display:flex;align-items:center;gap:9px;font-weight:650;font-size:15px}.modalhd .iconbtn{margin-left:auto}
.frow{display:flex;gap:10px;align-items:flex-end}.frow2{display:flex;gap:10px}.frow2 .field,.frow .field{flex:1}
.modalft{display:flex;justify-content:flex-end;gap:10px;margin-top:4px}
.setgrid{display:grid;grid-template-columns:1fr 1fr 1fr;gap:18px}.setgrid.three{grid-template-columns:1fr 1fr 1fr}
.setsec{display:flex;flex-direction:column;gap:9px}
.colgrid{display:grid;grid-template-columns:1fr;gap:5px;max-height:300px;overflow:auto}
.mmlist{display:flex;flex-direction:column;gap:4px}.mmrow{display:flex;align-items:center;justify-content:space-between;background:#f7f8fa;border:1px solid var(--line);border-radius:7px;padding:5px 6px 5px 10px;font-size:11px}
.flatin{flex:1;font-family:inherit;font-size:12px;border:1px solid var(--line);border-radius:7px;padding:7px 9px;outline:none}.flatin:focus{border-color:var(--accent)}
.togrow{display:flex;align-items:center;gap:8px;font-size:12px;cursor:pointer}.togrow input{accent-color:var(--accent)}
.segtoggle{display:inline-flex;border:1px solid var(--line);border-radius:7px;overflow:hidden}.segtoggle.big{width:100%}
.seg{flex:1;border:none;background:#fff;color:var(--muted);font-family:inherit;font-size:11px;padding:5px 10px;cursor:pointer}.seg.on{background:var(--accent);color:#fff}

@media(max-width:1000px){.charts{grid-template-columns:1fr}.setgrid,.setgrid.three{grid-template-columns:1fr 1fr}}
`;


/* ================================================================== */
function Login({ onIn }) {
  const [u, setU] = useState(""), [p, setP] = useState("");
  const [err, setErr] = useState(null), [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!u.trim() || !p) { setErr("Enter a username and password."); return; }
    setBusy(true); setErr(null);
    try { onIn(await api.login(u.trim(), p)); }
    catch (e) { setErr(e.status === 401 ? "Incorrect username or password." : e.message); }
    finally { setBusy(false); }
  };

  return (
    <div className="app">
      <style>{CSS}</style>
      <div className="loginwrap">
        <div className="logincard">
          <div className="brand"><div className="mark">ALTX</div><div><div className="title">Securities Pricer</div><div className="sub">Depository pricing &amp; batch order desk</div></div></div>
          <label className="field"><span>Username</span>
            <input value={u} autoFocus onChange={(e) => { setU(e.target.value); setErr(null); }}
                   onKeyDown={(e) => e.key === "Enter" && submit()} /></label>
          <label className="field"><span>Password</span>
            <input type="password" value={p} onChange={(e) => { setP(e.target.value); setErr(null); }}
                   onKeyDown={(e) => e.key === "Enter" && submit()} /></label>
          {err && <div className="loginerr">{err}</div>}
          <button className="btn primary" disabled={busy} onClick={submit}>{busy ? "Signing in…" : "Sign in"}</button>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const [user, setUser] = useState(null);
  const [checked, setChecked] = useState(false);

  useEffect(() => { (async () => {
    try { const me = await api.whoami(); if (me.authenticated) setUser(me); } catch (e) {}
    setChecked(true);
  })(); }, []);

  const out = async () => { try { await api.logout(); } catch (e) {} setUser(null); };

  if (!checked) return <div className="app"><style>{CSS}</style><div className="loginwrap"><div className="muted">Loading…</div></div></div>;
  if (!user) return <Login onIn={setUser} />;
  return <Pricer user={user} onLogout={out} />;
}
