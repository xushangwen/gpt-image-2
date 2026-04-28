-- ============================================================
-- GPT Image 2 — Supabase 建表 & 初始化脚本
-- 在 Supabase Dashboard → SQL Editor 中运行此脚本
-- ============================================================

-- 1. 用户积分表
CREATE TABLE IF NOT EXISTS user_credits (
  user_id           TEXT PRIMARY KEY,
  email             TEXT NOT NULL,
  credits_remaining INTEGER NOT NULL DEFAULT 0,
  total_used        INTEGER NOT NULL DEFAULT 0,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);

-- 2. 套餐表
CREATE TABLE IF NOT EXISTS packages (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  price_yuan INTEGER NOT NULL,
  credits    INTEGER NOT NULL,
  active     BOOLEAN DEFAULT TRUE
);

-- 套餐初始数据
INSERT INTO packages (id, name, price_yuan, credits) VALUES
  ('starter',  '体验包', 18,  80),
  ('standard', '标准包', 45, 220),
  ('value',    '超值包', 88, 500)
ON CONFLICT (id) DO NOTHING;

-- 3. 订单表
CREATE TABLE IF NOT EXISTS orders (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL,
  email        TEXT NOT NULL,
  package_id   TEXT NOT NULL REFERENCES packages(id),
  status       TEXT NOT NULL DEFAULT 'pending',
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  confirmed_at TIMESTAMPTZ,
  confirmed_by TEXT
);

-- 4. 积分流水表
CREATE TABLE IF NOT EXISTS credit_transactions (
  id           BIGSERIAL PRIMARY KEY,
  user_id      TEXT NOT NULL,
  type         TEXT NOT NULL,
  credits_delta INTEGER NOT NULL,
  order_id     TEXT REFERENCES orders(id),
  note         TEXT,
  granted_by   TEXT,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

-- 5. 启用行级安全
ALTER TABLE user_credits        ENABLE ROW LEVEL SECURITY;
ALTER TABLE packages            ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders              ENABLE ROW LEVEL SECURITY;
ALTER TABLE credit_transactions ENABLE ROW LEVEL SECURITY;

-- 所有访问通过 service_role key（服务端），直接拒绝匿名访问
CREATE POLICY "deny_anon_user_credits"        ON user_credits        FOR ALL TO anon USING (false);
CREATE POLICY "deny_anon_orders"              ON orders              FOR ALL TO anon USING (false);
CREATE POLICY "deny_anon_transactions"        ON credit_transactions FOR ALL TO anon USING (false);
-- packages 允许匿名读取（展示套餐时可能用到）
CREATE POLICY "public_read_packages"          ON packages            FOR SELECT USING (true);

-- 6. 原子扣减积分函数（防止并发超扣）
CREATE OR REPLACE FUNCTION deduct_credits(p_user_id TEXT, p_count INTEGER)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_current INTEGER;
BEGIN
  SELECT credits_remaining INTO v_current
  FROM user_credits
  WHERE user_id = p_user_id
  FOR UPDATE;

  IF v_current IS NULL OR v_current < p_count THEN
    RETURN -1;  -- 积分不足
  END IF;

  UPDATE user_credits
  SET credits_remaining = credits_remaining - p_count,
      total_used        = total_used + p_count,
      updated_at        = NOW()
  WHERE user_id = p_user_id;

  RETURN v_current - p_count;  -- 返回新余额
END;
$$;

-- 7. 原子增加积分函数
CREATE OR REPLACE FUNCTION add_credits(p_user_id TEXT, p_amount INTEGER)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE user_credits
  SET credits_remaining = credits_remaining + p_amount,
      updated_at        = NOW()
  WHERE user_id = p_user_id;

  RETURN (SELECT credits_remaining FROM user_credits WHERE user_id = p_user_id);
END;
$$;
