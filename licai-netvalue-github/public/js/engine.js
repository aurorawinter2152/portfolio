// 前端收益计算引擎（PRD 第 8 节）
// 输入：products / transactions / netValues（D1 原始行）
// 输出：每个产品的持仓指标 + 汇总 + 曲线。所有金额为「分」，份额/净值为定点 BigInt。

import * as F from "./fixed.js?v=20261102l";

const TX_ORDER = { buy: 0, adjust: 1, redeem: 2 };

// 交易对持仓生效的日期：确认份额时间优先，缺失则退回交易日期（① 持仓从确认份额时间开始算）
function effDate(t) {
  return t.confirm_date || t.trade_date;
}

export function todayStr() {
  return new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
}

export function groupNetValues(netValues) {
  const map = new Map();
  for (const n of netValues) {
    if (!map.has(n.product_code)) map.set(n.product_code, []);
    map.get(n.product_code).push(n);
  }
  for (const arr of map.values()) {
    arr.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    for (const r of arr) r._unitScaled = F.nvToScaled(r.unit_net_value);
  }
  return map;
}

export function groupTransactions(transactions) {
  const map = new Map();
  for (const t of transactions) {
    if (!map.has(t.product_code)) map.set(t.product_code, []);
    map.get(t.product_code).push(t);
  }
  for (const arr of map.values()) {
    arr.sort((a, b) => {
      if (a.trade_date !== b.trade_date) return a.trade_date < b.trade_date ? -1 : 1;
      const oa = TX_ORDER[a.type] ?? 3;
      const ob = TX_ORDER[b.type] ?? 3;
      if (oa !== ob) return oa - ob;
      return (a.created_at || "") < (b.created_at || "") ? -1 : 1;
    });
  }
  return map;
}

// —— 当日收益三态（8.3.1）——
function computeDaily(series, confirmedSorted, today) {
  if (!series.length) return { state: "nodata", amountCents: null };
  const latest = series[series.length - 1];
  const prev = series.length >= 2 ? series[series.length - 2] : null;

  if (latest.date < today) {
    return {
      state: "stale",
      amountCents: null,
      latestDate: latest.date,
      daysAgo: F.daysBetween(today, latest.date)
    };
  }

  if (!prev) {
    // 只有一个净值点，无法计算涨跌（视为真实零涨跌）
    return { state: "zero", amountCents: 0, latestDate: latest.date };
  }

  // 基准份额 = 上一个净值点当日收盘时的持有份额（确认份额时间 <= prev.date）
  let base = 0n;
  for (const t of confirmedSorted) {
    if (effDate(t) > prev.date) break;
    if (t.type === "buy") base += F.sharesToScaled(t.shares) || 0n;
    else if (t.type === "redeem") base -= F.sharesToScaled(t.shares) || 0n;
  }
  const delta = latest._unitScaled - prev._unitScaled;
  if (delta === 0n) {
    return { state: "zero", amountCents: 0, latestDate: latest.date, prevDate: prev.date };
  }
  return {
    state: "normal",
    amountCents: F.pnlCents(base, delta),
    latestDate: latest.date,
    prevDate: prev.date
  };
}

// —— 完整收益曲线（6.4）——
function computeCurve(series, confirmedSorted) {
  if (!series.length || !confirmedSorted.length) return [];
  const firstTradeDate = effDate(confirmedSorted[0]);
  let sh = 0n;
  let buyNet = 0;
  let redeemNet = 0;
  let adjustNet = 0;
  let ti = 0;
  const out = [];
  for (const nv of series) {
    while (ti < confirmedSorted.length && effDate(confirmedSorted[ti]) <= nv.date) {
      const t = confirmedSorted[ti];
      if (t.type === "buy") {
        sh += F.sharesToScaled(t.shares) || 0n;
        buyNet += t.net_amount_cents || 0;
      } else if (t.type === "redeem") {
        sh -= F.sharesToScaled(t.shares) || 0n;
        redeemNet += t.net_amount_cents || 0;
      } else if (t.type === "adjust") {
        adjustNet += t.net_amount_cents || 0;
      }
      ti++;
    }
    if (nv.date < firstTradeDate) continue;
    const mv = F.amountCentsFromShares(sh, nv._unitScaled);
    out.push({
      date: nv.date,
      unit: nv.unit_net_value,
      sharesStr: F.scaledSharesToStr(sh),
      marketValueCents: mv,
      cumProfitCents: mv + redeemNet - buyNet + adjustNet
    });
  }
  return out;
}

// —— 最近可赎回（6.5）——
function computeRedeemable(lots, today) {
  const remaining = lots.filter((l) => l.shares >= 1n && l.redeemableDate);
  if (!remaining.length) return null;
  let minDate = remaining[0].redeemableDate;
  for (const l of remaining) if (l.redeemableDate < minDate) minDate = l.redeemableDate;
  const daysLeft = F.daysBetween(minDate, today);
  return { date: minDate, daysLeft, state: daysLeft <= 0 ? "available" : "waiting" };
}

// —— XIRR 求解（8.3.2）——
function solveXIRR(cfs, firstBuyDate, today) {
  if (!firstBuyDate) return { ok: false, reason: "nodata" };
  if (F.daysBetween(today, firstBuyDate) < 7) return { ok: false, reason: "short" };
  if (cfs.length < 2) return { ok: false, reason: "insufficient" };
  const hasPos = cfs.some((c) => c.amount > 0);
  const hasNeg = cfs.some((c) => c.amount < 0);
  if (!hasPos || !hasNeg) return { ok: false, reason: "insufficient" };
  const sorted = [...cfs].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const t0 = new Date(sorted[0].date + "T00:00:00Z").getTime();
  const yearFrac = (d) => (new Date(d + "T00:00:00Z").getTime() - t0) / 86400000 / 365;
  const npv = (r) => {
    let s = 0;
    for (const c of sorted) s += c.amount / Math.pow(1 + r, yearFrac(c.date));
    return s;
  };
  let lo = -0.9999;
  let hi = 10;
  let flo = npv(lo);
  let fhi = npv(hi);
  if (!isFinite(flo) || !isFinite(fhi) || flo * fhi > 0) return { ok: false, reason: "abnormal" };
  let r = 0.1;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    const fm = npv(mid);
    r = mid;
    if (Math.abs(fm) < 1e-6 || hi - lo < 1e-10) break;
    if (flo * fm <= 0) {
      hi = mid;
      fhi = fm;
    } else {
      lo = mid;
      flo = fm;
    }
  }
  if (!isFinite(r) || Math.abs(r) > 10) return { ok: false, reason: "abnormal" };
  return { ok: true, value: r, reason: null };
}

// —— 单产品计算 ——
export function computeProduct(product, txs, nvs, today = todayStr()) {
  const all = txs || [];
  const pending = all.filter((t) => t.status === "pending");
  // 只把「确认份额时间已到」的确认交易计入持仓与收益（①）
  const confirmed = all.filter((t) => t.status === "confirmed" && effDate(t) <= today);

  let buyNet = 0;
  let redeemNet = 0;
  let adjustNet = 0;
  let shares = 0n;
  const lots = [];
  const cfs = [];

  for (const t of confirmed) {
    if (t.type === "buy") {
      const sh = F.sharesToScaled(t.shares) || 0n;
      shares += sh;
      buyNet += t.net_amount_cents || 0;
      lots.push({ shares: sh, redeemableDate: t.redeemable_date || null });
      cfs.push({ date: t.trade_date, amount: -(t.net_amount_cents || 0) });
    } else if (t.type === "redeem") {
      const sh = F.sharesToScaled(t.shares) || 0n;
      shares -= sh;
      redeemNet += t.net_amount_cents || 0;
      cfs.push({ date: t.trade_date, amount: t.net_amount_cents || 0 });
      let need = sh;
      for (const lot of lots) {
        if (need <= 0n) break;
        if (lot.shares <= 0n) continue;
        const take = need < lot.shares ? need : lot.shares;
        lot.shares -= take;
        need -= take;
      }
    } else if (t.type === "adjust") {
      adjustNet += t.net_amount_cents || 0;
      cfs.push({ date: t.trade_date, amount: t.net_amount_cents || 0 });
    }
  }

  const series = nvs || [];
  const latest = series.length ? series[series.length - 1] : null;
  const prev = series.length >= 2 ? series[series.length - 2] : null;

  const marketValue = latest ? F.amountCentsFromShares(shares, latest._unitScaled) : 0;
  const invested = buyNet - redeemNet;
  const profit = marketValue + redeemNet - buyNet + adjustNet;

  // 曲线/当日收益按「确认份额时间」排序推进
  const effSorted = [...confirmed].sort((a, b) => {
    const ea = effDate(a), eb = effDate(b);
    if (ea !== eb) return ea < eb ? -1 : 1;
    const oa = TX_ORDER[a.type] ?? 3, ob = TX_ORDER[b.type] ?? 3;
    if (oa !== ob) return oa - ob;
    return (a.created_at || "") < (b.created_at || "") ? -1 : 1;
  });
  const daily = computeDaily(series, effSorted, today);
  const curve = computeCurve(series, effSorted);
  const redeemable = computeRedeemable(lots, today);

  const firstBuy = confirmed.find((t) => t.type === "buy");
  const firstBuyDate = firstBuy ? effDate(firstBuy) : null;
  const holdingDays = firstBuyDate ? F.daysBetween(today, firstBuyDate) : null;
  const holdRate = invested > 0 ? profit / invested : null;
  // 持仓年化利率 = 持仓利率 × 365 ÷ 持有天数（简单年化）
  const annualizedRate = holdRate != null && holdingDays && holdingDays > 0 ? (holdRate * 365) / holdingDays : null;
  let terminalDate = latest ? latest.date : null;
  for (const t of confirmed) {
    if (!terminalDate || effDate(t) > terminalDate) terminalDate = effDate(t);
  }
  if (terminalDate && marketValue !== 0) cfs.push({ date: terminalDate, amount: marketValue });
  const xirr = solveXIRR(cfs, firstBuy ? firstBuy.trade_date : null, today);

  const cumulativeDiff =
    latest &&
    latest.cumulative_net_value != null &&
    latest.unit_net_value != null &&
    latest.cumulative_net_value !== latest.unit_net_value;

  return {
    code: product.code,
    displayName: product.display_name || product.name || product.code,
    name: product.name,
    benchmark: product.benchmark || null,
    riskLevel: product.risk_level || "R2",
    tradeTime: product.trade_time || null,
    status: product.status,
    maturityDate: product.maturity_date,
    shares,
    sharesStr: F.scaledSharesToStr(shares),
    marketValueCents: marketValue,
    investedCents: invested,
    profitCents: profit,
    adjustCents: adjustNet,
    daily,
    xirr,
    redeemable,
    latest: latest ? { date: latest.date, unit: latest.unit_net_value } : null,
    prev: prev ? { date: prev.date, unit: prev.unit_net_value } : null,
    pendingCount: pending.length,
    txCount: all.length,
    cumulativeDiff: !!cumulativeDiff,
    holdRate,
    annualizedRate,
    firstBuyDate,
    holdingDays,
    buyNetCents: buyNet,
    dailyWan: daily.amountCents != null && marketValue > 0 ? (daily.amountCents * 10000) / marketValue : null,
    curve,
    confirmedSorted: confirmed
  };
}

// 每日收益明细：每日收益金额(分) + 每日万收(元) + 当日市值
export function dailyRows(product) {
  const out = [];
  let prev = 0;
  for (const c of product.curve) {
    const profit = c.cumProfitCents - prev;
    prev = c.cumProfitCents;
    const wan = c.marketValueCents > 0 ? (profit * 10000) / c.marketValueCents : null;
    out.push({ date: c.date, profitCents: profit, wan, marketValueCents: c.marketValueCents });
  }
  return out;
}

// —— 汇总 ——
// 按截止日计算 XIRR（历史某日/某月的持仓年化）
export function xirrToDate(p, cutoff) {
  const cfs = [];
  let firstBuyDate = null;
  for (const t of p.confirmedSorted || []) {
    if (t.trade_date > cutoff) continue;
    if (t.type === "buy") {
      cfs.push({ date: t.trade_date, amount: -(t.net_amount_cents || 0) });
      if (!firstBuyDate || t.trade_date < firstBuyDate) firstBuyDate = t.trade_date;
    } else if (t.type === "redeem") {
      cfs.push({ date: t.trade_date, amount: t.net_amount_cents || 0 });
    } else if (t.type === "adjust") {
      cfs.push({ date: t.trade_date, amount: t.net_amount_cents || 0 });
    }
  }
  let pt = null;
  for (const c of p.curve || []) {
    if (c.date <= cutoff) pt = c;
    else break;
  }
  const mv = pt ? pt.marketValueCents : 0;
  if (mv !== 0) cfs.push({ date: cutoff, amount: mv });
  return solveXIRR(cfs, firstBuyDate, cutoff);
}

// 组合区间 XIRR（用于「本月年化」）：期初市值 + 期间现金流 + 期末市值
export function rangeXirr(products, transactions, startDate, endDate) {
  const dates = new Set();
  for (const p of products) for (const c of p.curve) dates.add(c.date);
  const sorted = [...dates].sort();
  const maps = products.map((p) => {
    const m = new Map();
    for (const c of p.curve) m.set(c.date, c.marketValueCents);
    return m;
  });
  const carry = products.map(() => 0);
  let v0 = 0;
  let v1 = 0;
  for (const d of sorted) {
    for (let i = 0; i < products.length; i++) if (maps[i].has(d)) carry[i] = maps[i].get(d);
    const sum = carry.reduce((a, b) => a + b, 0);
    if (d <= startDate) v0 = sum;
    if (d <= endDate) v1 = sum;
  }
  const cfs = [];
  if (v0) cfs.push({ date: startDate, amount: -v0 });
  for (const t of transactions) {
    if (t.status !== "confirmed") continue;
    const eff = t.confirm_date || t.trade_date;
    if (eff <= startDate || eff > endDate) continue;
    if (t.type === "buy") cfs.push({ date: eff, amount: -(t.net_amount_cents || 0) });
    else if (t.type === "redeem") cfs.push({ date: eff, amount: t.net_amount_cents || 0 });
    else if (t.type === "adjust") cfs.push({ date: eff, amount: t.net_amount_cents || 0 });
  }
  if (v1) cfs.push({ date: endDate, amount: v1 });
  return solveXIRR(cfs, startDate, endDate);
}

export function computeAll(data, today = todayStr()) {
  const productsIn = data.products || [];
  const nvMap = groupNetValues(data.netValues || []);
  const txMap = groupTransactions(data.transactions || []);

  const perProduct = productsIn.map((p) =>
    computeProduct(p, txMap.get(p.code) || [], nvMap.get(p.code) || [], today)
  );

  let invested = 0;
  let marketValue = 0;
  let profit = 0;
  let pending = 0;
  let latestDate = null;
  let firstBuyDate = null;
  let dailySum = 0;
  let anyToday = false;
  let anyNormal = false;
  const staleProducts = [];
  const cumulativeWarn = [];
  const cfs = [];

  for (const p of perProduct) {
    invested += p.investedCents;
    marketValue += p.marketValueCents;
    profit += p.profitCents;
    pending += p.pendingCount;
    if (p.latest && (!latestDate || p.latest.date > latestDate)) latestDate = p.latest.date;
    if (p.txCount > 0 && p.latest && p.latest.date < today) staleProducts.push(p.code);
    if (p.cumulativeDiff) cumulativeWarn.push(p.code);

    if (p.daily.state === "normal" || p.daily.state === "zero") {
      anyToday = true;
      dailySum += p.daily.amountCents || 0;
      if (p.daily.state === "normal") anyNormal = true;
    }

    // 聚合 XIRR 现金流
    for (const t of p.confirmedSorted) {
      if (t.type === "buy") {
        cfs.push({ date: t.trade_date, amount: -(t.net_amount_cents || 0) });
        if (!firstBuyDate || t.trade_date < firstBuyDate) firstBuyDate = t.trade_date;
      } else if (t.type === "redeem") {
        cfs.push({ date: t.trade_date, amount: t.net_amount_cents || 0 });
      } else if (t.type === "adjust") {
        cfs.push({ date: t.trade_date, amount: t.net_amount_cents || 0 });
      }
    }
    if (p.latest && p.marketValueCents !== 0) {
      let td = p.latest.date;
      for (const t of p.confirmedSorted) if (t.trade_date > td) td = t.trade_date;
      cfs.push({ date: td, amount: p.marketValueCents });
    }
  }

  let daily;
  if (anyToday) {
    daily = { state: anyNormal ? "normal" : "zero", amountCents: dailySum, latestDate };
  } else if (latestDate) {
    daily = { state: "stale", amountCents: null, latestDate, daysAgo: F.daysBetween(today, latestDate) };
  } else {
    daily = { state: "nodata", amountCents: null, latestDate: null };
  }

  let redeemable = null;
  for (const p of perProduct) {
    if (p.redeemable && (!redeemable || p.redeemable.date < redeemable.date)) {
      redeemable = p.redeemable;
    }
  }

  const xirr = solveXIRR(cfs, firstBuyDate, today);

  const aggregate = {
    investedCents: invested,
    marketValueCents: marketValue,
    profitCents: profit,
    daily,
    pendingCount: pending,
    latestDate,
    staleProducts,
    cumulativeWarn,
    xirr,
    redeemable,
    count: perProduct.length
  };

  return { products: perProduct, aggregate, today };
}
