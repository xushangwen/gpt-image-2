import { getSupabase } from "./supabase";

/**
 * 跨 vercel 项目/实例/部署的分布式锁，基于 Supabase 数据库。
 * 用途：阻止同一 userId 在生图期间被任何其他来源再扣一次费。
 *
 * 设计：
 * - 通过 active_generations 表的主键 user_id 实现互斥
 * - acquire RPC 内置过期清理 + ON CONFLICT DO NOTHING，原子返回是否成功
 * - 失败时 fail-open（允许生图）以避免锁机制本身把功能拦死，但打 error 日志
 */

export async function acquireGenerationLock(
  userId: string,
  ttlSeconds: number = 300
): Promise<boolean> {
  try {
    const { data, error } = await getSupabase().rpc("acquire_generation_lock", {
      p_user_id: userId,
      p_ttl_seconds: ttlSeconds,
    });
    if (error) {
      console.error("[lock] acquire failed (fail-open):", error.message);
      return true;
    }
    return data === true;
  } catch (err) {
    console.error("[lock] acquire exception (fail-open):", err);
    return true;
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
