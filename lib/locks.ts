import { getSupabase } from "./supabase";

/**
 * 跨 vercel 项目/实例/部署的分布式锁，基于 Supabase 数据库。
 *
 * 设计：
 * - 通过 active_generations 表的主键 user_id 实现互斥
 * - acquire RPC 内置过期清理 + ON CONFLICT DO NOTHING，原子返回是否成功
 * - 返回三态：acquired（拿到锁）/ held（别的请求持有）/ error（DB 异常）
 *   路由层据此分别返回 429 / 503，避免 DB 抖动时所有用户被告知"等 5 分钟"
 */

export type LockResult = "acquired" | "held" | "error";

export async function acquireGenerationLock(
  userId: string,
  ttlSeconds: number = 300
): Promise<LockResult> {
  try {
    const { data, error } = await getSupabase().rpc("acquire_generation_lock", {
      p_user_id: userId,
      p_ttl_seconds: ttlSeconds,
    });
    if (error) {
      console.error("[lock] acquire DB error:", error.message);
      return "error";
    }
    return data === true ? "acquired" : "held";
  } catch (err) {
    console.error("[lock] acquire exception:", err);
    return "error";
  }
}

export async function releaseGenerationLock(userId: string): Promise<void> {
  try {
    const { error } = await getSupabase().rpc("release_generation_lock", {
      p_user_id: userId,
    });
    if (error) console.warn("[lock] release failed:", error.message);
  } catch (err) {
    console.warn("[lock] release exception:", err);
  }
}

/**
 * 通用限频锁。复用 active_generations 表，但用前缀区分 key
 *（如 `enhance:userId` / `order:userId`），TTL 短（秒级）。
 *
 * fail-open：限频是软限制，DB 异常时不应拦截正常用户。
 */
export async function acquireThrottleLock(
  key: string,
  ttlSeconds: number
): Promise<boolean> {
  try {
    const { data, error } = await getSupabase().rpc("acquire_generation_lock", {
      p_user_id: key,
      p_ttl_seconds: ttlSeconds,
    });
    if (error) {
      console.error("[throttle] acquire failed (fail-open):", error.message);
      return true;
    }
    return data === true;
  } catch (err) {
    console.error("[throttle] acquire exception (fail-open):", err);
    return true;
  }
}
