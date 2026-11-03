// GET  /api/products   列出产品
// POST /api/products   新增产品（调上游验证 + 类型探测，PRD 6.1 / D32）

import { all, first, run } from "../../_lib/db.js";
import { handle, ok, fail, readJson, ApiError } from "../../_lib/http.js";
import { lookupProduct } from "../../_lib/upstream.js";

export const onRequest = handle(async ({ request, env }) => {
  if (request.method === "GET") {
    return ok(await all(env, "SELECT * FROM products ORDER BY created_at DESC"));
  }
  if (request.method === "POST") {
    const body = await readJson(request);
    const code = String(body.code || "").trim().toUpperCase();
    if (!code) throw new ApiError("VALIDATION_ERROR", "产品代码必填");
    if (!/^[0-9A-Z]{1,24}$/.test(code)) {
      throw new ApiError("VALIDATION_ERROR", "产品代码只支持字母与数字");
    }
    if (await first(env, "SELECT code FROM products WHERE code=?", code)) {
      throw new ApiError("VALIDATION_ERROR", "产品代码已存在");
    }
    const info = await lookupProduct(code);
    if (!info.supported) {
      throw new ApiError("UNSUPPORTED_TYPE", "该产品类型暂不支持，可用手动粘贴方式录入净值");
    }
    const displayName = String(body.displayName || info.name || code).trim();
    const holding =
      body.holdingPeriodDays === "" || body.holdingPeriodDays == null
        ? null
        : Number(body.holdingPeriodDays);
    const maturity = body.maturityDate ? String(body.maturityDate) : null;
    const benchmark = body.benchmark ? String(body.benchmark).trim() : null;
    const rl = String(body.riskLevel || "").toUpperCase();
    const riskLevel = ["R1", "R2", "R3", "R4", "R5"].includes(rl) ? rl : "R2";
    const tradeTime = body.tradeTime ? String(body.tradeTime).trim() : "T+1";
    await run(
      env,
      "INSERT INTO products (code,name,display_name,saa_cod,holding_period_days,maturity_date,benchmark,risk_level,trade_time,status,created_at) VALUES (?,?,?,?,?,?,?,?,?, 'active', ?)",
      code,
      info.name || displayName,
      displayName,
      info.saaCod,
      holding,
      maturity,
      benchmark,
      riskLevel,
      tradeTime,
      new Date().toISOString()
    );
    return ok({ code, name: info.name, displayName, saaCod: info.saaCod, supported: true }, 201);
  }
  return fail("VALIDATION_ERROR", "不支持的请求方法", 405);
});
