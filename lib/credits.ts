import { getSupabase } from "./supabase";

export interface UserCredits {
  user_id: string;
  email: string;
  credits_remaining: number;
  total_used: number;
}

const WELCOME_BONUS = 66;

export async function getOrCreateCredits(userId: string, email: string): Promise<UserCredits> {
  const db = getSupabase();

  const { data: upserted } = await db
    .from("user_credits")
    .upsert(
      { user_id: userId, email, credits_remaining: WELCOME_BONUS, total_used: 0 },
      { onConflict: "user_id", ignoreDuplicates: true }
    )
    .select()
    .single();

  if (upserted) {
    // Guard against concurrent new-user requests both passing the upsert check.
    // Best-effort: check if welcome_bonus was already recorded before inserting.
    // Definitive fix requires a DB-level unique constraint on (user_id, type='welcome_bonus').
    const { count } = await db
      .from("credit_transactions")
      .select("*", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("type", "welcome_bonus");
    if (!count) {
      await db.from("credit_transactions").insert({
        user_id: userId,
        type: "welcome_bonus",
        credits_delta: WELCOME_BONUS,
        note: "新用户注册赠送",
      });
    }
    return upserted as UserCredits;
  }

  const { data: existing, error } = await db
    .from("user_credits")
    .select("*")
    .eq("user_id", userId)
    .single();

  if (error) throw new Error(`获取用户积分失败: ${error.message}`);
  return existing as UserCredits;
}

export async function getCreditsOnly(userId: string): Promise<number | null> {
  const { data } = await getSupabase()
    .from("user_credits")
    .select("credits_remaining")
    .eq("user_id", userId)
    .single();
  return data ? (data.credits_remaining as number) : null;
}

// Returns new balance, or -1 if insufficient credits
export async function deductCredits(userId: string, count: number): Promise<number> {
  const db = getSupabase();
  const { data, error } = await db.rpc("deduct_credits", {
    p_user_id: userId,
    p_count: count,
  });
  if (error) throw new Error(`扣除积分失败: ${error.message}`);

  const newBalance = data as number;

  if (newBalance >= 0) {
    await db.from("credit_transactions").insert({
      user_id: userId,
      type: "generation",
      credits_delta: -count,
      note: `生成 ${count} 张图片`,
    });
  }

  return newBalance;
}

export async function refundCredits(userId: string, count: number): Promise<void> {
  const db = getSupabase();
  const { error } = await db.rpc("add_credits", {
    p_user_id: userId,
    p_amount: count,
  });
  if (error) {
    console.error(`[credits] refund failed for ${userId}:`, error.message);
    return;
  }
  await db.from("credit_transactions").insert({
    user_id: userId,
    type: "refund",
    credits_delta: count,
    note: `生成失败退款 ${count} 积分`,
  });
}

export async function addCredits(
  userId: string,
  amount: number,
  orderId: string,
  grantedBy: string
): Promise<void> {
  const db = getSupabase();

  const { error } = await db.rpc("add_credits", {
    p_user_id: userId,
    p_amount: amount,
  });
  if (error) throw new Error(`增加积分失败: ${error.message}`);

  await db.from("credit_transactions").insert({
    user_id: userId,
    type: "purchase",
    credits_delta: amount,
    order_id: orderId,
    granted_by: grantedBy,
    note: `手动充值订单 ${orderId}`,
  });
}

// Admin manually adjusts credits (positive or negative). Atomic via RPC; refuses
// negative deltas that would drive balance below zero.
export async function adminAdjustCredits(
  userId: string,
  delta: number,
  reason: string,
  adminEmail: string
): Promise<number> {
  const db = getSupabase();
  const { data, error } = await db.rpc("admin_adjust_credits", {
    p_user_id: userId,
    p_delta: delta,
    p_reason: reason,
    p_admin_email: adminEmail,
  });
  if (error) throw new Error(`调整积分失败: ${error.message}`);
  return data as number;
}

export interface CreditTransaction {
  id: number;
  user_id: string;
  type: string;
  credits_delta: number;
  order_id: string | null;
  note: string | null;
  granted_by: string | null;
  created_at: string;
}

export async function listUserTransactions(
  userId: string,
  limit = 50
): Promise<CreditTransaction[]> {
  const { data, error } = await getSupabase()
    .from("credit_transactions")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`查询流水失败: ${error.message}`);
  return (data ?? []) as CreditTransaction[];
}
