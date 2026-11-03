-- 私人理财收益看板 —— D1 / SQLite schema（PRD v2.1 第 7 节）
-- 金额一律 INTEGER 存「分」；净值与份额一律 TEXT 存定点字符串，不使用 REAL（D28）。

CREATE TABLE IF NOT EXISTS products (
  code                TEXT PRIMARY KEY,
  name                TEXT NOT NULL,
  display_name        TEXT NOT NULL,
  saa_cod             TEXT,
  holding_period_days INTEGER,
  maturity_date       TEXT,
  benchmark           TEXT,
  risk_level          TEXT DEFAULT 'R2',              -- R1..R5
  trade_time          TEXT,                           -- 交易时间，如 T+1
  status              TEXT NOT NULL DEFAULT 'active',  -- active|matured|closed
  created_at          TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS transactions (
  id                 TEXT PRIMARY KEY,
  product_code       TEXT NOT NULL REFERENCES products(code),
  type               TEXT NOT NULL,                     -- buy|redeem|adjust
  status             TEXT NOT NULL DEFAULT 'confirmed', -- confirmed|pending
  trade_date         TEXT NOT NULL,                     -- YYYY-MM-DD（买入/赎回时间）
  nav_date           TEXT,            -- 净值计算时间（净值取值日）
  confirm_date       TEXT,            -- 确认份额时间
  net_value          TEXT,            -- 定点字符串，pending 时为 NULL
  shares             TEXT,            -- 定点字符串，8 位小数
  gross_amount_cents INTEGER,         -- 买入本金 / 赎回总额，整数分
  fee_amount_cents   INTEGER NOT NULL DEFAULT 0,
  net_amount_cents   INTEGER,         -- 买入实付 / 赎回到账，整数分
  redeemable_date    TEXT,            -- 仅买入，手填
  apply_date         TEXT,            -- 赎回：提交申请时间
  settle_date        TEXT,            -- 赎回：赎回完成时间
  redeem_ratio       TEXT,            -- 赎回比例（%）
  note               TEXT,
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tx_product_date ON transactions(product_code, trade_date);
CREATE INDEX IF NOT EXISTS idx_tx_status ON transactions(status);

CREATE TABLE IF NOT EXISTS net_values (
  product_code         TEXT NOT NULL,
  date                 TEXT NOT NULL,   -- YYYY-MM-DD
  unit_net_value       TEXT NOT NULL,   -- 原始字符串，如 "1.008900"
  cumulative_net_value TEXT,
  fetched_at           TEXT NOT NULL,
  PRIMARY KEY (product_code, date)
);

CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT
);
