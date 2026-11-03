// 统一响应与业务错误码（PRD 9.3）

export class ApiError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export function ok(data, status = 200) {
  return new Response(JSON.stringify({ ok: true, data }), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" }
  });
}

export function fail(error, message, status = 400) {
  return new Response(JSON.stringify({ ok: false, error, message }), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" }
  });
}

export async function readJson(request) {
  try {
    const t = await request.text();
    return t ? JSON.parse(t) : {};
  } catch {
    throw new ApiError("VALIDATION_ERROR", "请求体不是合法 JSON");
  }
}

// 统一错误包装：把 ApiError 转成响应，未知错误兜底
export function handle(fn) {
  return async (context) => {
    try {
      return await fn(context);
    } catch (e) {
      if (e instanceof ApiError) return fail(e.code, e.message, e.status);
      return fail("UPSTREAM_ERROR", String(e?.message || e), 500);
    }
  };
}

// 中国时区的今日 YYYY-MM-DD
export function todayCN() {
  return new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
}
