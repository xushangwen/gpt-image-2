import type { AIEngine, Quality } from "@/lib/types";

/**
 * 每张图消耗的积分（单一真源）。
 *
 * 方案 1/2/3/5（1 积分 ≈ ¥0.04 供货成本）：
 *   OpenAI 低/中/Auto  → 1 积分   （成本 ¥0.04）
 *   OpenAI 高          → 2 积分   （成本 ¥0.16）
 *   Gemini 1K/2K       → 3 积分   （成本 ¥0.248）
 *   Gemini 4K          → 5 积分   （成本 ¥0.443）
 *
 * 改这里会同时影响：服务端扣分 / 退款、前端"本次消耗"提示、套餐说明文案。
 * Gemini quality → imageSize 映射见 app/api/gemini/generate/route.ts：
 *   auto/medium → 2K，low → 1K，high → 4K
 */
export function computeCreditCost(engine: AIEngine, quality: Quality): number {
  if (engine === "gemini") {
    return quality === "high" ? 5 : 3;
  }
  return quality === "high" ? 2 : 1;
}

/** 一次请求总消耗 = 单张积分 × 张数 */
export function computeTotalCost(engine: AIEngine, quality: Quality, count: number): number {
  return computeCreditCost(engine, quality) * Math.max(1, count);
}

export interface PricingRow {
  engine: AIEngine;
  /** 用户可见的档位描述 */
  label: string;
  /** 单张消耗积分 */
  cost: number;
}

/** 套餐弹窗 / 公告弹窗共用的对照表展示数据 */
export const PRICING_ROWS: PricingRow[] = [
  { engine: "openai", label: "GPT · 低 / 中 / 自动", cost: 1 },
  { engine: "openai", label: "GPT · 高画质",         cost: 2 },
  { engine: "gemini", label: "Gemini · 1K / 2K",     cost: 3 },
  { engine: "gemini", label: "Gemini · 4K",          cost: 5 },
];
