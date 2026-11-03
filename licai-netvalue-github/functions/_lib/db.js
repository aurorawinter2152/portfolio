// D1 轻量访问封装

export async function all(env, sql, ...params) {
  const stmt = env.DB.prepare(sql);
  const r = await (params.length ? stmt.bind(...params) : stmt).all();
  return r.results || [];
}

export async function first(env, sql, ...params) {
  const stmt = env.DB.prepare(sql);
  return await (params.length ? stmt.bind(...params) : stmt).first();
}

export async function run(env, sql, ...params) {
  const stmt = env.DB.prepare(sql);
  return await (params.length ? stmt.bind(...params) : stmt).run();
}

export async function batch(env, statements) {
  if (!statements.length) return [];
  return await env.DB.batch(statements);
}
