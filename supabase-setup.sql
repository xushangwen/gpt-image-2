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

CREATE UNIQUE INDEX IF NOT EXISTS credit_transactions_purchase_order_idx
ON credit_transactions(order_id, type)
WHERE order_id IS NOT NULL AND type = 'purchase';

-- 4.1 生图互斥锁表：阻止同一用户同时存在多个上游生图任务
CREATE TABLE IF NOT EXISTS active_generations (
  user_id    TEXT PRIMARY KEY,
  locked_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL
);

-- 5. 启用行级安全
ALTER TABLE user_credits        ENABLE ROW LEVEL SECURITY;
ALTER TABLE packages            ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders              ENABLE ROW LEVEL SECURITY;
ALTER TABLE credit_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE active_generations  ENABLE ROW LEVEL SECURITY;

-- 所有访问通过 service_role key（服务端），直接拒绝匿名访问
CREATE POLICY "deny_anon_user_credits"        ON user_credits        FOR ALL TO anon USING (false);
CREATE POLICY "deny_anon_orders"              ON orders              FOR ALL TO anon USING (false);
CREATE POLICY "deny_anon_transactions"        ON credit_transactions FOR ALL TO anon USING (false);
CREATE POLICY "deny_anon_active_generations"  ON active_generations  FOR ALL TO anon USING (false);
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

-- 7.1 原子获取生图锁。会先清理过期锁，再尝试插入当前用户锁。
CREATE OR REPLACE FUNCTION acquire_generation_lock(
  p_user_id TEXT,
  p_ttl_seconds INTEGER DEFAULT 300
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inserted INTEGER;
BEGIN
  DELETE FROM active_generations
  WHERE expires_at < NOW();

  INSERT INTO active_generations (user_id, locked_at, expires_at)
  VALUES (p_user_id, NOW(), NOW() + make_interval(secs => p_ttl_seconds))
  ON CONFLICT (user_id) DO NOTHING;

  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  RETURN v_inserted = 1;
END;
$$;

-- 7.2 释放生图锁。
CREATE OR REPLACE FUNCTION release_generation_lock(p_user_id TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM active_generations
  WHERE user_id = p_user_id;
END;
$$;

-- 8. 原子确认订单并发放积分
CREATE OR REPLACE FUNCTION confirm_order_and_grant_credits(p_order_id TEXT, p_admin_email TEXT)
RETURNS orders
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order orders%ROWTYPE;
  v_credits INTEGER;
BEGIN
  SELECT * INTO v_order
  FROM orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF NOT FOUND OR v_order.status <> 'pending' THEN
    RAISE EXCEPTION '订单 % 不存在或已处理', p_order_id;
  END IF;

  SELECT credits INTO v_credits
  FROM packages
  WHERE id = v_order.package_id;

  IF v_credits IS NULL THEN
    RAISE EXCEPTION '订单套餐数据异常';
  END IF;

  UPDATE user_credits
  SET credits_remaining = credits_remaining + v_credits,
      updated_at        = NOW()
  WHERE user_id = v_order.user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION '用户积分账户不存在';
  END IF;

  UPDATE orders
  SET status       = 'confirmed',
      confirmed_at = NOW(),
      confirmed_by = p_admin_email
  WHERE id = p_order_id
  RETURNING * INTO v_order;

  INSERT INTO credit_transactions (
    user_id,
    type,
    credits_delta,
    order_id,
    granted_by,
    note
  ) VALUES (
    v_order.user_id,
    'purchase',
    v_credits,
    v_order.id,
    p_admin_email,
    '手动充值订单 ' || v_order.id
  );

  RETURN v_order;
END;
$$;
