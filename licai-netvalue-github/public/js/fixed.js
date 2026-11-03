// 前端定点运算（与 functions/_lib/money.js 逻辑一致）
// 金额：整数「分」；净值：定点 6 位；份额：定点 8 位。全部 BigInt，禁止浮点累加（D28）。

export const SCALE_NV = 6;
export const SCALE_SH = 8;

export function parseScaled(str, scale) {
  if (str === null || str === undefined || str === "") return null;
  const s = String(str).trim();
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
  const neg = s.startsWith("-");
  const body = neg ? s.slice(1) : s;
  let [intPart, fracPart = ""] = body.split(".");
  if (fracPart.length > scale) fracPart = fracPart.slice(0, scale);
  fracPart = (fracPart + "0".repeat(scale)).slice(0, scale);
  const v = BigInt(intPart + fracPart);
  return neg ? -v : v;
}

export function scaledToStr(v, scale) {
  const neg = v < 0n;
  let s = (neg ? -v : v).toString();
  s = s.padStart(scale + 1, "0");
  const intPart = s.slice(0, s.length - scale);
  const fracPart = s.slice(s.length - scale);
  return (neg ? "-" : "") + intPart + "." + fracPart;
}

export const nvToScaled = (s) => parseScaled(s, SCALE_NV);
export const sharesToScaled = (s) => parseScaled(s, SCALE_SH);
export const scaledNvToStr = (v) => scaledToStr(v, SCALE_NV);
export const scaledSharesToStr = (v) => scaledToStr(v, SCALE_SH);

export function divRound(num, den) {
  if (den === 0n) throw new Error("divide by zero");
  const neg = num < 0n !== den < 0n;
  const a = num < 0n ? -num : num;
  const b = den < 0n ? -den : den;
  let q = a / b;
  const r = a % b;
  if (r * 2n >= b) q += 1n;
  return neg ? -q : q;
}

// 份额(scaled8) = 本金(分) ÷ 净值
export function sharesFromPrincipal(principalCents, nvScaled6) {
  return divRound(BigInt(principalCents) * 10n ** 12n, nvScaled6);
}

// 金额(分) = 份额(scaled8) × 净值(scaled6)
export function amountCentsFromShares(sharesScaled8, nvScaled6) {
  return Number(divRound(sharesScaled8 * nvScaled6, 10n ** 12n));
}

// 当日收益(分) = 基准份额(scaled8) × 净值差(scaled6)
export function pnlCents(baseSharesScaled8, nvDeltaScaled6) {
  return Number(divRound(baseSharesScaled8 * nvDeltaScaled6, 10n ** 12n));
}

// 费率(%) → 手续费（分）：手续费 = 基数 × 费率 / 100
export function feeCentsFromRate(baseCents, ratePctStr) {
  const rs = parseScaled(ratePctStr, 4); // 百分数，保留 4 位小数
  if (rs == null) return null;
  return Number(divRound(BigInt(baseCents || 0) * rs, 10n ** 6n));
}

// 由手续费金额与基数反推费率(%)（用于编辑时回填）
export function rateFromFee(baseCents, feeCents) {
  if (!baseCents) return "0";
  const scaled = divRound(BigInt(feeCents || 0) * 10n ** 6n, BigInt(baseCents));
  return scaledToStr(scaled, 4).replace(/0+$/, "").replace(/\.$/, "");
}

// 「元」字符串 → 整数分（字符串解析，避免浮点）
export function yuanToCents(str) {
  if (str === null || str === undefined || str === "") return null;
  const s = String(str).trim();
  if (!/^-?\d+(\.\d{0,2})?$/.test(s)) return null;
  const neg = s.startsWith("-");
  const body = neg ? s.slice(1) : s;
  const [i, f = ""] = body.split(".");
  const cents = BigInt(i) * 100n + BigInt((f + "00").slice(0, 2));
  const v = Number(cents);
  return neg ? -v : v;
}

// 整数分 → 「元」字符串（2 位小数）
export function centsToYuan(cents) {
  const neg = cents < 0;
  const a = Math.abs(Math.trunc(cents));
  const yuan = Math.floor(a / 100);
  const cent = a % 100;
  return (neg ? "-" : "") + yuan + "." + String(cent).padStart(2, "0");
}

// 千分位 + 2 位小数，带正负号
export function fmtMoney(cents, { sign = false } = {}) {
  const neg = cents < 0;
  const a = Math.abs(Math.trunc(cents));
  const yuan = Math.floor(a / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const cent = String(a % 100).padStart(2, "0");
  let out = (neg ? "-" : sign && cents > 0 ? "+" : "") + yuan + "." + cent;
  return out;
}

// 份额展示（最多 4 位小数，去尾零）
export function fmtShares(sharesStr) {
  if (!sharesStr) return "0";
  const [i, f = ""] = String(sharesStr).split(".");
  const frac = f.slice(0, 4).replace(/0+$/, "");
  return frac ? `${i}.${frac}` : i;
}

// 百分比展示
export function fmtPercent(rate, digits = 2) {
  if (rate === null || rate === undefined || !isFinite(rate)) return "—";
  return (rate * 100).toFixed(digits) + "%";
}

// 日期差（dateStr 为 YYYY-MM-DD，a-b 的天数）
export function daysBetween(a, b) {
  const da = new Date(a + "T00:00:00Z").getTime();
  const db = new Date(b + "T00:00:00Z").getTime();
  return Math.round((da - db) / 86400000);
}

// 日期加天数
export function addDays(dateStr, n) {
  const d = new Date(dateStr + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
