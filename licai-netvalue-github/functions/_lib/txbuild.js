// 交易录入的统一规范化与校验（POST 与 PUT 共用）

import { all } from "./db.js";
import { ApiError, todayCN } from "./http.js";
import {
  nvToScaled,
  sharesToScaled,
  sharesFromPrincipal,
  amountCentsFromShares,
  scaledSharesToStr,
  scaledNvToStr
} from "./money.js";

async function heldSharesUpTo(env, code, date, excludeId) {
  const rows = await all(
    env,
    "SELECT id,type,shares FROM transactions WHERE product_code=? AND status='confirmed' AND trade_date<=?",
    code,
    date
  );
  let sum = 0n;
  for (const r of rows) {
    if (excludeId && r.id === excludeId) continue;
    const s = sharesToScaled(r.shares) || 0n;
    if (r.type === "buy") sum += s;
    else if (r.type === "redeem") sum -= s;
  }
  return sum;
}

export async function buildTransaction(env, body, { excludeId = null } = {}) {
  const type = body.type;
  const productCode = String(body.productCode || "").trim().toUpperCase();
  const tradeDate = String(body.tradeDate || "").trim();

  if (!["buy", "redeem", "adjust"].includes(type)) {
    throw new ApiError("VALIDATION_ERROR", "交易类型不正确");
  }
  if (!productCode) throw new ApiError("VALIDATION_ERROR", "产品必填");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(tradeDate)) {
    throw new ApiError("VALIDATION_ERROR", "交易日期格式不正确");
  }
  if (tradeDate > todayCN()) {
    throw new ApiError("VALIDATION_ERROR", "交易日期不得晚于今日");
  }
  const prod = await all(env, "SELECT code FROM products WHERE code=?", productCode);
  if (!prod.length) throw new ApiError("NOT_FOUND", "产品不存在");

  const navDate = body.navDate ? String(body.navDate).trim() : null;
  const confirmDate = body.confirmDate ? String(body.confirmDate).trim() : null;
  if (navDate && !/^\d{4}-\d{2}-\d{2}$/.test(navDate)) {
    throw new ApiError("VALIDATION_ERROR", "净值计算时间格式不正确");
  }
  if (confirmDate && !/^\d{4}-\d{2}-\d{2}$/.test(confirmDate)) {
    throw new ApiError("VALIDATION_ERROR", "确认份额时间格式不正确");
  }

  const out = {
    id: body.id || crypto.randomUUID(),
    product_code: productCode,
    type,
    status: "confirmed",
    trade_date: tradeDate,
    nav_date: navDate,
    confirm_date: confirmDate,
    net_value: null,
    shares: null,
    gross_amount_cents: null,
    fee_amount_cents: 0,
    net_amount_cents: null,
    redeemable_date: null,
    apply_date: null,
    settle_date: null,
    redeem_ratio: null,
    note: (body.note || "").trim() || null
  };

  const applyDate = body.applyDate ? String(body.applyDate).trim() : null;
  const settleDate = body.settleDate ? String(body.settleDate).trim() : null;
  if (applyDate && !/^\d{4}-\d{2}-\d{2}$/.test(applyDate)) {
    throw new ApiError("VALIDATION_ERROR", "提交申请时间格式不正确");
  }
  if (settleDate && !/^\d{4}-\d{2}-\d{2}$/.test(settleDate)) {
    throw new ApiError("VALIDATION_ERROR", "赎回完成时间格式不正确");
  }
  out.apply_date = applyDate;
  out.settle_date = settleDate;
  if (body.redeemRatio != null && body.redeemRatio !== "") {
    const r = Number(body.redeemRatio);
    if (!Number.isFinite(r) || r <= 0 || r > 100) {
      throw new ApiError("VALIDATION_ERROR", "赎回比例需在 0~100 之间");
    }
    out.redeem_ratio = String(r);
  }

  if (type === "adjust") {
    const amt = Number(body.amountCents);
    if (!Number.isInteger(amt) || amt === 0) {
      throw new ApiError("VALIDATION_ERROR", "调整金额必须为非零整数（分）");
    }
    out.net_amount_cents = amt;
    return out;
  }

  const fee = Number(body.feeCents == null ? 0 : body.feeCents);
  if (!Number.isInteger(fee) || fee < 0) {
    throw new ApiError("VALIDATION_ERROR", "手续费必须为非负整数（分）");
  }
  out.fee_amount_cents = fee;

  if (type === "buy") {
    const principal = Number(body.principalCents);
    if (!Number.isInteger(principal) || principal <= 0) {
      throw new ApiError("VALIDATION_ERROR", "买入本金必须为正整数（分）");
    }
    out.gross_amount_cents = principal;
    out.net_amount_cents = principal + fee;
    if (body.redeemableDate) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(body.redeemableDate)) {
        throw new ApiError("VALIDATION_ERROR", "可赎回日格式不正确");
      }
      out.redeemable_date = body.redeemableDate;
    }
    const nvStr = body.netValue == null ? "" : String(body.netValue).trim();
    if (nvStr !== "") {
      const nv = nvToScaled(nvStr);
      if (nv === null || nv <= 0n) throw new ApiError("VALIDATION_ERROR", "成交净值格式不正确");
      out.net_value = scaledNvToStr(nv);
      out.shares = scaledSharesToStr(sharesFromPrincipal(principal, nv));
    } else {
      out.status = "pending";
    }
    return out;
  }

  // redeem
  const sh = sharesToScaled(body.shares);
  if (sh === null || sh <= 0n) throw new ApiError("VALIDATION_ERROR", "赎回份额必须为正数");
  out.shares = scaledSharesToStr(sh);
  out.apply_date = applyDate || tradeDate;
  out.confirm_date = settleDate || confirmDate;
  const held = await heldSharesUpTo(env, productCode, out.apply_date, excludeId);
  if (sh > held) throw new ApiError("VALIDATION_ERROR", "赎回份额超过该日期前已确认持仓");

  const amtBody = Number(body.amountCents);
  const nvStr = body.netValue == null ? "" : String(body.netValue).trim();
  if (nvStr !== "") {
    const nv = nvToScaled(nvStr);
    if (nv === null || nv <= 0n) throw new ApiError("VALIDATION_ERROR", "成交净值格式不正确");
    out.net_value = scaledNvToStr(nv);
    out.gross_amount_cents = Number.isInteger(amtBody) && amtBody > 0 ? amtBody : amountCentsFromShares(sh, nv);
    out.net_amount_cents = out.gross_amount_cents - fee;
  } else if (Number.isInteger(amtBody) && amtBody > 0) {
    out.gross_amount_cents = amtBody;
    out.net_amount_cents = amtBody - fee;
    out.status = "pending";
  } else {
    out.status = "pending";
  }
  return out;
}
