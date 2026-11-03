// PUT    /api/products/:code   更新产品
// DELETE /api/products/:code   删除产品（级联删除其交易与净值）

import { all, first, run } from "../../_lib/db.js";
import { handle, ok, fail, readJson, ApiError } from "../../_lib/http.js";

export const onRequest = handle(async ({ request, env, params }) => {
  const code = String(params.code || "").trim().toUpperCase();
  const exists = await first(env, "SELECT * FROM products WHERE code=?", code);
  if (!exists) throw new ApiError("NOT_FOUND", "产品不存在");

  if (request.method === "PUT") {
    const body = await readJson(request);
    const displayName =
      body.displayName === undefined
        ? exists.display_name
        : String(body.displayName).trim() || exists.name || exists.display_name;
    const holding =
      body.holdingPeriodDays === undefined
        ? exists.holding_period_days
        : body.holdingPeriodDays === "" || body.holdingPeriodDays == null
        ? null
        : Number(body.holdingPeriodDays);
    const maturity =
      body.maturityDate === undefined ? exists.maturity_date : body.maturityDate || null;
    const benchmark =
      body.benchmark === undefined ? exists.benchmark : body.benchmark ? String(body.benchmark).trim() : null;
    let riskLevel = exists.risk_level || "R2";
    if (body.riskLevel !== undefined) {
      const rl = String(body.riskLevel).toUpperCase();
      riskLevel = ["R1", "R2", "R3", "R4", "R5"].includes(rl) ? rl : riskLevel;
    }
    const status = body.status || exists.status;
    const tradeTime =
      body.tradeTime === undefined ? exists.trade_time : String(body.tradeTime).trim() || null;
    await run(
      env,
      "UPDATE products SET display_name=?, holding_period_days=?, maturity_date=?, benchmark=?, risk_level=?, trade_time=?, status=? WHERE code=?",
      displayName,
      holding,
      maturity,
      benchmark,
      riskLevel,
      tradeTime,
      status,
      code
    );
    return ok(await first(env, "SELECT * FROM products WHERE code=?", code));
  }

  if (request.method === "DELETE") {
    await env.DB.batch([
      env.DB.prepare("DELETE FROM transactions WHERE product_code=?").bind(code),
      env.DB.prepare("DELETE FROM net_values WHERE product_code=?").bind(code),
      env.DB.prepare("DELETE FROM products WHERE code=?").bind(code)
    ]);
    return ok({ deleted: code });
  }
  return fail("VALIDATION_ERROR", "不支持的请求方法", 405);
});
