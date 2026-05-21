// 多 key 轮询 + 失败冷却
//
// 设计：
// - Round-robin：模块级 cursor，每次取下一个 key
// - 失败冷却：被上游 429 / 5xx / timeout 的 key 短时间内跳过
// - Vercel Fluid Compute 跨调用复用实例，模块级状态对热实例稳定
//   冷启动会重置游标，但每次启动只重置一次，仍然显著优于随机
//
// 之所以不用随机：
// - 随机分布有 burst clustering，4 个并发请求经常命中同一个 key → 429 风暴
// - 随机不会规避刚失败的 key

const cursors = new Map<string, number>();        // namespace -> 当前游标
const cooldownUntil = new Map<string, number>();  // `${namespace}:${key}` -> 解禁时间戳

export interface PickOptions {
  /** 命名空间隔离 cursor，避免不同 provider 互相干扰 */
  namespace: string;
  /** 原始环境变量值，支持逗号 / 空白分隔多个 key */
  raw: string | undefined;
}

export function pickKey({ namespace, raw }: PickOptions): string | undefined {
  if (!raw) return undefined;
  const keys = raw.split(/[,\s]+/).map(k => k.trim()).filter(Boolean);
  if (keys.length === 0) return undefined;
  if (keys.length === 1) return keys[0];

  const now = Date.now();
  const start = cursors.get(namespace) ?? 0;

  // 最多扫一圈，跳过冷却中的 key
  for (let i = 0; i < keys.length; i++) {
    const idx = (start + i) % keys.length;
    const candidate = keys[idx];
    const banUntil = cooldownUntil.get(`${namespace}:${candidate}`) ?? 0;
    if (banUntil <= now) {
      cursors.set(namespace, (idx + 1) % keys.length);
      return candidate;
    }
  }

  // 全部 key 都在冷却：强制用当前游标位置，让上游告诉我们实际状态
  cursors.set(namespace, (start + 1) % keys.length);
  return keys[start];
}

export function markKeyFailed(namespace: string, key: string, cooldownMs: number) {
  cooldownUntil.set(`${namespace}:${key}`, Date.now() + cooldownMs);
}

export function getKeyCount(raw: string | undefined): number {
  if (!raw) return 0;
  return raw.split(/[,\s]+/).map(k => k.trim()).filter(Boolean).length;
}
