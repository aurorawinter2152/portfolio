// GET /api/export   导出全部数据为 JSON（PRD 6.6）

import { all } from "../_lib/db.js";
import { handle, ok, fail } from "../_lib/http.js";

export const onRequest = handle(async ({ request, env }) => {
  if (request.method !== "GET") return fail("VALIDATION_ERROR", "不支持的请求方法", 405);
  const products = await all(env, "SELECT * FROM products ORDER BY created_at ASC");
  const transactions = await all(env, "SELECT * FROM transactions ORDER BY trade_date ASC, created_at ASC");
  const netValues = await all(
    env,
    "SELECT product_code,date,unit_net_value,cumulative_net_value,fetched_at FROM net_values ORDER BY product_code ASC, date ASC"
  );
  return ok({
    schemaVersion: "2.1",
    exportedAt: new Date().toISOString(),
    products,
    transactions,
    netValues
  });
});
