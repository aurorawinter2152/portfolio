// 净值解析：自动拉取与手动粘贴共用同一套解析逻辑（D26）

import { ApiError } from "./http.js";

function fmtDate(z) {
  if (!z) return null;
  const s = String(z).replace(/[^0-9]/g, "");
  if (s.length !== 8) return null;
  return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
}

// 把上游响应（或粘贴的原始 JSON 文本/对象）解析为统一行
// 返回 [{ productCode, date, unit, cumulative }]
export function parseNetValuePayload(text) {
  let j;
  try {
    j = typeof text === "string" ? JSON.parse(text) : text;
  } catch {
    throw new ApiError("VALIDATION_ERROR", "粘贴内容不是合法 JSON");
  }
  if (!j || j.returnCode !== "SUC0000") {
    if (j && j.returnCode === "CFN0511") {
      throw new ApiError("AUTH_FAILED", "上游签名已失效（CFN0511），请改用手动粘贴");
    }
    throw new ApiError("UPSTREAM_ERROR", (j && j.errorMsg) || "上游返回非成功返回码");
  }
  const body = j.body;
  const data = Array.isArray(body) ? body : (body && (body.data || body.rows)) || [];
  const rows = [];
  for (const r of data) {
    const productCode = r.zripNbr || r.funCod || r.zripInn;
    const date = fmtDate(r.znavDat);
    const unit = r.znavVal !== null && r.znavVal !== undefined ? String(r.znavVal) : null;
    const cumulative = r.znavCtl !== null && r.znavCtl !== undefined ? String(r.znavCtl) : null;
    if (!productCode || !date || !unit) continue;
    if (!/^\d+(\.\d+)?$/.test(unit)) continue;
    rows.push({ productCode: String(productCode), date, unit, cumulative });
  }
  return rows;
}
