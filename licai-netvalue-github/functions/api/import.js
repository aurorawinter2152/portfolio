// POST /api/import   覆盖导入（前端已先行导出备份并二次确认，PRD 6.6 / 11）
// body = { schemaVersion, exportedAt, products, transactions, netValues }

import { handle, ok, fail, readJson, ApiError } from "../_lib/http.js";

function chunk(arr, n) {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

export const onRequest = handle(async ({ request, env }) => {
  if (request.method !== "POST") return fail("VALIDATION_ERROR", "不支持的请求方法", 405);
  const body = await readJson(request);
  if (!Array.isArray(body.products) || !Array.isArray(body.transactions) || !Array.isArray(body.netValues)) {
    throw new ApiError("VALIDATION_ERROR", "导入数据格式不正确（缺少 products/transactions/netValues）");
  }

  const productStmt = (p) =>
    env.DB.prepare(
      "INSERT OR REPLACE INTO products (code,name,display_name,saa_cod,holding_period_days,maturity_date,benchmark,risk_level,trade_time,status,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)"
    ).bind(
      p.code,
      p.name ?? p.display_name ?? p.code,
      p.display_name ?? p.name ?? p.code,
      p.saa_cod ?? null,
      p.holding_period_days ?? null,
      p.maturity_date ?? null,
      p.benchmark ?? null,
      p.risk_level ?? "R2",
      p.trade_time ?? null,
      p.status ?? "active",
      p.created_at ?? new Date().toISOString()
    );

  const txStmt = (t) =>
    env.DB.prepare(
      "INSERT OR REPLACE INTO transactions (id,product_code,type,status,trade_date,nav_date,confirm_date,net_value,shares,gross_amount_cents,fee_amount_cents,net_amount_cents,redeemable_date,note,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)"
    ).bind(
      t.id,
      t.product_code,
      t.type,
      t.status ?? "confirmed",
      t.trade_date,
      t.nav_date ?? null,
      t.confirm_date ?? null,
      t.net_value ?? null,
      t.shares ?? null,
      t.gross_amount_cents ?? null,
      t.fee_amount_cents ?? 0,
      t.net_amount_cents ?? null,
      t.redeemable_date ?? null,
      t.note ?? null,
      t.created_at ?? new Date().toISOString(),
      t.updated_at ?? new Date().toISOString()
    );

  const nvStmt = (n) =>
    env.DB.prepare(
      "INSERT OR REPLACE INTO net_values (product_code,date,unit_net_value,cumulative_net_value,fetched_at) VALUES (?,?,?,?,?)"
    ).bind(
      n.product_code,
      n.date,
      n.unit_net_value,
      n.cumulative_net_value ?? null,
      n.fetched_at ?? new Date().toISOString()
    );

  // 先清空（顺序：transactions → net_values → products）
  await env.DB.batch([
    env.DB.prepare("DELETE FROM transactions"),
    env.DB.prepare("DELETE FROM net_values"),
    env.DB.prepare("DELETE FROM products")
  ]);

  // 再写入（products 先于 transactions 满足外键）
  for (const part of chunk(body.products, 50)) await env.DB.batch(part.map(productStmt));
  for (const part of chunk(body.transactions, 50)) await env.DB.batch(part.map(txStmt));
  for (const part of chunk(body.netValues, 50)) await env.DB.batch(part.map(nvStmt));

  return ok({
    imported: {
      products: body.products.length,
      transactions: body.transactions.length,
      netValues: body.netValues.length
    }
  });
});
