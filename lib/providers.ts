// 中转商展示/稳定性常量：page.tsx 与 AppHeader 共享
// 不暴露中转商真实名（进货渠道）

import type { ProviderChoice } from "@/lib/types";

export const PROVIDER_LABELS: Record<ProviderChoice, { name: string; recommended: boolean }> = {
  tuzi:  { name: "线路一", recommended: false },
  yunwu: { name: "线路二", recommended: true },
};

// 稳定性评分（5 分制，支持 0.5），用户场景实测经验值
export const PROVIDER_STABILITY: Record<ProviderChoice, { score: number; hint: string }> = {
  tuzi:  { score: 2.0, hint: "近期不稳定，建议切换到线路二" },
  yunwu: { score: 4.5, hint: "当前最稳定，推荐使用" },
};

export function stabilityColor(score: number): string {
  if (score >= 4) return "#4ade80"; // 绿
  if (score >= 3) return "#fbbf24"; // 黄
  return "#f87171";                 // 红
}
