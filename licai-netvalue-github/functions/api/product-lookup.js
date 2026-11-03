// GET /api/product-lookup?code=123456A   查询产品 + 类型探测（D32）

import { handle, ok, fail, ApiError } from "../_lib/http.js";
import { lookupProduct } from "../_lib/upstream.js";

export const onRequest = handle(async ({ request }) => {
  if (request.method !== "GET") return fail("VALIDATION_ERROR", "不支持的请求方法", 405);
  const url = new URL(request.url);
  const code = String(url.searchParams.get("code") || "").trim().toUpperCase();
  if (!code) throw new ApiError("VALIDATION_ERROR", "缺少产品代码");
  const info = await lookupProduct(code);
  return ok(info);
});
