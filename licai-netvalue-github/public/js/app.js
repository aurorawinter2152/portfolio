// 理财看板 —— 前端主应用
import { computeAll, todayStr, dailyRows, xirrToDate, rangeXirr } from "./engine.js?v=20261102l";
import * as F from "./fixed.js?v=20261102l";
import { api } from "./api.js?v=20261102l";
import { lineChart } from "./chart.js?v=20261102l";
import { calendarHtml } from "./calendar.js?v=20261102l";

const state = {
  data: { products: [], transactions: [], netValues: [] },
  computed: { products: [], aggregate: null, today: todayStr() },
  view: { name: "overview", code: null },
  cal: { mode: "month", ref: todayStr() },
  sort: { field: "wan", dir: "desc" },
  chartSel: {},
  dailyMode: "update",
  loading: true,
  error: null
};

const root = document.getElementById("app");
const sheetRoot = document.getElementById("sheet-root");

// —— 小工具 ——
function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function money(cents, sign = false) {
  const s = F.fmtMoney(cents || 0, { sign });
  return s.startsWith("-") ? "-¥" + s.slice(1) : "¥" + s;
}
function cls(cents) {
  return cents > 0 ? "pos" : cents < 0 ? "neg" : "flat";
}
function fmtDate(d) {
  return d ? d.replace(/-/g, "/") : "—";
}
function fmtDateMD(d) {
  if (!d) return "—";
  const [, m, dd] = d.split("-");
  return `${+m}月${+dd}日`;
}
function toast(msg) {
  const el = document.createElement("div");
  el.className = "banner info";
  el.style.cssText = "position:fixed;left:50%;top:16px;transform:translateX(-50%);z-index:80;box-shadow:var(--shadow)";
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 1800);
}

function recompute() {
  state.computed = computeAll(state.data, todayStr());
}
function refreshView() {
  recompute();
  render();
}
let autoSyncTried = new Set();

const CACHE_KEY = "licai.cache.v2";
function readCache() {
  try {
    const s = localStorage.getItem(CACHE_KEY);
    if (!s) return null;
    const d = JSON.parse(s);
    if (d && Array.isArray(d.products)) return d;
  } catch {}
  return null;
}
function saveCache(d) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(d));
  } catch {}
}

async function loadAll() {
  // 先展示本地缓存，避免每次打开都等跨境请求
  if (!state.data) {
    const c = readCache();
    if (c) {
      state.data = c;
      state.loading = false;
      refreshView();
    }
  }
  if (!state.data) {
    state.loading = true;
    render();
  }
  try {
    // 先拿小的两张表，尽快出页面
    const [products, transactions] = await Promise.all([api.listProducts(), api.listTransactions()]);
    state.data = { products, transactions, netValues: state.data ? state.data.netValues : [] };
    state.error = null;
    state.loading = false;
    refreshView();
    // 净值最大，单独后到
    const netValues = await api.listNetValues();
    state.data = { ...state.data, netValues };
    refreshView();
    saveCache(state.data);
    maybeAutoSync();
  } catch (e) {
    if (!state.data) {
      state.error = e;
      state.loading = false;
      render();
    }
  }
}

// 有产品一条净值都没有时，自动同步一次（避免新录入后数据空白）
async function maybeAutoSync() {
  if (state.error) return;
  const counts = new Map();
  for (const n of state.data.netValues) counts.set(n.product_code, (counts.get(n.product_code) || 0) + 1);
  const missing = state.data.products.filter((p) => !counts.get(p.code) && !autoSyncTried.has(p.code));
  if (!missing.length) return;
  for (const p of missing) autoSyncTried.add(p.code);
  try {
    await api.syncNetValues();
  } catch {}
  await loadAll();
}

// —— 视图 ——
function render() {
  if (state.loading) {
    root.innerHTML = `<div class="loading">加载中…</div>`;
    return;
  }
  if (state.error) {
    root.innerHTML = errorView(state.error);
    return;
  }
  try {
    if (state.view.name === "product") root.innerHTML = productView(state.view.code);
    else if (state.view.name === "records") root.innerHTML = recordsView();
    else root.innerHTML = overviewView();
  } catch (e) {
    console.error(e);
    root.innerHTML = `<div class="card" style="margin-top:30px;color:#b32a22;line-height:1.7">
      <b>页面渲染出错</b><br/>${esc(e.message)}<br/>
      <button class="btn small" style="margin-top:12px" onclick="location.reload()">刷新重试</button>
    </div>`;
  }
}

function errorView(e) {
  if (e && e.auth) {
    return `<div class="card" style="margin-top:40px;text-align:center">
      <div style="font-size:34px;margin-bottom:10px">🔒</div>
      <div style="font-weight:600;margin-bottom:6px">登录已过期</div>
      <div style="color:var(--muted);font-size:13px;margin-bottom:16px">请刷新页面重新通过邮箱验证</div>
      <button class="btn block" onclick="location.reload()">刷新页面</button>
    </div>`;
  }
  return `<div class="card" style="margin-top:40px;text-align:center">
    <div style="font-size:34px;margin-bottom:10px">⚠️</div>
    <div style="font-weight:600;margin-bottom:6px">加载失败</div>
    <div style="color:var(--muted);font-size:13px;margin-bottom:16px">${esc(e?.message || "未知错误")}</div>
    <button class="btn block" data-action="reload">重试</button>
  </div>`;
}

function statusBanner(a) {
  if (!a.latestDate) {
    return `<div class="banner info"><span class="dot" style="background:#2b6df6"></span>尚无净值数据，请先在下方「同步净值」</div>`;
  }
  if (a.latestDate < state.computed.today) {
    const days = F.daysBetween(state.computed.today, a.latestDate);
    return `<div class="banner warn"><span class="dot" style="background:#e8890c"></span>净值更新至 ${fmtDate(a.latestDate)}，已 ${days} 天未更新</div>`;
  }
  return `<div class="banner info"><span class="dot" style="background:#12a25a"></span>净值更新至 ${fmtDate(a.latestDate)}</div>`;
}

function dailyKpiHtml(daily) {
  if (daily.state === "normal" || daily.state === "zero") {
    const c = daily.amountCents > 0 ? "pos" : daily.amountCents < 0 ? "neg" : "flat";
    // 真实零涨跌按 PRD 显示 +0.00（不是「无更新」）
    const amount = daily.state === "zero" ? "+¥0.00" : money(daily.amountCents, true);
    return `<div class="k-value ${daily.state === "zero" ? "flat" : c}">${amount}</div>
      <div class="k-sub">${daily.state === "zero" ? "今日净值持平" : "较上一净值点"}</div>`;
  }
  if (daily.state === "stale") {
    return `<div class="k-value flat">—</div>
      <div class="k-sub">净值更新至 ${fmtDate(daily.latestDate)}（${daily.daysAgo} 天前）</div>`;
  }
  return `<div class="k-value flat">—</div><div class="k-sub">暂无净值</div>`;
}

function xirrText(x) {
  if (!x || !x.ok) {
    return { short: "持有时间过短", insufficient: "—", abnormal: "数据异常", nodata: "—" }[x?.reason] || "—";
  }
  return F.fmtPercent(x.value);
}

function redeemableText(r) {
  if (!r) return "—";
  if (r.state === "available") return "可随时赎回";
  return `${fmtDateMD(r.date)}（还有 ${r.daysLeft} 天）`;
}

// 组合每日序列：{date, cumProfitCents, marketValueCents}（各产品按日向前结转）
function aggregateSeries(products) {
  const dates = new Set();
  for (const p of products) for (const c of p.curve) dates.add(c.date);
  const sorted = [...dates].sort();
  const profitMaps = products.map((p) => {
    const m = new Map();
    for (const c of p.curve) m.set(c.date, c.cumProfitCents);
    return m;
  });
  const mvMaps = products.map((p) => {
    const m = new Map();
    for (const c of p.curve) m.set(c.date, c.marketValueCents);
    return m;
  });
  const cp = products.map(() => 0);
  const cmv = products.map(() => 0);
  return sorted.map((date) => {
    let profit = 0;
    let mv = 0;
    for (let i = 0; i < products.length; i++) {
      if (profitMaps[i].has(date)) cp[i] = profitMaps[i].get(date);
      if (mvMaps[i].has(date)) cmv[i] = mvMaps[i].get(date);
      profit += cp[i];
      mv += cmv[i];
    }
    return { date, cumProfitCents: profit, marketValueCents: mv };
  });
}

function aggregateCurve(products) {
  return aggregateSeries(products).map((s) => ({ date: s.date, value: s.cumProfitCents }));
}

// 组合每日收益（分）：由累计收益相邻差分得到
function seriesDailyMap(series) {
  const map = new Map();
  let prev = 0;
  for (const s of series) {
    map.set(s.date, s.cumProfitCents - prev);
    prev = s.cumProfitCents;
  }
  return map;
}
function aggregateDailyMap(products) {
  return seriesDailyMap(aggregateSeries(products));
}

function heroDaily(daily, updated = 0, total = 0, mode = "update", word = "已更新", title = "当日收益") {
  let c = "flat";
  let val = "—";
  let sub = "暂无净值";
  if (daily.state === "normal" || daily.state === "zero") {
    c = daily.amountCents > 0 ? "pos" : daily.amountCents < 0 ? "neg" : "flat";
    val = daily.state === "zero" ? "+¥0.00" : money(daily.amountCents, true);
    sub = daily.state === "zero"
      ? (mode === "day" ? "今日净值未变动 / 未更新" : "今日净值持平")
      : (mode === "day" ? "按今日净值" : "较上一净值点");
  } else if (daily.state === "stale") {
    val = "—";
    sub = `净值更新至 ${fmtDate(daily.latestDate)}（${daily.daysAgo} 天前）`;
  }
  return `<div class="hero-daily">
    <div class="hero-label">${title}<span class="hero-update">（${word} ${updated}/${total}）</span>${total > 0 && updated === total ? `<span class="hero-allpill">已全部更新</span>` : ""}</div>
    <div class="hero-value ${c}">${val}</div>
  </div>`;
}

function detailCard(title, rows, note = "") {
  return `<div class="cal-detail">
    <div class="cal-detail-title">${esc(title)}</div>
    ${rows.map(([l, v, c]) => `<div class="cal-detail-row"><span>${l}</span><b class="${c}">${v}</b></div>`).join("")}
    ${note ? `<div class="cal-detail-note">${note}</div>` : ""}
  </div>`;
}

function calendarDetail(series, dailyMap, cal) {
  const sel = cal.selected;
  if (!sel) return `<div class="cal-hint">点击某一天 / 月份，查看该期数据</div>`;

  if (sel.length === 7) {
    const prefix = sel;
    let monthProfit = 0;
    for (const [d, v] of dailyMap) if (d.startsWith(prefix)) monthProfit += v;
    const inMonth = series.filter((s) => s.date.startsWith(prefix));
    const before = series.filter((s) => s.date < prefix + "-01");
    const start = before.length ? before[before.length - 1] : null;
    const end = inMonth.length ? inMonth[inMonth.length - 1] : start;
    const startCum = start ? start.cumProfitCents : 0;
    const endCum = end ? end.cumProfitCents : 0;
    const endMv = end ? end.marketValueCents : 0;
    const [y, m] = prefix.split("-");
    return detailCard(`${y}年${+m}月`, [
      ["当月收益", money(monthProfit, true), cls(monthProfit)],
      ["期初累计", money(startCum, true), cls(startCum)],
      ["期末累计", money(endCum, true), cls(endCum)],
      ["月末市值", money(endMv), ""]
    ]);
  }

  const idx = series.findIndex((s) => s.date === sel);
  const has = idx >= 0;
  let cum = 0;
  let mv = 0;
  if (has) {
    cum = series[idx].cumProfitCents;
    mv = series[idx].marketValueCents;
  } else {
    let last = null;
    for (const s of series) if (s.date < sel) last = s;
    cum = last ? last.cumProfitCents : 0;
    mv = last ? last.marketValueCents : 0;
  }
  const profit = dailyMap.has(sel) ? dailyMap.get(sel) : 0;
  const wan = mv > 0 ? (profit * 10000) / mv : null;
  const wc = wan != null ? (wan > 0 ? "pos" : wan < 0 ? "neg" : "flat") : "";
  return detailCard(
    sel,
    [
      ["当日收益", money(profit, true), cls(profit)],
      ["万收", wan != null ? wan.toFixed(2) : "—", wc],
      ["累计收益", money(cum, true), cls(cum)],
      ["当日市值", money(mv), ""]
    ],
    has ? "" : "该日无净值，显示最近一次数据"
  );
}

// 某产品在「选中日期 / 月份 / 最新」下的快照
function periodLabel(sel) {
  if (!sel) return "最新";
  if (sel.length === 7) return `${sel.slice(0, 4)}年${+sel.slice(5, 7)}月`;
  const [, m, d] = sel.split("-");
  return `${+m}月${+d}日`;
}

function monthBounds(y, m) {
  const start = `${y}-${String(m).padStart(2, "0")}-01`;
  const end = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  return { start, end };
}

// T+1 / T+2 的滞后天数
function lagOf(p) {
  const m = /(\d+)/.exec(p.tradeTime || "");
  return m ? Number(m[1]) : 0;
}

// 按“工作日”加减（跳过周六日；不含法定节假日）
function addWorkdays(dateStr, n) {
  const d = new Date(dateStr + "T00:00:00Z");
  const step = n >= 0 ? 1 : -1;
  let left = Math.abs(n);
  while (left > 0) {
    d.setUTCDate(d.getUTCDate() + step);
    const w = d.getUTCDay();
    if (w !== 0 && w !== 6) left--;
  }
  return d.toISOString().slice(0, 10);
}

// 更新日视图：把每只产品的每日收益按 T+N 个“工作日”后移到更新可见日
function shiftedDailyMap(products) {
  const out = new Map();
  for (const p of products) {
    const lag = lagOf(p);
    let prev = 0;
    for (const c of p.curve) {
      const prof = c.cumProfitCents - prev;
      prev = c.cumProfitCents;
      if (!prof) continue;
      const d = lag ? addWorkdays(c.date, lag) : c.date;
      out.set(d, (out.get(d) || 0) + prof);
    }
  }
  return out;
}

// 全站锚点快照：更新日=取 ≤ (锚点 - T+N) 的最近净值点；自然日=只取锚点当天
function effSnapshot(p, anchor, mode) {
  const lag = mode === "update" ? lagOf(p) : 0;
  let useIdx = -1;
  for (let i = 0; i < p.curve.length; i++) {
    const c = p.curve[i];
    if (mode === "update") {
      if (addWorkdays(c.date, lag) === anchor) {
        useIdx = i;
        break;
      }
    } else {
      if (c.date === anchor) {
        useIdx = i;
        break;
      }
      if (c.date > anchor) break;
    }
  }
  // 估值沿用 ≤ anchor 的最近点（当天没有可见更新时，持仓市值仍按最近净值）
  let cIdx = -1;
  for (let i = 0; i < p.curve.length; i++) {
    if (p.curve[i].date <= anchor) cIdx = i;
    else break;
  }
  const carried = cIdx >= 0 ? p.curve[cIdx] : null;
  const use = useIdx >= 0 ? p.curve[useIdx] : null;
  let buy = 0;
  for (const t of p.confirmedSorted) {
    const eff = t.confirm_date || t.trade_date;
    if (eff <= anchor && t.type === "buy") buy += t.net_amount_cents || 0;
  }
  // 是否已持有：首次买入（确认日）≤ 当前锚点
  let firstBuyDate = null;
  for (const t of p.confirmedSorted) {
    if (t.type !== "buy") continue;
    const eff = t.confirm_date || t.trade_date;
    if (!firstBuyDate || eff < firstBuyDate) firstBuyDate = eff;
  }
  const owned = (() => {
    if (!firstBuyDate || firstBuyDate > anchor) return false;
    const firstNavDate = p.curve.length ? p.curve[0].date : null;
    if (!firstNavDate) return false;
    const visibleFrom = mode === "update" ? addWorkdays(firstNavDate, lag) : firstNavDate;
    if (visibleFrom > anchor) return false;
    // 该日已完全赎回的产品不再显示
    let sh = 0n;
    for (const t of p.confirmedSorted) {
      const eff = t.confirm_date || t.trade_date;
      if (eff > anchor) continue;
      const s = F.sharesToScaled(t.shares) || 0n;
      if (t.type === "buy") sh += s;
      else if (t.type === "redeem") sh -= s;
    }
    return sh > 0n;
  })();
  if (!use) {
    const cum = carried ? carried.cumProfitCents : 0;
    const mv = carried ? carried.marketValueCents : 0;
    const invested = mv - cum;
    const xi = carried ? xirrToDate(p, carried.date) : { ok: false };
    return {
      has: false,
      profit: 0,
      cum,
      mv,
      rate: invested > 0 ? cum / invested : null,
      annual: xi.ok ? xi.value : null,
      buy,
      wan: 0,
      ptDate: null,
      owned,
      firstBuyDate,
      asOfMv: mv
    };
  }
  const prev = useIdx >= 1 ? p.curve[useIdx - 1] : null;
  const profit = prev ? use.cumProfitCents - prev.cumProfitCents : use.cumProfitCents;
  const cum = use.cumProfitCents;
  const mv = use.marketValueCents;
  const invested = mv - cum;
  const xi = xirrToDate(p, use.date);
  return {
    has: true,
    profit,
    cum,
    mv,
    rate: invested > 0 ? cum / invested : null,
    annual: xi.ok ? xi.value : null,
    buy,
    wan: mv > 0 ? (profit * 10000) / mv : null,
    ptDate: use.date,
    owned,
    firstBuyDate,
    asOfMv: carried ? carried.marketValueCents : mv
  };
}

// 更新日视图：把每只产品的每日收益按 T+N 后移到“更新可见日”

function periodSnapshot(p, cal, opts = {}) {
  const sel = cal && cal.selected;
  if (!sel) {
    return {
      label: "今日",
      profit: p.daily.amountCents,
      cum: p.profitCents,
      mv: p.marketValueCents,
      rate: p.holdRate,
      annual: p.xirr && p.xirr.ok ? p.xirr.value : null,
      buy: p.buyNetCents,
      wan: p.dailyWan,
      wanLabel: "今日万收"
    };
  }

  if (sel.length === 7) {
    const prefix = sel;
    const inMonth = p.curve.filter((c) => c.date.startsWith(prefix));
    const before = p.curve.filter((c) => c.date < prefix + "-01");
    const start = before.length ? before[before.length - 1] : null;
    const end = inMonth.length ? inMonth[inMonth.length - 1] : start;
    const startCum = start ? start.cumProfitCents : 0;
    const cum = end ? end.cumProfitCents : 0;
    const mv = end ? end.marketValueCents : 0;
    const profit = cum - startCum;
    const invested = mv - cum;
    let buy = 0;
    const endDate = prefix + "-31";
    for (const t of p.confirmedSorted) {
      const eff = t.confirm_date || t.trade_date;
      if (eff <= endDate && t.type === "buy") buy += t.net_amount_cents || 0;
    }
    const endDateStr = end ? end.date : prefix + "-31";
    const rate = invested > 0 ? cum / invested : null;
    const xi = xirrToDate(p, endDateStr);
    return {
      label: `${+prefix.slice(5, 7)}月`,
      profit,
      cum,
      mv,
      rate,
      annual: xi.ok ? xi.value : null,
      buy,
      wan: mv > 0 ? (profit * 10000) / mv : null,
      wanLabel: "当月万收"
    };
  }

  let idx = -1;
  for (let i = 0; i < p.curve.length; i++) {
    if (p.curve[i].date <= sel) idx = i;
    else break;
  }
  const pt = idx >= 0 ? p.curve[idx] : null;
  const prev = idx >= 1 ? p.curve[idx - 1] : null;
  const cum = pt ? pt.cumProfitCents : 0;
  const mv = pt ? pt.marketValueCents : 0;
  const profit = pt && (pt.date === sel || opts.carryProfit) ? (prev ? pt.cumProfitCents - prev.cumProfitCents : pt.cumProfitCents) : 0;
  const invested = mv - cum;
  let buy = 0;
  for (const t of p.confirmedSorted) {
    const eff = t.confirm_date || t.trade_date;
    if (eff <= sel && t.type === "buy") buy += t.net_amount_cents || 0;
  }
  const rate = invested > 0 ? cum / invested : null;
  const xi = xirrToDate(p, sel);
  return {
    label: opts.carryProfit && pt && pt.date !== sel ? periodLabel(pt.date) : periodLabel(sel),
    profit,
    cum,
    mv,
    rate,
    annual: xi.ok ? xi.value : null,
    buy,
    wan: mv > 0 ? (profit * 10000) / mv : null,
    wanLabel: "当日万收"
  };
}

function overviewView() {
  const a = state.computed.aggregate;
  if (!a) return `<div class="loading">计算中…</div>`;
  const products = state.computed.products;
  const today = state.computed.today;
  const defaultSel = state.dailyMode === "update" ? today : addWorkdays(today, -1);
  const monthSel = state.cal.selected && state.cal.selected.length === 7 ? state.cal.selected : null;
  let anchor = state.cal.selected && state.cal.selected.length === 10 ? state.cal.selected : defaultSel;
  if (monthSel) {
    const mb = monthBounds(Number(monthSel.slice(0, 4)), Number(monthSel.slice(5, 7)));
    anchor = mb.end > today ? today : mb.end;
  }
  const ty = Number(today.slice(0, 4));
  const tm = Number(today.slice(5, 7));
  const curB = monthBounds(ty, tm);
  const prevB = monthBounds(tm === 1 ? ty - 1 : ty, tm === 1 ? 12 : tm - 1);
  const monthXirr = rangeXirr(products, state.data.transactions, curB.start, anchor);
  const prevEnd = anchor >= prevB.start && anchor <= prevB.end ? anchor : prevB.end;
  const prevMonthXirr = rangeXirr(products, state.data.transactions, prevB.start, prevEnd);
  // 年视图的月年化在拿到 calMap/series 后再算（跟随模式与展示收益）
  const effs = products.map((p) => ({ p, e: effSnapshot(p, anchor, state.dailyMode) }));
  const ownedEffs = effs.filter((x) => x.e.owned);
  const asOfMvBase = ownedEffs.reduce((s, x) => s + (x.e.asOfMv || 0), 0);
  let asOfMv = asOfMvBase;
  let updatedCount = ownedEffs.filter((x) => x.e.has).length;
  let ownedCount = ownedEffs.length;
  let monthProfit = 0;
  let monthMv = 0;
  let monthHas = 0;
  let monthCount = 0;
  if (monthSel) {
    for (const p of products) {
      const e = effSnapshot(p, anchor, "day");
      if (!e.owned) continue;
      const s = periodSnapshot(p, { selected: monthSel });
      monthProfit += s.profit || 0;
      monthMv += s.mv || 0;
      monthCount++;
      if (p.curve.some((c) => c.date.startsWith(monthSel))) monthHas++;
    }
    asOfMv = monthMv;
    updatedCount = monthHas;
    ownedCount = monthCount;
  }
  const pendingInfo = (p) => {
    let amt = 0;
    let sh = 0n;
    for (const t of state.data.transactions) {
      if (t.product_code !== p.code || t.type !== "redeem" || t.status !== "pending") continue;
      amt += t.net_amount_cents ?? t.gross_amount_cents ?? 0;
      sh += F.sharesToScaled(t.shares) || 0n;
    }
    const cur = p.shares || 0n;
    return { amt, full: sh > 0n && cur > 0n && sh >= cur };
  };
  const decorate = (p, s) => {
    const pi = pendingInfo(p);
    s.pendingAmt = pi.amt;
    s.fullRedeem = pi.full;
    return { p, s };
  };
  const series = aggregateSeries(products);
  const dailyMap = seriesDailyMap(series);
  const calMap = state.dailyMode === "update" ? shiftedDailyMap(products) : dailyMap;
  // 顶部「当日收益」= 日历选中日：更新日=该日更新出来的收益；自然日=该日真实收益
  const heroCents = monthSel ? monthProfit : calMap.get(anchor) || 0;
  const heroData = { state: heroCents === 0 ? "zero" : "normal", amountCents: heroCents };

  // 年视图：月年化用 XIRR（真实现金流 + 市值）
  let yearMonthXirr = null;
  if (state.cal.mode === "year") {
    const yy = Number(state.cal.ref.slice(0, 4));
    yearMonthXirr = new Map();
    for (let m = 1; m <= 12; m++) {
      const b = monthBounds(yy, m);
      const key = `${yy}-${String(m).padStart(2, "0")}`;
      if (b.start > today) {
        yearMonthXirr.set(key, { ok: false });
        continue;
      }
      const end = b.end > today ? today : b.end;
      yearMonthXirr.set(key, rangeXirr(products, state.data.transactions, b.start, end));
    }
  }
  const allDates = [...new Set([...series.map((s) => s.date), ...calMap.keys()])].sort();
  let si = 0;
  let mvNow = 0;
  const wanPoints = allDates.map((d) => {
    while (si < series.length && series[si].date <= d) {
      mvNow = series[si].marketValueCents;
      si++;
    }
    const profit = calMap.get(d) || 0;
    return { date: d, value: mvNow > 0 ? (profit * 10000) / mvNow : 0 };
  });
  const lastWan = wanPoints.length ? wanPoints[wanPoints.length - 1].value : 0;
  const aggScope = "agg";
  const aggSel = state.chartSel[aggScope] || null;
  const aggPoint = aggSel ? wanPoints.find((x) => x.date === aggSel) : null;
  const hasProducts = ownedEffs.length > 0;
  const txList = [...state.data.transactions].sort((a, b) => {
    const ka = a.trade_date + (a.created_at || "");
    const kb = b.trade_date + (b.created_at || "");
    return ka < kb ? 1 : ka > kb ? -1 : 0;
  });
  const txHtml = txList.length
    ? txList
        .map((t) => {
          const p = products.find((x) => x.code === t.product_code);
          const name = p ? p.displayName : t.product_code;
          const typeLabel = t.type === "buy" ? "买入" : t.type === "redeem" ? "赎回" : "调整";
          const amt = t.type === "buy" ? t.net_amount_cents || 0 : t.net_amount_cents ?? t.gross_amount_cents ?? 0;
          const st = t.status === "pending" ? `<span class="tx-badge pending">待确认</span>` : "";
          const ratio = t.redeem_ratio ? ` · ${t.redeem_ratio}%` : "";
          return `<div class="tx-row">
            <div class="tx-main">
              <div class="tx-name">${esc(name)}<span class="tx-type ${t.type}">${typeLabel}</span>${st}</div>
              <div class="tx-date">${t.trade_date}${ratio}</div>
            </div>
            <div class="tx-amt ${t.type === "buy" ? "" : "pos"}">${money(amt, t.type === "adjust")}</div>
          </div>`;
        })
        .join("")
    : `<div class="empty" style="padding:18px">暂无交易记录</div>`;

  const pendingBar = a.pendingCount > 0
    ? `<div class="banner warn tap" data-action="pending"><span class="dot" style="background:#e8890c"></span>${a.pendingCount} 笔交易待确认<span class="arrow">›</span></div>`
    : "";

  const cumWarn = a.cumulativeWarn.length
    ? `<div class="banner warn"><span class="dot" style="background:#e8890c"></span>有产品累计净值≠单位净值（可能分红），建议录入调整</div>`
    : "";

  const enriched = monthSel
    ? products
        .map((p) => {
          const e = effSnapshot(p, anchor, "day");
          if (!e.owned) return null;
          const s = periodSnapshot(p, { selected: monthSel });
          s.has = p.curve.some((c) => c.date.startsWith(monthSel));
          s.owned = true;
          return decorate(p, s);
        })
        .filter(Boolean)
    : ownedEffs.map(({ p, e }) => {
    const s = {
      has: e.has,
      profit: e.profit,
      cum: e.cum,
      mv: e.mv,
      rate: e.rate,
      annual: e.annual,
      buy: e.buy,
      wan: e.wan,
      wanLabel: state.dailyMode === "day" ? "当日万收" : state.cal.selected ? "当日万收" : "今日万收",
      label: state.dailyMode === "day"
        ? periodLabel(anchor)
        : state.cal.selected
        ? e.ptDate
          ? periodLabel(e.ptDate)
          : periodLabel(anchor)
        : "今日"
    };
    return decorate(p, s);
  });
  const sortKey = (e) => {
    const s = e.s;
    switch (state.sort.field) {
      case "daily": return s.profit ?? -Infinity;
      case "cum": return s.cum ?? -Infinity;
      case "rate": return s.rate ?? -Infinity;
      case "annual": return s.annual ?? -Infinity;
      case "buy": return s.buy ?? -Infinity;
      case "wan":
      default: return s.wan ?? -Infinity;
    }
  };
  enriched.sort((a, b) => {
    const fa = a.s.fullRedeem ? 1 : 0;
    const fb = b.s.fullRedeem ? 1 : 0;
    if (fa !== fb) return fa - fb;
    return state.sort.dir === "asc" ? sortKey(a) - sortKey(b) : sortKey(b) - sortKey(a);
  });

  const productList = hasProducts
    ? enriched.map(({ p, s }) => {
        const pc = cls(s.cum);
        const profitCls = s.has && s.profit != null ? cls(s.profit) : "flat";
        const profitText = s.has ? (s.profit != null ? money(s.profit, true) : "—") : "未更新";
        const wanText = s.has ? (s.wan != null ? s.wan.toFixed(2) : "—") : "未更新";
        const wc = s.has && s.wan != null ? (s.wan > 0 ? "pos" : s.wan < 0 ? "neg" : "flat") : "flat";
        const rateText = s.rate != null ? F.fmtPercent(s.rate) : "—";
        const annualText = s.annual != null ? F.fmtPercent(s.annual) : "—";
        const annualCls = s.annual != null ? (s.annual > 0 ? "pos" : s.annual < 0 ? "neg" : "flat") : "flat";
        const periodWord = state.cal.selected ? s.label : "今日";
        const badges =
          (p.tradeTime ? `<span class="p-badge t">${esc(p.tradeTime)}</span>` : "") +
          (p.redeemable && p.redeemable.state === "available" ? `<span class="p-badge ok">可赎回</span>` : "");
        return `<div class="p-card" data-action="goto-product" data-code="${esc(p.code)}">
          <div class="p-card-head">
            <div class="p-card-name">${esc(p.displayName)}${badges}</div>
            <div class="p-card-wan">${s.wanLabel} <b class="${wc}">${wanText}</b></div>
            <div class="chev">›</div>
          </div>
          <div class="p-card-meta">
            <span class="meta-left"><span class="p-code-chip">${esc(p.code)}</span><span class="p-badge risk">${esc(p.riskLevel || "R2")}</span></span>
            <span class="meta-right">${s.pendingAmt > 0 ? `<span class="p-badge orange">赎回中 ${money(s.pendingAmt)}</span>` : ""}<span class="p-buy">总购入 ${money(s.buy)}</span></span>
          </div>
          <div class="p-card-grid4">
            <div class="pg"><div class="pg-l">${periodWord}收益</div><div class="pg-v ${profitCls}">${profitText}</div></div>
            <div class="pg"><div class="pg-l">持仓收益</div><div class="pg-v ${pc}">${money(s.cum, true)}</div></div>
            <div class="pg"><div class="pg-l">持仓利率</div><div class="pg-v ${pc}">${rateText}</div></div>
            <div class="pg"><div class="pg-l">持仓年化</div><div class="pg-v ${annualCls}">${annualText}</div></div>
          </div>
        </div>`;
      }).join("")
    : `<div class="empty"><div class="big">📈</div>${products.length ? "该日期还没有持仓" : "还没有产品"}<br/><button class="btn small" style="margin-top:12px" data-action="add-product">新增持仓</button></div>`;

  return `
    <div class="topbar"><h1>理财看板</h1><div class="grow"></div>
      <button class="icon-btn" data-action="sync" title="同步净值">⟳</button>
    </div>
    ${""}
    ${pendingBar}
    ${cumWarn}

    <div class="mode-switch">
      <button class="${state.dailyMode === "update" ? "on" : ""}" data-action="daily-mode" data-mode="update">按更新日</button>
      <button class="${state.dailyMode === "day" ? "on" : ""}" data-action="daily-mode" data-mode="day">按自然日</button>
    </div>

    ${heroDaily(heroData, updatedCount, ownedCount, state.dailyMode, state.cal.selected ? "当日更新" : "已更新", monthSel ? `${Number(monthSel.slice(5, 7))}月收益` : "当日收益")}

    <div class="sub-row sub-row-2">
      <div class="card"><div class="s-label">当前市值</div><div class="s-value">${money(asOfMv)}</div></div>
      <div class="card"><div class="s-label">年化（XIRR）</div><div class="s-value">${xirrText(a.xirr)}</div></div>
    </div>
    <div class="sub-row sub-row-2" style="margin-top:8px">
      <div class="card"><div class="s-label">本月年化（XIRR）</div><div class="s-value">${xirrText(monthXirr)}</div></div>
      <div class="card"><div class="s-label">上月年化（XIRR）</div><div class="s-value">${xirrText(prevMonthXirr)}</div></div>
    </div>

    <div class="card">
      ${calendarHtml({ dailyMap: calMap, mode: state.cal.mode, ref: state.cal.ref, today: state.computed.today, selected: monthSel || anchor, monthXirr: yearMonthXirr })}
    </div>

    <div class="section-title row-between">
      <span>我的产品${state.cal.selected ? " · " + periodLabel(state.cal.selected) : `（${ownedCount}）`}</span>
      <span class="sort-inline">
        <select class="mini-select" id="sort-field">
          ${[["wan", "当日万收"], ["daily", "当日收益"], ["cum", "持仓收益"], ["rate", "持仓利率"], ["annual", "持仓年化"], ["buy", "购入金额"]].map(([v, l]) => `<option value="${v}" ${state.sort.field === v ? "selected" : ""}>${l}</option>`).join("")}
        </select>
        <select class="mini-select" id="sort-dir">
          <option value="desc" ${state.sort.dir === "desc" ? "selected" : ""}>↓</option>
          <option value="asc" ${state.sort.dir === "asc" ? "selected" : ""}>↑</option>
        </select>
      </span>
    </div>
    <div class="p-list">${productList}</div>


    <div class="section-title">操作</div>
    <div class="toolbar">
      <button class="tool" data-action="sync"><span class="t-ico">⟳</span>同步净值</button>
      <button class="tool" data-action="add-product"><span class="t-ico">＋</span>新增持仓</button>
      <button class="tool" data-action="paste"><span class="t-ico">⌘</span>手动粘贴净值</button>
      <button class="tool" data-action="open-records"><span class="t-ico">▤</span>交易记录</button>
      <button class="tool" data-action="export"><span class="t-ico">↓</span>导出备份</button>
      <button class="tool" data-action="import"><span class="t-ico">↑</span>导入恢复</button>
    </div>
    <div class="card chart-card" style="margin-top:14px">
      <div class="chart-head"><span class="c-title">单日万收曲线</span>
        <span class="c-value ${aggPoint ? (aggPoint.value > 0 ? "pos" : aggPoint.value < 0 ? "neg" : "flat") : lastWan > 0 ? "pos" : lastWan < 0 ? "neg" : "flat"}">${aggPoint ? `${aggPoint.date.slice(5)} · ${aggPoint.value.toFixed(2)}` : wanPoints.length ? `最新 ${lastWan.toFixed(2)}` : "—"}</span></div>
      <div class="chart-wrap">${lineChart(wanPoints, { id: aggScope, selected: aggSel, scope: aggScope })}</div>
    </div>
    <div style="text-align:center;color:var(--muted);font-size:11.5px;margin-top:18px;line-height:1.6">
      收益由「手动录入交易 + 公开净值」计算，不等同于银行官方实际收益。<br/>不读取、不登录、不操作任何银行账户。
    </div>
  `;
}

function txRowHtml(t) {
  const pending = t.status === "pending";
  const tagText = t.type === "buy" ? "买入" : t.type === "redeem" ? "赎回" : "调整";
  const badge = pending ? `<span class="tx-tag pending">待确认</span>` : "";

  let line2 = t.trade_date;
  if (t.type === "buy") {
    if (t.nav_date) line2 += ` · 净值日 ${t.nav_date}`;
    if (t.confirm_date) line2 += ` · 确认 ${t.confirm_date}`;
    line2 += t.net_value ? ` · 净值 ${t.net_value} · ${F.fmtShares(t.shares)} 份` : " · 净值待确认";
  } else if (t.type === "redeem") {
    line2 += t.net_value ? ` · ${F.fmtShares(t.shares)} 份 @ ${t.net_value}` : ` · ${F.fmtShares(t.shares)} 份 · 净值待确认`;
  } else if (t.type === "adjust" && t.note) {
    line2 += ` · ${esc(t.note)}`;
  }

  let amtHtml;
  if (pending) amtHtml = `<span class="t-amt flat">待确认</span>`;
  else if (t.type === "buy") amtHtml = `<span class="t-amt">-${money(t.net_amount_cents || 0)}</span>`;
  else if (t.type === "redeem") amtHtml = `<span class="t-amt">+${money(t.net_amount_cents || 0)}</span>`;
  else amtHtml = `<span class="t-amt ${cls(t.net_amount_cents || 0)}">${money(t.net_amount_cents || 0, true)}</span>`;

  return `<div class="tx-row">
    <span class="tx-tag ${t.type}">${tagText}</span>
    <div class="tx-main"><div class="t-line1">${badge}${pending ? "" : ""}</div><div class="t-line2">${line2}</div></div>
    <div class="tx-right">${amtHtml}
      <div class="tx-actions">
        <button class="btn ghost small" data-action="edit-tx" data-id="${esc(t.id)}" data-code="${esc(t.product_code)}">编辑</button>
        <button class="btn danger small" data-action="del-tx" data-id="${esc(t.id)}">删除</button>
      </div>
    </div>
  </div>`;
}

function recordsView() {
  const list = [...state.data.transactions].sort((a, b) => {
    const ka = a.trade_date + (a.created_at || "");
    const kb = b.trade_date + (b.created_at || "");
    return ka < kb ? 1 : ka > kb ? -1 : 0;
  });
  const rowOf = (t) => {
    const p = state.data.products.find((x) => x.code === t.product_code);
    const name = p ? p.displayName || p.display_name || p.name || t.product_code : t.product_code;
    const typeLabel = t.type === "buy" ? "买入" : t.type === "redeem" ? "赎回" : "调整";
    const amt = t.type === "buy" ? t.net_amount_cents || 0 : t.net_amount_cents ?? t.gross_amount_cents ?? 0;
    const st = t.status === "pending" ? `<span class="tx-badge pending">待确认</span>` : "";
    const ratio = t.redeem_ratio ? ` · ${t.redeem_ratio}%` : "";
    const nvLabel = t.type === "buy" ? "购入净值" : t.type === "redeem" ? "赎回净值" : "净值";
    const nv = t.net_value ? `${nvLabel} ${t.net_value}` : `${nvLabel} —`;
    const bits = [];
    if (t.type === "buy") {
      bits.push(`买入 ${t.trade_date}`);
      if (t.nav_date) bits.push(`净值日 ${t.nav_date}`);
      if (t.confirm_date) bits.push(`确认 ${t.confirm_date}`);
    } else if (t.type === "redeem") {
      bits.push(`申请 ${t.apply_date || t.trade_date}`);
      if (t.nav_date) bits.push(`净值日 ${t.nav_date}`);
      if (t.settle_date || t.confirm_date) bits.push(`完成 ${t.settle_date || t.confirm_date}`);
    } else {
      bits.push(`调整 ${t.trade_date}`);
    }
    return `<div class="tx-row">
      <div class="tx-main">
        <div class="tx-name"><span class="tx-type ${t.type}">${typeLabel}</span>${esc(name)}${st}${ratio ? `<span class="tx-badge ratio">${t.redeem_ratio}%</span>` : ""}</div>
        <div class="tx-sub">${esc(t.product_code)} · ${nv}</div>
        <div class="tx-dates">${bits.join(" · ")}</div>
      </div>
      <div class="tx-amt ${t.type === "buy" ? "" : "pos"}">${money(amt, t.type === "adjust")}</div>
    </div>`;
  };
  const groups = new Map();
  for (const t of list) {
    const k = t.trade_date.slice(0, 7);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(t);
  }
  const body = list.length
    ? [...groups.entries()]
        .map(([ym, arr]) => `<div class="tx-month">${ym.slice(0, 4)}年${Number(ym.slice(5, 7))}月</div>${arr.map(rowOf).join("")}`)
        .join("")
    : `<div class="empty" style="padding:24px">暂无交易记录</div>`;

  return `
    <div class="topbar">
      <button class="icon-btn" data-action="back">‹</button>
      <div class="grow"></div>
      <span class="section-sub">${list.length} 笔</span>
    </div>
    <h2 style="font-size:18px;margin:2px 0 12px">交易记录</h2>
    <div class="card tx-list">${body}</div>`;
}

function productView(code) {
  const p = state.computed.products.find((x) => x.code === code);
  if (!p) return `<div class="card" style="margin-top:30px">产品不存在或已删除。<button class="btn small" data-action="back">返回</button></div>`;
  const txs = state.data.transactions.filter((t) => t.product_code === code);
  const dRows = dailyRows(p);
  const chartPoints = dRows.map((r) => ({ date: r.date, value: r.wan != null ? r.wan : 0 }));
  const lastWan = chartPoints.length ? chartPoints[chartPoints.length - 1].value : 0;
  const last7 = dRows.slice(-7);
  const zero7 = last7.filter((r) => r.profitCents === 0).length;
  const neg7 = last7.filter((r) => r.profitCents < 0).length;

  const ps = [7, 14, 30, 90].map((n) => {
    const sl = dRows.slice(-n);
    const profit = sl.reduce((s, r) => s + r.profitCents, 0);
    const avgMv = sl.length ? sl.reduce((s, r) => s + r.marketValueCents, 0) / sl.length : 0;
    const wan = avgMv > 0 ? (profit * 10000) / avgMv : null;
    const annual = avgMv > 0 && sl.length > 0 ? (profit / avgMv) * (365 / sl.length) : null;
    return { n, wan, annual };
  });
  const psLabel = (n) => (n === 30 ? "近1月" : n === 90 ? "近3月" : `近${n}日`);

  const chartScope = "p_" + p.code;
  const selDate = state.chartSel[chartScope] || null;
  const selPoint = selDate ? chartPoints.find((x) => x.date === selDate) : null;

  const dailyVal = p.daily.amountCents != null ? money(p.daily.amountCents, true) : "—";
  const dailyCls = p.daily.amountCents != null ? cls(p.daily.amountCents) : "flat";

  return `
    <div class="topbar">
      <button class="icon-btn" data-action="back">‹</button>
      <div class="grow"></div>
      <button class="icon-btn" data-action="del-product" data-code="${esc(p.code)}" title="删除产品">🗑</button>
    </div>

    <div class="p-hero">
      <div class="p-hero-name">${esc(p.displayName)}<button class="p-hero-nameedit" data-action="edit-name" data-code="${esc(p.code)}" title="修改显示名">✎</button></div>
      <div class="p-hero-meta">
        <span class="p-hero-code">${esc(p.code)}</span>
        <span class="p-hero-risk">${esc(p.riskLevel || "R2")}</span>
        ${p.latest ? `<span class="p-hero-nav">净值 ${p.latest.unit} · ${fmtDate(p.latest.date)}</span>` : ""}
      </div>
      <div class="p-hero-bench">
        <span>业绩比较基准</span>
        <b>${p.benchmark ? esc(p.benchmark) : "未填写"}</b>
        <button class="p-hero-edit" data-action="edit-benchmark" data-code="${esc(p.code)}">${p.benchmark ? "修改" : "填写"}</button>
      </div>
      <div class="p-hero-stats">
        <div class="ph"><div class="ph-l">持仓市值</div><div class="ph-v">${money(p.marketValueCents)}</div></div>
        <div class="ph"><div class="ph-l">持仓收益</div><div class="ph-v ${cls(p.profitCents)}">${money(p.profitCents, true)}</div></div>
        <div class="ph"><div class="ph-l">最近可赎回</div><div class="ph-v" style="font-size:13px">${redeemableText(p.redeemable)}</div></div>
      </div>
    </div>

    <div class="stat-strip">
      <div class="ss"><div class="ss-l">持有份额</div><div class="ss-v">${F.fmtShares(p.sharesStr)}</div></div>
      <div class="ss"><div class="ss-l">总投入</div><div class="ss-v">${money(p.investedCents)}</div></div>
      <div class="ss"><div class="ss-l">持仓利率</div><div class="ss-v ${cls(p.profitCents)}">${p.holdRate != null ? F.fmtPercent(p.holdRate) : "—"}</div></div>
      <div class="ss"><div class="ss-l">年化（XIRR）</div><div class="ss-v">${xirrText(p.xirr)}</div></div>
    </div>

    <div class="card">
      <div class="period-grid">
        ${ps.map((x) => `<div class="ps"><div class="ps-l">${psLabel(x.n)}万收</div><div class="ps-v">${x.wan != null ? x.wan.toFixed(2) : "—"}</div></div>`).join("")}
      </div>
      <div class="period-grid" style="margin-top:8px">
        ${ps.map((x) => `<div class="ps"><div class="ps-l">${psLabel(x.n)}年化</div><div class="ps-v ${x.annual != null ? (x.annual > 0 ? "pos" : x.annual < 0 ? "neg" : "flat") : "flat"}">${x.annual != null ? F.fmtPercent(x.annual) : "—"}</div></div>`).join("")}
      </div>
    </div>

    <div class="section-title">每日收益明细 <span class="stat-pill">近7日挂0 <b>${zero7}</b> 次 / 为负 <b>${neg7}</b> 次</span></div>
    <div class="card" style="padding:4px 14px">
      ${(() => {
        const drows = dRows.slice().reverse();
        if (!drows.length) return `<div class="empty">暂无每日收益数据</div>`;
        const rows = drows.slice(0, 90).map((r) => {
          const wc = r.wan != null ? (r.wan > 0 ? "pos" : r.wan < 0 ? "neg" : "flat") : "flat";
          return `<tr>
            <td>${r.date}</td>
            <td class="${cls(r.profitCents)}">${money(r.profitCents, true)}</td>
            <td class="${wc}">${r.wan != null ? r.wan.toFixed(2) : "—"}</td>
          </tr>`;
        }).join("");
        return `<div class="daily-scroll"><table class="daily-table">
          <thead><tr><th>日期</th><th>每日收益</th><th>万收</th></tr></thead>
          <tbody>${rows}</tbody></table></div>`;
      })()}
    </div>

    <div class="section-title">交易记录（${txs.length}）</div>
    <div class="card" style="padding:6px 14px">
      ${txs.length ? txs.map(txRowHtml).join("") : `<div class="empty">还没有交易，点下方按钮录入</div>`}
    </div>

    <div class="card" style="padding:12px">
      <div style="display:flex;gap:10px">
        <button class="btn block" data-action="add-tx" data-code="${esc(p.code)}" data-type="buy">买入</button>
        <button class="btn ghost block" data-action="add-tx" data-code="${esc(p.code)}" data-type="redeem">赎回</button>
        <button class="btn ghost block" data-action="edit-product" data-code="${esc(p.code)}">调整</button>
      </div>
    </div>

    <div class="card chart-card" style="margin-top:14px">
      <div class="chart-head"><span class="c-title">单日万收曲线</span>
        <span class="c-value ${selPoint ? (selPoint.value > 0 ? "pos" : selPoint.value < 0 ? "neg" : "flat") : lastWan > 0 ? "pos" : lastWan < 0 ? "neg" : "flat"}">${selPoint ? `${selPoint.date.slice(5)} · ${selPoint.value.toFixed(2)}` : chartPoints.length ? `最新 ${lastWan.toFixed(2)}` : "—"}</span></div>
      <div class="chart-wrap">${lineChart(chartPoints, { id: chartScope, selected: selDate, scope: chartScope })}</div>
    </div>
  `;
}

// —— 弹层 ——
function openSheet(title, bodyHtml) {
  sheetRoot.innerHTML = `<div class="sheet-backdrop"><div class="sheet">
    <div class="sheet-head"><h3>${esc(title)}</h3><button class="x" id="sheet-x">✕</button></div>
    <div id="sheet-body">${bodyHtml}</div>
  </div></div>`;
  const backdrop = sheetRoot.querySelector(".sheet-backdrop");
  backdrop.addEventListener("click", (e) => {
    if (e.target === backdrop) closeSheet();
  });
  document.getElementById("sheet-x").onclick = closeSheet;
  return sheetRoot.querySelector("#sheet-body");
}
function closeSheet() {
  sheetRoot.innerHTML = "";
}

function findNetValue(code, date) {
  const row = state.data.netValues.find((n) => n.product_code === code && n.date === date);
  return row ? row.unit_net_value : "";
}

// —— 新增持仓（产品 + 首笔买入一页录入）——
function openProductSheet() {
  const today = todayStr();
  const body = openSheet("新增持仓", `
    <div class="field">
      <label>产品代码</label>
      <div style="display:flex;gap:8px">
        <input class="input" id="f-code" placeholder="如 123456A" autocapitalize="characters" />
        <button class="btn" id="f-lookup" style="flex:none">查询</button>
      </div>
      <div class="hint" id="f-lookup-hint">输入代码后点查询，自动带出产品名称</div>
    </div>
    <div class="field"><label>产品名</label><input class="input" id="f-name-auto" readonly placeholder="查询后自动带出，不可修改" style="background:#f3f4f6;color:#5b6470" /></div>
    <div class="field"><label>显示名（选填）</label><input class="input" id="f-name" placeholder="不填则使用产品名" /></div>
    <div class="field"><label>业绩比较基准（选填）</label><input class="input" id="f-benchmark" placeholder="如 3.95%-4.05%，或指数组合" /></div>
    <div class="field"><label>风险等级</label>
      <select class="input" id="f-risk">
        <option value="R1">R1（低风险）</option>
        <option value="R2" selected>R2（中低风险）</option>
        <option value="R3">R3（中风险）</option>
        <option value="R4">R4（中高风险）</option>
        <option value="R5">R5（高风险）</option>
      </select>
    </div>

    <div class="divider"></div>
    <div class="section-title" style="margin:0 0 8px">首笔买入</div>
    <div class="field"><label>买入时间</label><input class="input" id="f-buy-date" type="date" value="${today}" max="${today}" /></div>
    <div class="field"><label>净值计算时间</label><input class="input" id="f-nav-date" type="date" value="${today}" />
      <div class="hint">按该日披露净值计算份额</div></div>
    <div class="field"><label>确认份额时间</label><input class="input" id="f-confirm-date" type="date" value="${F.addDays(today, 1)}" /></div>
    <div class="field"><label>交易时间</label>
      <select class="input" id="f-trade-time">
        <option value="T+0">T+0</option>
        <option value="T+1" selected>T+1</option>
        <option value="T+2">T+2</option>
      </select>
      <div class="hint">会显示在产品名后面</div>
    </div>
    <div class="field"><label>单位净值（必填）</label><input class="input" id="f-nv" inputmode="decimal" placeholder="0.000000" />
      <div class="hint" id="f-nv-hint">选定净值计算时间后自动带出，可手动修改</div></div>
    <div class="field"><label>买入本金（元）</label><input class="input" id="f-principal" inputmode="decimal" placeholder="0.00" /></div>
    <div class="field"><label>最短持有期（天）</label><input class="input" id="f-holding" type="number" inputmode="numeric" placeholder="如 14，用于自动算最早可赎回时间" /></div>
    <div class="field"><label>最早可赎回时间</label><input class="input" id="f-redeemable" type="date" />
      <div class="hint">按买入时间 + 最短持有期自动带入，可修改</div></div>

    <div class="preview" id="f-preview"></div>
    <div class="form-err" id="f-err"></div>
    <button class="btn block" id="f-save">保存并录入买入</button>
  `);

  const q = (s) => body.querySelector(s);
  const v = (s) => q(s).value.trim();
  let looked = null;

  function updatePreview() {
    const nv = v("#f-nv");
    const p = F.yuanToCents(v("#f-principal"));
    let shares = null;
    if (p != null && nv && F.nvToScaled(nv) != null) {
      shares = F.scaledSharesToStr(F.sharesFromPrincipal(p, F.nvToScaled(nv)));
    }
    const rows = [
      ["买入本金", p != null ? money(p) : "—"],
      ["买入实付", p != null ? money(p) : "—"],
      ["份额", shares ? F.fmtShares(shares) + " 份" : "—"]
    ];
    q("#f-preview").innerHTML = rows.map(([l, val]) => `<div class="pv-row"><span class="pv-l">${l}</span><span class="pv-v">${val}</span></div>`).join("");
  }

  async function fillNv() {
    const code = v("#f-code").toUpperCase();
    const date = v("#f-nav-date");
    const nvEl = q("#f-nv");
    const hint = q("#f-nv-hint");
    if (!code || !date || nvEl.dataset.manual) return;
    const local = findNetValue(code, date);
    if (local) {
      nvEl.value = local;
      hint.textContent = "已按净值计算时间自动带出";
      updatePreview();
      return;
    }
    if (!looked || !looked.saaCod) return;
    hint.textContent = "查询该日净值中…";
    try {
      const r = await api.netValueAt(code, looked.saaCod, date);
      if (r && r.unit) {
        nvEl.value = r.unit;
        hint.textContent = "已自动带出该日净值";
        updatePreview();
      } else {
        hint.textContent = "该日未披露净值，请手动填写";
      }
    } catch {
      hint.textContent = "该日未取到净值，请手动填写";
    }
  }

  q("#f-lookup").onclick = async () => {
    const code = v("#f-code").toUpperCase();
    const hint = q("#f-lookup-hint");
    if (!code) return;
    hint.textContent = "查询中…";
    try {
      const info = await api.lookupProduct(code);
      looked = info;
      hint.textContent = info.supported ? "✓ " + info.name : "⚠️ 非 SA 类产品，暂不支持自动拉取（可用手动粘贴净值）";
      q("#f-name-auto").value = info.name || info.brief || code;
      fillNv();
    } catch (e) {
      hint.textContent = "查询失败：" + e.message;
    }
  };

  q("#f-nav-date").onchange = () => fillNv();
  q("#f-buy-date").onchange = () => {
    // ① 净值计算时间默认跟随买入时间；手动改过则以手动为准
    const navEl = q("#f-nav-date");
    if (navEl && !navEl.dataset.manual) {
      navEl.value = v("#f-buy-date");
      fillNv();
    }
    // ⑦ 确认份额时间默认 T+1（手动改过则以手动为准）
    const cEl = q("#f-confirm-date");
    if (cEl && !cEl.dataset.manual) cEl.value = F.addDays(v("#f-buy-date"), 1);
    syncRedeemable();
    updatePreview();
  };
  q("#f-nav-date").addEventListener("input", () => { q("#f-nav-date").dataset.manual = "1"; });
  q("#f-confirm-date").addEventListener("input", () => { q("#f-confirm-date").dataset.manual = "1"; });
  q("#f-holding").addEventListener("input", () => { syncRedeemable(); updatePreview(); });
  q("#f-redeemable").addEventListener("input", () => { q("#f-redeemable").dataset.manual = "1"; });
  q("#f-nv").addEventListener("input", () => { q("#f-nv").dataset.manual = "1"; });
  body.querySelectorAll("input").forEach((inp) => inp.addEventListener("input", updatePreview));
  syncRedeemable();

  // 最早可赎回时间 = 买入时间 + 最短持有期（手动改过则不再覆盖）
  function syncRedeemable() {
    const rEl = q("#f-redeemable");
    if (!rEl || rEl.dataset.manual) return;
    const h = Number(v("#f-holding"));
    const d = v("#f-buy-date");
    rEl.value = h > 0 && d ? F.addDays(d, h) : "";
  }

  q("#f-save").onclick = async () => {
    const err = q("#f-err");
    err.textContent = "";
    const code = v("#f-code").toUpperCase();
    const name = v("#f-name");
    const benchmark = v("#f-benchmark");
    const risk = v("#f-risk") || "R2";
    const tradeTime = v("#f-trade-time") || "T+1";
    const holding = v("#f-holding");
    const buyDate = v("#f-buy-date");
    const navDate = v("#f-nav-date");
    const confirmDate = v("#f-confirm-date");
    const nv = v("#f-nv");
    const principalCents = F.yuanToCents(v("#f-principal"));
    const feeCents = 0;

    if (!code) { err.textContent = "请填写产品代码"; return; }
    if (!buyDate) { err.textContent = "请选择买入时间"; return; }
    if (!navDate) { err.textContent = "请选择净值计算时间"; return; }
    if (!confirmDate) { err.textContent = "请选择确认份额时间"; return; }
    if (!nv || F.nvToScaled(nv) == null) { err.textContent = "请填写单位净值"; return; }
    if (principalCents == null || principalCents <= 0) { err.textContent = "请填写买入本金"; return; }

    const btn = q("#f-save");
    btn.disabled = true;
    btn.textContent = "保存中…";
    try {
      let created = false;
      try {
        await api.createProduct({ code, displayName: name || undefined, holdingPeriodDays: holding || null, benchmark: benchmark || null, riskLevel: risk, tradeTime });
        created = true;
        try {
          await api.syncNetValues(code);
        } catch {}
      } catch (e) {
        // 产品已存在 → 直接为该产品补录这笔买入
        if (!String(e.message || "").includes("已存在")) throw e;
      }
      await api.createTransaction({
        type: "buy",
        productCode: code,
        tradeDate: buyDate,
        navDate,
        confirmDate,
        principalCents,
        feeCents,
        netValue: nv,
        redeemableDate: v("#f-redeemable") || null
      });
      closeSheet();
      await loadAll();
      toast(created ? "已新增产品并录入买入" : "已为已有产品录入买入");
    } catch (e) {
      err.textContent = e.message;
      btn.disabled = false;
      btn.textContent = "保存并录入买入";
    }
  };

  updatePreview();
}

// —— 交易表单 ——
function openTxSheet(code, opts = {}) {
  const { editId = null, type: initialType = "buy" } = opts;
  const existing = editId ? state.data.transactions.find((t) => t.id === editId) : null;
  let type = existing ? existing.type : initialType;
  const cprod = state.computed.products.find((x) => x.code === code);
  const heldSharesStr = cprod ? cprod.sharesStr : "";

  const body = openSheet(existing ? "编辑交易" : "新增交易", `<div id="tx-form"></div>`);
  const host = body.querySelector("#tx-form");

  function draw() {
    host.innerHTML = txFormHtml(code, type, existing);
    bind();
  }

  function val(sel) {
    const el = host.querySelector(sel);
    return el ? el.value.trim() : "";
  }

  function updatePreview() {
    const pv = host.querySelector("#tx-preview");
    if (!pv) return;
    let rows = [];
    if (type === "buy") {
      const principal = F.yuanToCents(val("#tx-principal"));
      const nv = val("#tx-nv");
      let shares = null;
      if (principal != null && nv && F.nvToScaled(nv) != null) {
        shares = F.scaledSharesToStr(F.sharesFromPrincipal(principal, F.nvToScaled(nv)));
      }
      rows.push(["买入本金", principal != null ? money(principal) : "—"]);
      rows.push(["买入实付", principal != null ? money(principal) : "—"]);
      rows.push(["份额", shares ? F.fmtShares(shares) + " 份" : nv ? "—" : "待确认（留空净值）"]);
    } else if (type === "redeem") {
      const sh = val("#tx-shares");
      const nv = val("#tx-nv");
      let gross = null;
      if (sh && nv) {
        const shS = F.sharesToScaled(sh);
        const nvS = F.nvToScaled(nv);
        if (shS != null && nvS != null) gross = F.amountCentsFromShares(shS, nvS);
      }
      rows.push(["赎回份额", sh ? F.fmtShares(sh) + " 份" : "—"]);
      rows.push(["赎回总额", gross != null ? money(gross) : nv ? "—" : "待确认（留空净值）"]);
      rows.push(["赎回到账", gross != null ? money(gross) : "—"]);
    } else {
      const amt = F.yuanToCents(val("#tx-amount"));
      rows.push(["调整金额", amt != null ? money(amt, true) : "—"]);
    }
    pv.innerHTML = rows.map(([l, v]) => `<div class="pv-row"><span class="pv-l">${l}</span><span class="pv-v">${v}</span></div>`).join("");
  }

  function bind() {
    host.querySelectorAll(".seg button").forEach((b) => {
      b.onclick = () => {
        type = b.dataset.type;
        draw();
      };
    });

    const prod = state.data.products.find((p) => p.code === code);
    const dateEl = host.querySelector("#tx-date");
    if (dateEl) {
      dateEl.onchange = () => {
        if (type === "buy") {
          // ① 净值计算时间默认跟随买入时间（手动改过则以手动为准）
          const navEl = host.querySelector("#tx-nav-date");
          if (navEl && !navEl.dataset.manual) {
            navEl.value = dateEl.value;
            fillNv(navEl.value);
          }
          // ⑦ 确认份额时间默认 T+1（手动改过则以手动为准）
          const cEl = host.querySelector("#tx-confirm-date");
          if (cEl && !cEl.dataset.manual) cEl.value = F.addDays(dateEl.value, 1);
          // 最早可赎回时间 = 买入时间 + 最短持有期（未被手动改过才预填）
          const rEl = host.querySelector("#tx-redeemable");
          if (rEl && !rEl.dataset.manual && prod?.holding_period_days) {
            rEl.value = F.addDays(dateEl.value, prod.holding_period_days);
          }
        } else if (type === "redeem") {
          const nvEl = host.querySelector("#tx-nv");
          if (nvEl && !nvEl.value) {
            const nv = findNetValue(code, dateEl.value);
            if (nv) nvEl.value = nv;
          }
        }
        updatePreview();
      };
    }

    // 赎回：比例 → 份额/金额
    if (type === "redeem") {
      const ratioEl = host.querySelector("#tx-ratio");
      const ratioAll = host.querySelector("#tx-ratio-all");
      if (ratioAll) {
        ratioAll.addEventListener("click", () => {
          if (ratioEl) {
            ratioEl.value = "100";
            ratioEl.dispatchEvent(new Event("input"));
          }
        });
      }
      if (ratioEl) {
        ratioEl.addEventListener("input", () => {
          const r = Number(ratioEl.value);
          const held = F.sharesToScaled(heldSharesStr);
          const nv = val("#tx-nv") || (cprod && cprod.latest ? cprod.latest.unit : "");
          if (!isFinite(r) || r <= 0 || !held || !nv) return;
          const sh = (held * BigInt(Math.round(r * 100))) / 10000n;
          const ns = F.nvToScaled(nv);
          const shEl = host.querySelector("#tx-shares");
          if (shEl) shEl.value = F.scaledSharesToStr(sh);
          if (ns != null) {
            const amtEl = host.querySelector("#tx-amount-yuan");
            if (amtEl) amtEl.value = F.centsToYuan(F.amountCentsFromShares(sh, ns));
          }
          updatePreview();
        });
      }
    }

    // 买入：净值计算时间 → 自动带出该日单位净值（本地优先，缺失则向上游查）
    async function fillNv(date) {
      const nvEl = host.querySelector("#tx-nv");
      if (!nvEl || !date || nvEl.dataset.manual) return;
      let nv = findNetValue(code, date);
      if (!nv) {
        const p = state.data.products.find((x) => x.code === code);
        if (p && p.saa_cod) {
          try {
            const r = await api.netValueAt(code, p.saa_cod, date);
            if (r && r.unit) nv = r.unit;
          } catch {}
        }
      }
      if (nv) {
        nvEl.value = nv;
        updatePreview();
      }
    }
    const navDateEl = host.querySelector("#tx-nav-date");
    if (navDateEl) {
      navDateEl.onchange = () => fillNv(navDateEl.value);
      navDateEl.addEventListener("input", () => { navDateEl.dataset.manual = "1"; });
    }
    // 打开表单时若无净值，按默认净值日自动拉取一次
    if (type === "buy") {
      const nvEl = host.querySelector("#tx-nv");
      if (nvEl && !nvEl.value) {
        const nd = host.querySelector("#tx-nav-date");
        if (nd && nd.value) fillNv(nd.value);
      }
    }
    const confEl = host.querySelector("#tx-confirm-date");
    if (confEl) confEl.addEventListener("input", () => { confEl.dataset.manual = "1"; });
    const rdEl = host.querySelector("#tx-redeemable");
    if (rdEl) rdEl.addEventListener("input", () => { rdEl.dataset.manual = "1"; });

    host.querySelectorAll("input").forEach((inp) =>
      inp.addEventListener("input", (e) => {
        if (e.target.id === "tx-nv") e.target.dataset.manual = "1";
        updatePreview();
      })
    );
    host.querySelectorAll("#tx-save").forEach((btn) => (btn.onclick = save));
    updatePreview();
  }

  async function save() {
    const err = host.querySelector("#tx-err");
    err.textContent = "";
    const tradeDate = val("#tx-date");
    const note = val("#tx-note");
    if (!tradeDate) {
      err.textContent = type === "buy" ? "请选择买入时间" : "请选择交易日期";
      return;
    }
    let payload;
    if (type === "buy") {
      const navDate = val("#tx-nav-date");
      const confirmDate = val("#tx-confirm-date");
      const netValue = val("#tx-nv");
      const principalCents = F.yuanToCents(val("#tx-principal"));
      const feeCents = 0;
      // 四项必填：买入时间、净值计算时间、确认份额时间、单位净值
      if (!navDate) { err.textContent = "请选择净值计算时间"; return; }
      if (!confirmDate) { err.textContent = "请选择确认份额时间"; return; }
      if (principalCents == null || principalCents <= 0) { err.textContent = "请输入正确的买入本金"; return; }
      if (!netValue) { err.textContent = "请填写单位净值（会按净值计算时间自动带出）"; return; }
      if (F.nvToScaled(netValue) == null) { err.textContent = "单位净值格式不正确"; return; }
      payload = { type: "buy", productCode: code, tradeDate, navDate, confirmDate, principalCents, feeCents, netValue, redeemableDate: val("#tx-redeemable") || null, note };
    } else if (type === "redeem") {
      let shares = val("#tx-shares");
      const nv = val("#tx-nv");
      const applyDate = tradeDate;
      const settleDate = val("#tx-settle-date") || null;
      const ratio = val("#tx-ratio");
      const amountCents = F.yuanToCents(val("#tx-amount-yuan"));
      if (!shares && amountCents != null && nv && F.nvToScaled(nv) != null) {
        shares = F.scaledSharesToStr(F.sharesFromPrincipal(amountCents, F.nvToScaled(nv)));
      }
      if (!shares) {
        err.textContent = "请输入赎回份额（或赎回金额 + 单位净值）";
        return;
      }
      const feeCents = 0;
      payload = {
        type: "redeem",
        productCode: code,
        tradeDate: applyDate,
        applyDate,
        settleDate,
        redeemRatio: ratio || null,
        amountCents: amountCents == null ? null : amountCents,
        shares,
        feeCents,
        netValue: nv || null,
        note
      };
    } else {
      const amountCents = F.yuanToCents(val("#tx-amount"));
      if (amountCents == null || amountCents === 0) {
        err.textContent = "请输入非零调整金额";
        return;
      }
      payload = { type: "adjust", productCode: code, tradeDate, amountCents, note };
    }

    const btn = host.querySelector("#tx-save");
    btn.disabled = true;
    btn.textContent = "保存中…";
    try {
      if (editId) await api.updateTransaction(editId, payload);
      else await api.createTransaction(payload);
      closeSheet();
      await loadAll();
    } catch (e) {
      err.textContent = e.message;
      btn.disabled = false;
      btn.textContent = existing ? "保存修改" : "保存";
    }
  }

  draw();
}

function txFormHtml(code, type, existing) {
  const product = state.data.products.find((p) => p.code === code) || {};
  const today = todayStr();
  const dateVal = existing?.trade_date || today;
  const navDateVal = existing?.nav_date || dateVal;
  const confirmDateVal = existing?.confirm_date || F.addDays(dateVal, 1);
  const autoNv = existing?.net_value || findNetValue(code, navDateVal) || "";
  const redeemableDefault = existing?.redeemable_date || (product.holding_period_days ? F.addDays(dateVal, product.holding_period_days) : "");

  const seg = `<div class="seg">
    <button data-type="buy" class="${type === "buy" ? "on" : ""}">买入</button>
    <button data-type="redeem" class="${type === "redeem" ? "on" : ""}">赎回</button>
    <button data-type="adjust" class="${type === "adjust" ? "on" : ""}">调整</button>
  </div>`;

  const dateLabel = type === "buy" ? "买入时间" : type === "redeem" ? "提交申请时间" : "交易日期";
  const dateField = `<div class="field"><label>${dateLabel}</label><input class="input" id="tx-date" type="date" value="${dateVal}" max="${today}" /></div>`;

  let fields = "";
  if (type === "buy") {
    const principalVal = existing && existing.type === "buy" ? F.centsToYuan(existing.gross_amount_cents || 0) : "";
    fields = `
      <div class="field"><label>净值计算时间</label><input class="input" id="tx-nav-date" type="date" value="${navDateVal}" />
        <div class="hint">按该日披露净值计算份额，单位净值会自动带出</div></div>
      <div class="field"><label>确认份额时间</label><input class="input" id="tx-confirm-date" type="date" value="${confirmDateVal}" /></div>
      <div class="field"><label>单位净值（必填）</label><input class="input" id="tx-nv" inputmode="decimal" placeholder="0.000000" value="${esc(autoNv)}" />
        <div class="hint">已按净值计算时间自动带出，可手动修改</div></div>
      <div class="field"><label>买入本金（元）</label><input class="input" id="tx-principal" inputmode="decimal" placeholder="0.00" value="${principalVal}" /></div>
      <div class="field"><label>最早可赎回时间</label><input class="input" id="tx-redeemable" type="date" value="${redeemableDefault}" />
        <div class="hint">按买入时间 + 最短持有期预填，可手动修改</div></div>
    `;
  } else if (type === "redeem") {
    const sharesVal = existing && existing.type === "redeem" ? existing.shares || "" : "";
    const applyVal = existing && existing.apply_date ? existing.apply_date : dateVal;
    const settleVal = existing && existing.settle_date ? existing.settle_date : confirmDateVal;
    const ratioVal = existing && existing.redeem_ratio ? existing.redeem_ratio : "";
    const amtVal = existing && existing.type === "redeem" ? F.centsToYuan(existing.net_amount_cents || existing.gross_amount_cents || 0) : "";
    fields = `
      <div class="field"><label>净值计算时间</label><input class="input" id="tx-nav-date" type="date" value="${navDateVal}" /></div>
      <div class="field"><label>赎回完成时间</label><input class="input" id="tx-settle-date" type="date" value="${settleVal}" /></div>
      <div class="field"><label>赎回比例（%）<button type="button" class="mini-btn" id="tx-ratio-all">全部</button></label><input class="input" id="tx-ratio" inputmode="decimal" placeholder="留空或点“全部”" value="${esc(String(ratioVal))}" />
        <div class="hint">按当前持仓比例自动算份额与金额</div></div>
      <div class="field"><label>赎回金额（元）</label><input class="input" id="tx-amount-yuan" inputmode="decimal" placeholder="按比例自动算" value="${esc(amtVal)}" /></div>
      <div class="field"><label>赎回份额</label><input class="input" id="tx-shares" inputmode="decimal" placeholder="0.0000" value="${esc(sharesVal)}" /></div>
      <div class="field"><label>成交单位净值（可留空）</label><input class="input" id="tx-nv" inputmode="decimal" placeholder="留空 = 待确认" value="${esc(autoNv)}" /></div>
    `;
  } else {
    const amtVal = existing && existing.type === "adjust" ? F.centsToYuan(existing.net_amount_cents || 0) : "";
    fields = `
      <div class="field"><label>调整金额（元，可负）</label><input class="input" id="tx-amount" inputmode="decimal" placeholder="如 12.34 或 -5.00" value="${amtVal}" /></div>
      <div class="hint">用于分红等手工兜底，只影响总收益，不产生份额</div>
    `;
  }

  return `${seg}${dateField}${fields}
    <div class="field"><label>备注（可选）</label><input class="input" id="tx-note" value="${esc(existing?.note || "")}" /></div>
    <div class="preview" id="tx-preview"></div>
    <div class="form-err" id="tx-err"></div>
    <button class="btn block" id="tx-save">${existing ? "保存修改" : "保存"}</button>`;
}

// —— 待确认列表 ——
function openPendingSheet() {
  const pend = state.data.transactions.filter((t) => t.status === "pending");
  const body = openSheet(`待确认交易（${pend.length}）`,
    pend.length
      ? pend.map((t) => {
          const prod = state.data.products.find((p) => p.code === t.product_code);
          return `<div class="tx-row">
            <span class="tx-tag ${t.type}">${t.type === "buy" ? "买入" : t.type === "redeem" ? "赎回" : "调整"}</span>
            <div class="tx-main"><div class="t-line1">${esc(prod?.display_name || t.product_code)}</div>
              <div class="t-line2">${t.trade_date} · ${t.type === "buy" ? "本金 " + money(t.gross_amount_cents || 0) : F.fmtShares(t.shares) + " 份"}</div></div>
            <button class="btn small" data-action="edit-tx" data-id="${esc(t.id)}" data-code="${esc(t.product_code)}">补填净值</button>
          </div>`;
        }).join("")
      : `<div class="empty">没有待确认交易</div>`
  );
}

// —— 手动粘贴 ——
function openPasteSheet() {
  const body = openSheet("手动粘贴净值", `
    <div class="field">
      <label>粘贴招银理财接口返回的原始 JSON</label>
      <textarea class="input" id="paste-raw" placeholder='{"returnCode":"SUC0000","body":{"data":[{"zripNbr":"123456A","znavDat":"20261029","znavVal":"1.008900"}]}}'></textarea>
      <div class="hint">解析 body.data[] 的 zripNbr / znavDat / znavVal，按（产品, 日期）去重入库</div>
    </div>
    <div class="form-err" id="paste-err"></div>
    <button class="btn block" id="paste-save">导入净值</button>
  `);
  body.querySelector("#paste-save").onclick = async () => {
    const raw = body.querySelector("#paste-raw").value.trim();
    const err = body.querySelector("#paste-err");
    err.textContent = "";
    if (!raw) {
      err.textContent = "请先粘贴 JSON";
      return;
    }
    const btn = body.querySelector("#paste-save");
    btn.disabled = true;
    btn.textContent = "导入中…";
    try {
      const r = await api.importNetValues(raw);
      closeSheet();
      toast(`导入完成：新增 ${r.inserted} 条，跳过重复 ${r.skipped} 条`);
      await loadAll();
    } catch (e) {
      err.textContent = e.message;
      btn.disabled = false;
      btn.textContent = "导入净值";
    }
  };
}

// —— 导出 / 导入 ——
function downloadJson(obj, filename) {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(a.href);
    a.remove();
  }, 1000);
}

async function doExport() {
  try {
    const data = await api.exportAll();
    downloadJson(data, `licai-backup-${todayStr()}.json`);
    toast("已导出备份");
  } catch (e) {
    alert("导出失败：" + e.message);
  }
}

function doImportPick() {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "application/json,.json";
  input.onchange = async () => {
    const file = input.files && input.files[0];
    if (!file) return;
    const text = await file.text();
    let payload;
    try {
      payload = JSON.parse(text);
    } catch {
      alert("文件不是合法 JSON");
      return;
    }
    if (!Array.isArray(payload.products) || !Array.isArray(payload.transactions) || !Array.isArray(payload.netValues)) {
      alert("文件格式不正确（需含 products / transactions / netValues）");
      return;
    }
    try {
      const cur = await api.exportAll();
      downloadJson(cur, `licai-backup-before-import-${Date.now()}.json`);
    } catch {}
    const ok = confirm(
      `将覆盖导入：产品 ${payload.products.length} 个、交易 ${payload.transactions.length} 笔、净值 ${payload.netValues.length} 条。\n\n当前数据已自动导出为备份。确定继续？`
    );
    if (!ok) return;
    try {
      await api.importAll(payload);
      toast("导入完成");
      await loadAll();
    } catch (e) {
      alert("导入失败：" + e.message);
    }
  };
  input.click();
}

// —— 同步 ——
async function doSync() {
  toast("正在同步净值…");
  try {
    const r = await api.syncNetValues();
    const entries = Object.entries(r || {});
    const errs = entries.filter(([, v]) => v.error);
    await loadAll();
    if (!entries.length) {
      toast("没有可同步的产品");
      return;
    }
    if (errs.length) {
      alert("部分产品同步失败：\n" + errs.map(([c, v]) => `${c}：${v.message}`).join("\n"));
    } else {
      const total = entries.reduce((s, [, v]) => s + (v.fetched || 0), 0);
      toast(`同步完成，更新 ${total} 条净值`);
    }
  } catch (e) {
    alert("同步失败：" + e.message);
  }
}

async function delTx(id) {
  if (!confirm("确定删除这笔交易？删除后自动重算。")) return;
  try {
    await api.deleteTransaction(id);
    await loadAll();
  } catch (e) {
    alert("删除失败：" + e.message);
  }
}

async function delProduct(code) {
  if (!confirm(`确定删除产品 ${code}？其所有交易与净值将一并删除，且不可恢复。`)) return;
  try {
    await api.deleteProduct(code);
    state.view = { name: "overview", code: null };
    await loadAll();
  } catch (e) {
    alert("删除失败：" + e.message);
  }
}

// —— 事件分发 ——
// —— 排序 ——
function sortFieldLabel() {
  return { wan: "当日万收", daily: "当日收益", cum: "持仓收益", rate: "持仓利率", annual: "持仓年化", buy: "购入金额" }[state.sort.field] || "当日万收";
}

function openSortSheet() {
  const fields = [
    ["wan", "当日万收"],
    ["daily", "当日收益"],
    ["cum", "持仓收益"],
    ["rate", "持仓利率"],
    ["annual", "持仓年化"],
    ["buy", "购入金额"]
  ];
  const body = openSheet("产品排序", `
    <div class="hint" style="margin-bottom:10px">选择排序字段</div>
    <div class="sort-list">
      ${fields.map(([v, l]) => `<button class="sort-item ${state.sort.field === v ? "on" : ""}" data-sort-field="${v}">${l}</button>`).join("")}
    </div>
    <div class="hint" style="margin:14px 0 8px">排序方向</div>
    <div class="seg" style="margin-bottom:4px">
      <button class="${state.sort.dir === "desc" ? "on" : ""}" data-sort-dir="desc">从高到低</button>
      <button class="${state.sort.dir === "asc" ? "on" : ""}" data-sort-dir="asc">从低到高</button>
    </div>
  `);
  body.querySelectorAll("[data-sort-field]").forEach((b) => {
    b.onclick = () => {
      state.sort.field = b.dataset.sortField;
      closeSheet();
      render();
    };
  });
  body.querySelectorAll("[data-sort-dir]").forEach((b) => {
    b.onclick = () => {
      state.sort.dir = b.dataset.sortDir;
      closeSheet();
      render();
    };
  });
}

// —— 编辑产品（调整入口）——
function openProductEditSheet(code) {
  const p = state.data.products.find((x) => x.code === code);
  if (!p) return;
  const tt = p.trade_time || "T+1";
  const ttList = ["T+0", "T+1", "T+2"];
  if (!ttList.includes(tt)) ttList.push(tt);
  const body = openSheet("编辑产品", `
    <div class="field"><label>产品名（不可改）</label><input class="input" readonly value="${esc(p.name || "")}" style="background:#f3f4f6;color:#5b6470" /></div>
    <div class="field"><label>显示名</label><input class="input" id="ep-name" value="${esc(p.display_name || "")}" placeholder="留空则用产品名" /></div>
    <div class="field"><label>最短持有期（天）</label><input class="input" id="ep-holding" type="number" inputmode="numeric" value="${p.holding_period_days ?? ""}" /></div>
    <div class="field"><label>业绩比较基准</label><input class="input" id="ep-bench" value="${esc(p.benchmark || "")}" placeholder="如 3.95%-4.05%" /></div>
    <div class="field"><label>风险等级</label>
      <select class="input" id="ep-risk">
        ${["R1", "R2", "R3", "R4", "R5"].map((r) => `<option value="${r}" ${(p.risk_level || "R2") === r ? "selected" : ""}>${r}</option>`).join("")}
      </select>
    </div>
    <div class="field"><label>交易时间</label>
      <select class="input" id="ep-trade-time">
        ${ttList.map((x) => `<option value="${x}" ${tt === x ? "selected" : ""}>${x}</option>`).join("")}
      </select>
    </div>
    <div class="field"><label>状态</label>
      <select class="input" id="ep-status">
        ${[["active", "持有中"], ["matured", "已到期"], ["closed", "已清仓"]].map(([v, l]) => `<option value="${v}" ${(p.status || "active") === v ? "selected" : ""}>${l}</option>`).join("")}
      </select>
    </div>
    <div class="form-err" id="ep-err"></div>
    <button class="btn block" id="ep-save">保存</button>
    <div class="divider"></div>
    <button class="btn ghost block" id="ep-adjust">收益调整（分红 / 手工纠正）</button>
  `);

  body.querySelector("#ep-save").onclick = async () => {
    const err = body.querySelector("#ep-err");
    err.textContent = "";
    const g = (s) => body.querySelector(s).value.trim();
    const btn = body.querySelector("#ep-save");
    btn.disabled = true;
    btn.textContent = "保存中…";
    try {
      await api.updateProduct(code, {
        displayName: g("#ep-name"),
        holdingPeriodDays: g("#ep-holding") || null,
        benchmark: g("#ep-bench") || null,
        riskLevel: g("#ep-risk"),
        tradeTime: g("#ep-trade-time"),
        status: g("#ep-status")
      });
      closeSheet();
      await loadAll();
      toast("已保存产品信息");
    } catch (e) {
      err.textContent = e.message;
      btn.disabled = false;
      btn.textContent = "保存";
    }
  };
  body.querySelector("#ep-adjust").onclick = () => {
    closeSheet();
    openTxSheet(code, { type: "adjust" });
  };
}

// —— 修改显示名 ——
function openNameSheet(code) {
  const p = state.data.products.find((x) => x.code === code);
  const cur = p ? p.display_name || p.name || "" : "";
  const body = openSheet("修改显示名", `
    <div class="field">
      <label>显示名</label>
      <input class="input" id="nm-input" value="${esc(cur)}" placeholder="留空则使用产品名" />
      <div class="hint">只影响你在列表/详情里看到的名称，不改产品名</div>
    </div>
    <div style="margin:-4px 0 13px"><button class="btn ghost small" id="nm-reset">重置为产品名</button></div>
    <div class="form-err" id="nm-err"></div>
    <button class="btn block" id="nm-save">保存</button>
  `);
  body.querySelector("#nm-reset").onclick = () => {
    const inp = body.querySelector("#nm-input");
    inp.value = p ? p.name || "" : "";
    inp.focus();
  };
  body.querySelector("#nm-save").onclick = async () => {
    const val = body.querySelector("#nm-input").value.trim();
    const err = body.querySelector("#nm-err");
    err.textContent = "";
    try {
      await api.updateProduct(code, { displayName: val });
      closeSheet();
      await loadAll();
      toast("已更新显示名");
    } catch (e) {
      err.textContent = e.message;
    }
  };
}

// —— 业绩比较基准（手动填写）——
function openBenchmarkSheet(code) {
  const p = state.data.products.find((x) => x.code === code);
  const cur = p ? p.benchmark || "" : "";
  const body = openSheet("业绩比较基准", `
    <div class="field">
      <label>业绩比较基准</label>
      <input class="input" id="bm-input" value="${esc(cur)}" placeholder="如 3.95%-4.05%，或指数组合" />
      <div class="hint">官网为 JS 单页应用，服务器抓取受限；可手动填写</div>
    </div>
    <div class="form-err" id="bm-err"></div>
    <button class="btn block" id="bm-save">保存</button>
  `);
  body.querySelector("#bm-save").onclick = async () => {
    const val = body.querySelector("#bm-input").value.trim();
    const err = body.querySelector("#bm-err");
    err.textContent = "";
    try {
      await api.updateProduct(code, { benchmark: val || null });
      closeSheet();
      await loadAll();
      toast("已保存业绩比较基准");
    } catch (e) {
      err.textContent = e.message;
    }
  };
}

document.addEventListener("change", (e) => {
  if (e.target.id === "sort-field") {
    state.sort.field = e.target.value;
    render();
  } else if (e.target.id === "sort-dir") {
    state.sort.dir = e.target.value;
    render();
  }
});

document.addEventListener("click", (e) => {
  const t = e.target.closest("[data-action]");
  if (!t) return;
  const a = t.dataset.action;
  switch (a) {
    case "goto-product":
      state.view = { name: "product", code: t.dataset.code };
      render();
      window.scrollTo(0, 0);
      break;
    case "open-records":
      state.overviewScroll = window.scrollY;
      state.view = { name: "records" };
      render();
      window.scrollTo(0, 0);
      break;
    case "back": {
      const from = state.view.name;
      state.view = { name: "overview", code: null };
      render();
      if (from === "records") {
        const y = state.overviewScroll || 0;
        requestAnimationFrame(() => window.scrollTo(0, y));
      } else {
        window.scrollTo(0, 0);
      }
      break;
    }
    case "reload":
      loadAll();
      break;
    case "sync":
      doSync();
      break;
    case "add-product":
      openProductSheet();
      break;
    case "add-tx":
      openTxSheet(t.dataset.code, { type: t.dataset.type });
      break;
    case "edit-tx":
      closeSheet();
      openTxSheet(t.dataset.code, { editId: t.dataset.id });
      break;
    case "del-tx":
      delTx(t.dataset.id);
      break;
    case "del-product":
      delProduct(t.dataset.code);
      break;
    case "pending":
      openPendingSheet();
      break;
    case "cal-prev":
    case "cal-next": {
      const delta = a === "cal-prev" ? -1 : 1;
      const y = Number(state.cal.ref.slice(0, 4));
      const m = Number(state.cal.ref.slice(5, 7));
      if (state.cal.mode === "year") {
        state.cal.ref = `${y + delta}-01-01`;
      } else {
        const d = new Date(Date.UTC(y, m - 1 + delta, 1));
        state.cal.ref = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-01`;
      }
      state.cal.selected = null;
      render();
      break;
    }
    case "cal-mode":
      state.cal.mode = t.dataset.mode;
      state.cal.selected = null;
      render();
      break;
    case "cal-select":
      state.cal.selected = t.dataset.date;
      render();
      break;
    case "cal-select-month":
      state.cal.selected = t.dataset.month;
      render();
      break;
    case "edit-benchmark":
      openBenchmarkSheet(t.dataset.code);
      break;
    case "edit-name":
      openNameSheet(t.dataset.code);
      break;
    case "edit-product":
      openProductEditSheet(t.dataset.code);
      break;
    case "sort":
      openSortSheet();
      break;
    case "chart-pick":
      state.chartSel[t.dataset.scope] = t.dataset.date;
      render();
      break;
    case "daily-mode":
      state.dailyMode = t.dataset.mode;
      if (!state.cal.selected) {
        const d = state.dailyMode === "update" ? todayStr() : addWorkdays(todayStr(), -1);
        state.cal.ref = d.slice(0, 7) + "-01";
      }
      render();
      break;
    case "paste":
      openPasteSheet();
      break;
    case "export":
      doExport();
      break;
    case "import":
      doImportPick();
      break;
  }
});

// —— 启动 ——
loadAll();
