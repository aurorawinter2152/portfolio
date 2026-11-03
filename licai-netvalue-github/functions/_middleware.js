// 访问密码门：设置 APP_PASSWORD 后生效；未设置则放行
const COOKIE = "lc_auth";
const SALT = "::licai-gate";

async function sha256Hex(s) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((x) => x.toString(16).padStart(2, "0")).join("");
}
function getCookie(req, name) {
  const c = req.headers.get("cookie") || "";
  const m = c.match(new RegExp("(?:^|; )" + name + "=([^;]*)"));
  return m ? decodeURIComponent(m[1]) : null;
}

export async function onRequest(context) {
  const { request, env, next } = context;
  const pwd = env.APP_PASSWORD;
  if (!pwd) return next(); // 未配置密码则不启用

  const url = new URL(request.url);
  const p = url.pathname;
  if (p === "/login" || p === "/login.html" || p === "/api/login" || p === "/favicon.ico") {
    return next();
  }

  const token = await sha256Hex(pwd + SALT);
  if (getCookie(request, COOKIE) === token) return next();

  if (p.startsWith("/api/")) {
    return new Response(JSON.stringify({ ok: false, error: "UNAUTHORIZED", message: "需要登录" }), {
      status: 401,
      headers: { "content-type": "application/json", "cache-control": "no-store" }
    });
  }
  return Response.redirect(new URL("/login", url).toString(), 302);
}
