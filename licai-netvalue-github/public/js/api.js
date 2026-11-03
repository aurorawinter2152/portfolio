// 前端 API 封装：统一 {ok,data} 解析、Access 过期识别

export class ApiError extends Error {
  constructor(code, message, extra = {}) {
    super(message);
    this.code = code;
    Object.assign(this, extra);
  }
}

async function req(method, url, body) {
  let res;
  try {
    res = await fetch(url, {
      method,
      headers: body !== undefined ? { "content-type": "application/json" } : {},
      body: body !== undefined ? JSON.stringify(body) : undefined,
      redirect: "manual"
    });
  } catch (e) {
    throw new ApiError("NETWORK", "网络异常，请检查连接后重试");
  }
  if (res.type === "opaqueredirect" || res.status === 302 || res.status === 401 || res.status === 403) {
    throw new ApiError("AUTH", "登录已过期，请刷新页面重新验证", { auth: true });
  }
  let j = null;
  try {
    j = await res.json();
  } catch {}
  if (!j) throw new ApiError("BAD_RESPONSE", `服务器返回异常（HTTP ${res.status}）`);
  if (!j.ok) throw new ApiError(j.error || "ERROR", j.message || "请求失败");
  return j.data;
}

function qs(params) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params || {})) {
    if (v !== undefined && v !== null && v !== "") p.set(k, v);
  }
  const s = p.toString();
  return s ? "?" + s : "";
}

export const api = {
  listProducts: () => req("GET", "/api/products"),
  createProduct: (b) => req("POST", "/api/products", b),
  updateProduct: (code, b) => req("PUT", `/api/products/${encodeURIComponent(code)}`, b),
  deleteProduct: (code) => req("DELETE", `/api/products/${encodeURIComponent(code)}`),

  listTransactions: (params) => req("GET", "/api/transactions" + qs(params)),
  createTransaction: (b) => req("POST", "/api/transactions", b),
  updateTransaction: (id, b) => req("PUT", `/api/transactions/${encodeURIComponent(id)}`, b),
  deleteTransaction: (id) => req("DELETE", `/api/transactions/${encodeURIComponent(id)}`),

  listNetValues: (params) => req("GET", "/api/netvalues" + qs(params)),
  netValueAt: (code, saa, date) => req("GET", "/api/netvalues/value" + qs({ code, saa, date })),
  lookupProduct: (code) => req("GET", "/api/product-lookup" + qs({ code })),
  syncNetValues: (product) => req("POST", "/api/netvalues/sync", product ? { product } : {}),
  importNetValues: (raw) => req("POST", "/api/netvalues/import", { raw }),

  exportAll: () => req("GET", "/api/export"),
  importAll: (payload) => req("POST", "/api/import", payload)
};
