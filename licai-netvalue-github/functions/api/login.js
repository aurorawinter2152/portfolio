// POST /api/login { password }
import { ok, fail } from "../_lib/http.js";

const SALT = "::licai-gate";
async function sha256Hex(s) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((x) => x.toString(16).padStart(2, "0")).join("");
}

export async function onRequest({ request, env }) {
  if (request.method !== "POST") return fail("VALIDATION_ERROR", "不支持的请求方法", 405);
  let body;
  try {
    body = await request.json();
  } catch {
    return fail("VALIDATION_ERROR", "请求格式错误", 400);
  }
  const pwd = env.APP_PASSWORD;
  if (!pwd) return ok({ gate: false });
  if (String(body.password || "") !== pwd) {
    return new Response(JSON.stringify({ ok: false, error: "INVALID_PASSWORD", message: "密码不正确" }), {
      status: 401,
      headers: { "content-type": "application/json" }
    });
  }
  const token = await sha256Hex(pwd + SALT);
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: {
      "content-type": "application/json",
      "set-cookie": `lc_auth=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=2592000`
    }
  });
}
