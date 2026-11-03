// GET /api/netvalues/value?code=&saa=&date=  取某产品某日的单位净值
// 先查 D1，未命中且有 saa 时实时向上游查询该日

import { first } from "../../_lib/db.js";
import { handle, ok, fail, ApiError } from "../../_lib/http.js";
import { fetchAllNetValueRows } from "../../_lib/upstream.js";
import { parseNetValuePayload } from "../../_lib/parse.js";

export const onRequest = handle(async ({ request, env }) => {
  if (request.method !== "GET") return fail("VALIDATION_ERROR", "不支持的请求方法", 405);
  const url = new URL(request.url);
  const code = String(url.searchParams.get("code") || "").trim().toUpperCase();
  const saa = url.searchParams.get("saa");
  const date = String(url.searchParams.get("date") || "").trim();
  if (!code || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new ApiError("VALIDATION_ERROR", "缺少产品代码或日期格式不正确");
  }

  const row = await first(
    env,
    "SELECT unit_net_value FROM net_values WHERE product_code=? AND date=?",
    code,
    date
  );
  if (row) return ok({ code, date, unit: row.unit_net_value });

  if (saa) {
    // 上游日期区间参数格式不稳定，直接拉全量后本地取该日
    const raw = await fetchAllNetValueRows(code, saa, {});
    const rows = parseNetValuePayload({ returnCode: "SUC0000", body: { data: raw } });
    const hit = rows.find((r) => r.date === date);
    if (hit) return ok({ code, date, unit: hit.unit });
  }
  throw new ApiError("NOT_FOUND", "该日期暂无披露净值，请手动填写");
});
