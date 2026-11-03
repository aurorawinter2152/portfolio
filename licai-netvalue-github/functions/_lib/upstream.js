// 上游调用：产品查询 + 净值分页全量拉取（PRD 5.3 / 5.5）

import { buildAuthHeaders, UPSTREAM_BASE } from "./sign.js";
import { ApiError } from "./http.js";

async function post(path, body, timeoutMs = 20000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${UPSTREAM_BASE}${path}`, {
      method: "POST",
      headers: buildAuthHeaders(),
      body: JSON.stringify(body ?? {})
    });
    const text = await res.text();
    let parsed = null;
    try { parsed = JSON.parse(text); } catch {}
    return { httpStatus: res.status, parsed };
  } catch (e) {
    throw new ApiError("UNREACHABLE", "边缘节点无法访问上游：" + (e?.message || e), 502);
  } finally {
    clearTimeout(timer);
  }
}

function checkParsed(parsed) {
  if (!parsed) throw new ApiError("UPSTREAM_ERROR", "上游返回非 JSON");
  if (parsed.returnCode === "CFN0511") {
    throw new ApiError("AUTH_FAILED", "上游签名已失效（CFN0511），请改用手动粘贴");
  }
  if (parsed.returnCode !== "SUC0000") {
    throw new ApiError("UPSTREAM_ERROR", parsed.errorMsg || `上游返回 ${parsed.returnCode}`);
  }
}

// 产品查询 + 类型探测（D32）
export async function lookupProduct(code) {
  const { parsed } = await post(
    `/api/ProductInfo/getproductbyprdcode?prdCode=${encodeURIComponent(code)}`,
    {}
  );
  checkParsed(parsed);
  const arr = Array.isArray(parsed.body) ? parsed.body : (parsed.body?.data || []);
  const p = arr[0];
  if (!p) throw new ApiError("NOT_FOUND", "产品代码不存在");
  const saaCod = p.saaCod || p.zsaaCod || null;
  return {
    code,
    name: p.prdName || "",
    brief: p.prdBrief || "",
    saaCod,
    isSA: String(p.isSA) === "1" || p.isSA === true,
    supported: !!saaCod
  };
}

// 拉取净值全量（自动翻页），返回上游原始行数组
export async function fetchAllNetValueRows(code, saaCod, { startDate = "", endDate = "" } = {}) {
  const rows = [];
  let pageIndex = 1;
  let totalPage = 1;
  do {
    const { parsed } = await post("/api/ProductValue/getSAValueByPageOrDate", {
      saaCod,
      funCod: code,
      pageIndex,
      pageSize: 100,
      startDate,
      endDate
    });
    checkParsed(parsed);
    const body = parsed.body || {};
    const data = body.data || body.rows || [];
    for (const r of data) rows.push(r);
    totalPage = Number(body.totalPage || 1) || 1;
    pageIndex++;
  } while (pageIndex <= totalPage && pageIndex <= 500);
  return rows;
}
