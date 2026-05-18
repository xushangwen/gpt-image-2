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
    // welcome_bonus 流水：DB 上 credit_transactions_welcome_bonus_idx partial unique index
    // 保证全表每个 user_id 只能有一条；若并发已被对方插入，23505 静默忽略
    const { error: txError } = await db.from("credit_transactions").insert({
      user_id: userId,
      type: "welcome_bonus",
      credits_delta: WELCOME_BONUS,
      note: "新用户注册赠送",
    });
    // 23505 = unique_violation，是预期的并发竞态，吞掉即可
    if (txError && txError.code !== "23505") {
      console.warn(`[credits] welcome_bonus tx insert failed for ${userId}:`, txError.message);
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

// 仅 PGRST116（无行）返回 null；其他错误（连接异常等）抛出，避免被误判为"用户不存在"触发重复 welcome
export async function getCreditsOnly(userId: string): Promise<number | null> {
  const { data, error } = await getSupabase()
    .from("user_credits")
    .select("credits_remaining")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(`查询用户积分失败: ${error.message}`);
  return data ? (data.credits_remaining as number) : null;
}

// Returns new balance, or -1 if insufficient credits
// 流水写入已合并进 RPC（同事务原子），lib 这里不再二次 insert
export async function deductCredits(
  userId: string,
  count: number,
  prompt?: string,
  meta?: { engine?: string; provider?: string; size?: string; quality?: string; action?: "generation" | "enhance" }
): Promise<number> {
  const promptPreview = prompt?.trim().slice(0, 100) ?? "";
  const metaTag = meta
    ? `[${meta.engine ?? "?"}/${meta.provider ?? "-"}/${meta.size ?? "-"}/${meta.quality ?? "-"}]`
    : "";
  const action = meta?.action ?? "generation";
  const note = [
    action === "enhance" ? "提示词优化" : `生成 ${count} 张`,
    metaTag,
    promptPreview ? `· ${promptPreview}` : "",
  ].filter(Boolean).join(" ");

  const { data, error } = await getSupabase().rpc("deduct_credits", {
    p_user_id: userId,
    p_count: count,
    p_type: action,
    p_note: note,
  });
  if (error) throw new Error(`扣除积分失败: ${error.message}`);
  return data as number;
}

export async function refundCredits(userId: string, count: number): Promise<void> {
  let lastError: string | null = null;

  // 3 次指数退避：0ms / 200ms / 400ms。退款是承诺给用户的事，绝不能静默失败。
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) {
      await new Promise(r => setTimeout(r, 200 * 2 ** (attempt - 1)));
    }
    const { error } = await getSupabase().rpc("add_credits", {
      p_user_id: userId,
      p_amount: count,
      p_type: "refund",
      p_note: `生成失败退款 ${count} 积分`,
    });
    if (!error) return;
    lastError = error.message;
    console.warn(`[credits] refund attempt ${attempt + 1}/3 failed for ${userId}:`, error.message);
  }
  throw new Error(`退款失败（已重试 3 次）：${lastError ?? "unknown"}`);
}

export async function addCredits(
  userId: string,
  amount: number,
  orderId: string,
  grantedBy: string
): Promise<void> {
  const { error } = await getSupabase().rpc("add_credits", {
    p_user_id: userId,
    p_amount: amount,
    p_type: "purchase",
    p_note: `手动充值订单 ${orderId}`,
    p_order_id: orderId,
    p_granted_by: grantedBy,
  });
  if (error) throw new Error(`增加积分失败: ${error.message}`);
}

// Admin manually adjusts credits (positive or negative). Atomic via RPC; refuses
// negative deltas that would drive balance below zero. 流水已在 RPC 内合并。
export async function adminAdjustCredits(
  userId: string,
  delta: number,
  reason: string,
  adminEmail: string
): Promise<number> {
  const { data, error } = await getSupabase().rpc("admin_adjust_credits", {
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
