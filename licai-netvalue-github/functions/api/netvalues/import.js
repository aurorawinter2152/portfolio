// POST /api/netvalues/import  { raw }   手动粘贴原始 JSON 导入净值（PRD 6.7 / D26）

import { all } from "../../_lib/db.js";
import { handle, ok, fail, readJson, ApiError } from "../../_lib/http.js";
import { parseNetValuePayload } from "../../_lib/parse.js";

const UPSERT =
  "INSERT INTO net_values (product_code,date,unit_net_value,cumulative_net_value,fetched_at) VALUES (?,?,?,?,?) " +
  "ON CONFLICT(product_code,date) DO UPDATE SET unit_net_value=excluded.unit_net_value, cumulative_net_value=excluded.cumulative_net_value, fetched_at=excluded.fetched_at";

export const onRequest = handle(async ({ request, env }) => {
  if (request.method !== "POST") return fail("VALIDATION_ERROR", "不支持的请求方法", 405);
  const body = await readJson(request);
  const raw = typeof body.raw === "string" ? body.raw : body;
  const rows = parseNetValuePayload(raw);
  if (!rows.length) throw new ApiError("VALIDATION_ERROR", "未解析到任何净值记录");

  const codes = [...new Set(rows.map((r) => r.productCode))];
  const placeholders = codes.map(() => "?").join(",");
  const existing = await all(
    env,
    `SELECT product_code,date FROM net_values WHERE product_code IN (${placeholders})`,
    ...codes
  );
  const keyset = new Set(existing.map((r) => r.product_code + "|" + r.date));

  const fetchedAt = new Date().toISOString();
  let inserted = 0;
  let skipped = 0;
  const stmts = [];
  for (const r of rows) {
    const k = r.productCode + "|" + r.date;
    if (keyset.has(k)) skipped++;
    else inserted++;
    stmts.push(env.DB.prepare(UPSERT).bind(r.productCode, r.date, r.unit, r.cumulative, fetchedAt));
  }
  for (let i = 0; i < stmts.length; i += 50) {
    await env.DB.batch(stmts.slice(i, i + 50));
  }
  return ok({ inserted, skipped });
});
