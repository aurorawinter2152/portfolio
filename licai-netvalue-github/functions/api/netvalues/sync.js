// POST /api/netvalues/sync  { product? }   同步净额（省略则同步全部 active 产品）
// 统一拉全量后 upsert（幂等）；单个产品失败不阻塞其余（PRD 5.5）

import { all, first, run } from "../../_lib/db.js";
import { handle, ok, fail, readJson, ApiError } from "../../_lib/http.js";
import { fetchAllNetValueRows } from "../../_lib/upstream.js";
import { parseNetValuePayload } from "../../_lib/parse.js";

const UPSERT =
  "INSERT INTO net_values (product_code,date,unit_net_value,cumulative_net_value,fetched_at) VALUES (?,?,?,?,?) " +
  "ON CONFLICT(product_code,date) DO UPDATE SET unit_net_value=excluded.unit_net_value, cumulative_net_value=excluded.cumulative_net_value, fetched_at=excluded.fetched_at";

async function upsertRows(env, productCode, rows, fetchedAt) {
  const stmts = rows.map((r) =>
    env.DB.prepare(UPSERT).bind(productCode, r.date, r.unit, r.cumulative, fetchedAt)
  );
  for (let i = 0; i < stmts.length; i += 50) {
    await env.DB.batch(stmts.slice(i, i + 50));
  }
}

export const onRequest = handle(async ({ request, env }) => {
  if (request.method !== "POST") return fail("VALIDATION_ERROR", "不支持的请求方法", 405);
  const body = await readJson(request);
  const only = body.product ? String(body.product).trim().toUpperCase() : null;

  let products;
  if (only) {
    const p = await first(env, "SELECT * FROM products WHERE code=?", only);
    if (!p) throw new ApiError("NOT_FOUND", "产品不存在");
    products = [p];
  } else {
    products = await all(env, "SELECT * FROM products WHERE status='active'");
  }

  const result = {};
  let lastFetch = null;

  for (const p of products) {
    try {
      if (!p.saa_cod) throw new ApiError("UNSUPPORTED_TYPE", "缺少 saaCod，无法自动拉取，请用手动粘贴");
      // 上游日期区间参数格式不稳定，统一拉全量（个人数据量小），upsert 幂等
      const raw = await fetchAllNetValueRows(p.code, p.saa_cod, {});
      const rows = parseNetValuePayload({ returnCode: "SUC0000", body: { data: raw } });
      const fetchedAt = new Date().toISOString();
      await upsertRows(env, p.code, rows, fetchedAt);
      const latest = rows.reduce((m, r) => (r.date > m ? r.date : m), "");
      result[p.code] = {
        fetched: rows.length,
        latestDate: latest || null
      };
      lastFetch = fetchedAt;
    } catch (e) {
      result[p.code] = { fetched: 0, error: e.code || "UPSTREAM_ERROR", message: e.message };
    }
  }

  if (lastFetch) {
    await run(
      env,
      "INSERT INTO meta (key,value) VALUES ('last_fetch_at',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
      lastFetch
    );
  }
  return ok(result);
});
