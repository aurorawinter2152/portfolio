// PUT    /api/transactions/:id   编辑交易（含待确认补填净值 → 确认）
// DELETE /api/transactions/:id   删除交易

import { first, run } from "../../_lib/db.js";
import { handle, ok, fail, readJson, ApiError } from "../../_lib/http.js";
import { buildTransaction } from "../../_lib/txbuild.js";

export const onRequest = handle(async ({ request, env, params }) => {
  const id = params.id;
  const exists = await first(env, "SELECT * FROM transactions WHERE id=?", id);
  if (!exists) throw new ApiError("NOT_FOUND", "交易不存在");

  if (request.method === "PUT") {
    const body = await readJson(request);
    body.id = id;
    const tx = await buildTransaction(env, body, { excludeId: id });
    const now = new Date().toISOString();
    await run(
      env,
      "UPDATE transactions SET product_code=?,type=?,status=?,trade_date=?,nav_date=?,confirm_date=?,net_value=?,shares=?,gross_amount_cents=?,fee_amount_cents=?,net_amount_cents=?,redeemable_date=?,apply_date=?,settle_date=?,redeem_ratio=?,note=?,updated_at=? WHERE id=?",
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
      id
    );
    return ok(await first(env, "SELECT * FROM transactions WHERE id=?", id));
  }

  if (request.method === "DELETE") {
    await run(env, "DELETE FROM transactions WHERE id=?", id);
    return ok({ deleted: id });
  }
  return fail("VALIDATION_ERROR", "不支持的请求方法", 405);
});
