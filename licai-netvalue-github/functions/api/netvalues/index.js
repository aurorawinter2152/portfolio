// GET /api/netvalues?product=&from=&to=

import { all } from "../../_lib/db.js";
import { handle, ok, fail } from "../../_lib/http.js";

export const onRequest = handle(async ({ request, env }) => {
  if (request.method !== "GET") return fail("VALIDATION_ERROR", "不支持的请求方法", 405);
  const url = new URL(request.url);
  const product = url.searchParams.get("product");
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  let sql = "SELECT product_code,date,unit_net_value,cumulative_net_value FROM net_values WHERE 1=1";
  const p = [];
  if (product) {
    sql += " AND product_code=?";
    p.push(product);
  }
  if (from) {
    sql += " AND date>=?";
    p.push(from);
  }
  if (to) {
    sql += " AND date<=?";
    p.push(to);
  }
  sql += " ORDER BY product_code ASC, date ASC";
  return ok(await all(env, sql, ...p));
});
