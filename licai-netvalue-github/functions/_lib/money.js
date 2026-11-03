// 服务端定点运算（与前端 public/js/fixed.js 逻辑一致）
// 金额：整数「分」；净值：定点 6 位；份额：定点 8 位。全部 BigInt，禁止浮点累加（D28）。

export const SCALE_NV = 6;
export const SCALE_SH = 8;

// 字符串 → BigInt 定点值；非法返回 null
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

// BigInt 除法，四舍五入（远离零）
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
