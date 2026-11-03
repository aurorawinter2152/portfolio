// GET  /api/transactions?product=&status=   列出交易
// POST /api/transactions                     新增交易（含赎回超持仓校验）

import { all, run } from "../../_lib/db.js";
import { handle, ok, fail, readJson } from "../../_lib/http.js";
import { buildTransaction } from "../../_lib/txbuild.js";

export const onRequest = handle(async ({ request, env }) => {
  if (request.method === "GET") {
    const url = new URL(request.url);
    const product = url.searchParams.get("product");
    const status = url.searchParams.get("status");
    let sql = "SELECT * FROM transactions WHERE 1=1";
    const p = [];
    if (product) {
      sql += " AND product_code=?";
      p.push(product);
    }
    if (status) {
      sql += " AND status=?";
      p.push(status);
    }
    // 买入在前、调整居中、赎回在后（PRD 6.2 同日排序）
    sql +=
      " ORDER BY trade_date ASC, CASE type WHEN 'buy' THEN 0 WHEN 'adjust' THEN 1 ELSE 2 END ASC, created_at ASC";
    return ok(await all(env, sql, ...p));
  }

  if (request.method === "POST") {
    const body = await readJson(request);
    const tx = await buildTransaction(env, body);
    const now = new Date().toISOString();
    await run(
      env,
      "INSERT INTO transactions (id,product_code,type,status,trade_date,nav_date,confirm_date,net_value,shares,gross_amount_cents,fee_amount_cents,net_amount_cents,redeemable_date,apply_date,settle_date,redeem_ratio,note,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
      tx.id,
      tx.product_code,
      tx.type,
      tx.status,
      tx.trade_date,
      tx.nav_date,
      tx.confirm_date,
      tx.net_value,
      tx.shares,
      tx.gross_amount_cents,
      tx.fee_amount_cents,
      tx.net_amount_cents,
      tx.redeemable_date,
      tx.apply_date,
      tx.settle_date,
      tx.redeem_ratio,
      tx.note,
      now,
      now
    );
    return ok({ ...tx, created_at: now, updated_at: now }, 201);
  }
  return fail("VALIDATION_ERROR", "不支持的请求方法", 405);
});
