import { NextRequest, NextResponse } from "next/server";
import { auth, currentUser } from "@clerk/nextjs/server";
import { getOrCreateCredits, getCreditsOnly, deductCredits, refundCredits } from "@/lib/credits";
import { HttpError } from "@/lib/errors";
import { computeCreditCost } from "@/lib/pricing";
import type { Quality } from "@/lib/types";

export const maxDuration = 300;
export const preferredRegion = "iad1";

// 走 yunwu 中转商，兼容 Google 原生 generateContent 协议
// 旧 GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta"（Google 直连，已不用）
const GEMINI_API_BASE = (process.env.GEMINI_API_BASE?.trim() || "https://yunwu.ai/v1beta");
const UPSTREAM_TIMEOUT_MS = 180_000;
const ALLOWED_QUALITIES = new Set(["auto", "low", "medium", "high"]);
const ALLOWED_SIZES = new Set(["1024x1024", "1536x1024", "1024x1536"]);
const ALLOWED_REFERENCE_TYPES = new Set(["image/png", "image/jpeg", "image/jpg", "image/webp"]);
const MAX_PROMPT_LENGTH = 4000;
const MAX_REFERENCE_BYTES = 10 * 1024 * 1024;

// 支持逗号 / 空白分隔多 key，随机挑一个（serverless 无共享状态，随机比轮询更稳）
// 优先 YUNWU_GEMINI_API_KEY（yunwu 中转的 sk-...）；向后兼容 GEMINI_API_KEY（旧 Google 直连）
function pickApiKey(): string {
  const raw = (process.env.YUNWU_GEMINI_API_KEY ?? process.env.GEMINI_API_KEY ?? "").trim();
  if (!raw) throw new HttpError("YUNWU_GEMINI_API_KEY 未配置，请在 .env.local 中添加", 500);
  const keys = raw.split(/[,\s]+/).map((k) => k.trim()).filter(Boolean);
  if (keys.length === 0) throw new HttpError("YUNWU_GEMINI_API_KEY 配置无效", 500);
  if (keys.length === 1) return keys[0];
  const picked = keys[Math.floor(Math.random() * keys.length)];
  console.log(`[gemini/generate] 使用 key ...${picked.slice(-4)}（共 ${keys.length} 个）`);
  return picked;
}

function getModel(): string {
  return (process.env.GEMINI_IMAGE_MODEL?.trim() || "gemini-3.1-flash-image-preview");
}

// quality → Gemini imageSize
const QUALITY_TO_IMAGE_SIZE: Record<string, string> = {
  auto:   "2K",   // 等同中等，与 OpenAI 引擎 auto 体感对齐
  low:    "1K",
  medium: "2K",
  high:   "4K",
};

// pixel size → Gemini aspectRatio
const PIXEL_SIZE_TO_ASPECT: Record<string, string> = {
  "1024x1024": "1:1",
  "1536x1024": "4:3",
  "1024x1536": "3:4",
};

function normalizeMediaType(mediaType: string): string {
  return mediaType === "image/jpg" ? "image/jpeg" : mediaType;
}

interface GeminiInlineData {
  mimeType: string;
  data: string;
}

interface GeminiPart {
  text?: string;
  inlineData?: GeminiInlineData;
  inline_data?: GeminiInlineData;
}

interface GeminiCandidate {
  content?: { parts?: GeminiPart[] };
  finishReason?: string;
  safetyRatings?: Array<{ category: string; probability: string }>;
}

interface GeminiResponse {
  candidates?: GeminiCandidate[];
  promptFeedback?: { blockReason?: string; safetyRatings?: unknown[] };
  error?: { message?: string; code?: number; status?: string };
}

async function callGemini(
  model: string,
  apiKey: string,
  prompt: string,
  aspectRatio: string,
  quality: string,
  referenceImage?: { data: string; mediaType: string }
): Promise<{ b64: string; mediaType: string }> {
  // 官方文档要求：文字在前，图片在后
  const parts: GeminiPart[] = [];
  parts.push({ text: prompt });
  if (referenceImage) {
    parts.push({
      inlineData: {
        mimeType: normalizeMediaType(referenceImage.mediaType),
        data: referenceImage.data,
      },
    });
  }

  const imageSize = QUALITY_TO_IMAGE_SIZE[quality] ?? "1K";

  // 垫图模式：不传 aspectRatio，避免与参考图构图冲突；仅传 imageSize 控制分辨率
  const imageConfig = referenceImage
    ? { imageSize }
    : { aspectRatio, imageSize };

  const body = {
    contents: [{ parts }],
    generationConfig: {
      responseModalities: ["TEXT", "IMAGE"],
      imageConfig,
    },
  };

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  const startedAt = Date.now();

  let response: Response;
  try {
    response = await fetch(
      `${GEMINI_API_BASE}/models/${model}:generateContent`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      }
    );
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new HttpError("生成超时，请稍后重试（积分已自动退还）", 504);
    }
    throw new HttpError("网络异常，请检查连接后重试", 502);
  } finally {
    clearTimeout(timeoutId);
  }

  const rawText = await response.text();
  console.info("[gemini/generate] upstream status:", response.status, `elapsed=${Date.now() - startedAt}ms`);

  // 上游 4xx/5xx：原始 error.message 进日志，不暴露给前端（避免泄漏 API key / 配额提示等内部信息）
  if (!response.ok) {
    console.error(`[gemini/generate] upstream ${response.status}: ${rawText.slice(0, 200)}`);
    if (response.status === 401 || response.status === 403) {
      throw new HttpError("服务配置异常，请联系管理员", 502);
    }
    if (response.status === 429) {
      throw new HttpError("请求过于频繁，请等待几秒后重试", 502);
    }
    if (response.status >= 500) {
      throw new HttpError("Gemini 服务暂时不可用，请稍后重试", 502);
    }
    throw new HttpError("生成失败，请稍后重试", 502);
  }

  let data: GeminiResponse;
  try {
    data = JSON.parse(rawText);
  } catch {
    throw new HttpError("生成失败，请稍后重试", 502);
  }

  // 200 响应体内仍可能嵌有 error 字段
  if (data.error) {
    console.error(`[gemini/generate] 200 body error:`, data.error);
    throw new HttpError("生成失败，请稍后重试", 502);
  }

  const candidate = data.candidates?.[0];
  const blockReason = data.promptFeedback?.blockReason;
  const finishReason = candidate?.finishReason;

  // 详细诊断日志，在 Vercel Function Logs 中可见
  console.info("[gemini/generate] response structure:", JSON.stringify({
    candidatesCount: data.candidates?.length ?? 0,
    finishReason,
    blockReason,
    partsCount: candidate?.content?.parts?.length ?? 0,
    partTypes: candidate?.content?.parts?.map(p =>
      p.inlineData ?? p.inline_data ? "image" : p.text ? `text(${p.text.slice(0, 80)})` : "unknown"
    ) ?? [],
  }));

  const parts2 = candidate?.content?.parts ?? [];
  for (const part of parts2) {
    const inline = part.inlineData ?? part.inline_data;
    if (inline?.data) {
      return { b64: inline.data, mediaType: inline.mimeType ?? "image/png" };
    }
  }

  // 构造有意义的错误信息（内部细节进日志，前端只看友好文案）
  if (blockReason) {
    console.warn(`[gemini/generate] blocked: ${blockReason}`);
    throw new HttpError("内容未通过安全审查，请修改提示词后再试", 400);
  }
  if (finishReason && finishReason !== "STOP") {
    console.warn(`[gemini/generate] unexpected finishReason: ${finishReason}`);
    throw new HttpError("生成失败，请稍后重试", 502);
  }
  if (!data.candidates?.length) {
    console.error("[gemini/generate] empty candidates");
    throw new HttpError("生成失败，请稍后重试", 502);
  }
  const textHint = parts2.find(p => p.text)?.text?.slice(0, 80);
  if (textHint) {
    console.warn(`[gemini/generate] text-only response: ${textHint}`);
  }
  throw new HttpError("生成失败，请稍后重试", 502);
}

export async function POST(req: NextRequest) {
  try {
    let raw: {
      prompt?: unknown;
      size?: unknown;
      quality?: unknown;
      n?: unknown;
      aspectRatio?: unknown;
      referenceImage?: { data?: string; mediaType?: string; name?: string };
    };
    try {
      raw = await req.json();
    } catch {
      throw new HttpError("请求体不是有效的 JSON", 400);
    }

    const { prompt, size = "1024x1024", quality = "high", n = 1, aspectRatio, referenceImage } = raw;

    if (typeof prompt !== "string" || !prompt.trim()) {
      throw new HttpError("Prompt is required", 400);
    }
    if (prompt.length > MAX_PROMPT_LENGTH) {
      throw new HttpError(`Prompt 不能超过 ${MAX_PROMPT_LENGTH} 个字符`, 400);
    }
    if (typeof quality !== "string" || !ALLOWED_QUALITIES.has(quality)) {
      throw new HttpError("不支持的画质选项", 400);
    }

    if (typeof size !== "string" || !ALLOWED_SIZES.has(size)) {
      throw new HttpError("不支持的图片尺寸", 400);
    }
    const sizeStr = size;

    let parsedRef: { data: string; mediaType: string } | undefined;
    if (
      referenceImage &&
      typeof referenceImage.data === "string" &&
      typeof referenceImage.mediaType === "string"
    ) {
      if (!ALLOWED_REFERENCE_TYPES.has(referenceImage.mediaType)) {
        throw new HttpError("参考图仅支持 PNG、JPG 或 WebP", 400);
      }
      const byteLength = Math.floor(referenceImage.data.length * 0.75);
      if (byteLength > MAX_REFERENCE_BYTES) {
        throw new HttpError("参考图不能超过 10 MB", 400);
      }
      parsedRef = { data: referenceImage.data, mediaType: referenceImage.mediaType };
    }

    // ── 积分验证 ──
    const { userId } = await auth();
    if (!userId) throw new HttpError("请先登录", 401);

    let creditsRemaining = await getCreditsOnly(userId);
    if (creditsRemaining === null) {
      const user = await currentUser();
      const email = user?.emailAddresses[0]?.emailAddress ?? "";
      const credits = await getOrCreateCredits(userId, email);
      creditsRemaining = credits.credits_remaining;
    }

    const count = Math.min(Math.max(Number(n) || 1, 1), 4);
    const costPerImage = computeCreditCost("gemini", quality as Quality);
    const totalCost = costPerImage * count;

    if (creditsRemaining < totalCost) {
      throw new HttpError("积分不足，请购买套餐", 402);
    }

    const newBalance = await deductCredits(userId, totalCost, prompt, {
      engine: "gemini",
      provider: "gemini",
      size: sizeStr,
      quality,
    });
    if (newBalance < 0) {
      throw new HttpError("积分不足，请购买套餐", 402);
    }

    const apiKey = pickApiKey();
    const model = getModel();
    // aspectRatio from payload takes priority; fall back to pixel-size conversion
    const resolvedAspect =
      typeof aspectRatio === "string" && aspectRatio.includes(":")
        ? aspectRatio
        : (PIXEL_SIZE_TO_ASPECT[sizeStr] ?? "1:1");

    const startedAt = Date.now();
    console.info(
      "[gemini/generate] request:",
      `count=${count}`,
      `cost/img=${costPerImage}`,
      `total=${totalCost}`,
      `balance=${newBalance}`,
      `size=${sizeStr}`,
      `quality=${quality}`,
      `imageSize=${QUALITY_TO_IMAGE_SIZE[quality]}`,
      `aspectRatio=${resolvedAspect}`,
      `reference=${parsedRef ? "yes" : "no"}`,
      `model=${model}`
    );

    const results = await Promise.allSettled(
      Array.from({ length: count }, () =>
        callGemini(model, apiKey, prompt.trim(), resolvedAspect, quality, parsedRef)
      )
    );

    const images = results
      .filter(
        (r): r is PromiseFulfilledResult<{ b64: string; mediaType: string }> =>
          r.status === "fulfilled"
      )
      .map(r => ({ b64: r.value.b64, mediaType: r.value.mediaType }));

    const failures = results.filter(r => r.status === "rejected");
    console.info(
      "[gemini/generate] completed:",
      `ok=${images.length}`,
      `failed=${failures.length}`,
      `elapsed=${Date.now() - startedAt}ms`
    );

    if (images.length === 0) {
      const firstReason = failures[0] as PromiseRejectedResult | undefined;
      const rawMsg = firstReason
        ? firstReason.reason instanceof Error
          ? firstReason.reason.message
          : String(firstReason.reason)
        : "生成失败";
      // 内容拦截类错误优先识别，给用户更直观的提示
      const isBlocked = /blockReason|safety|未通过|敏感|policy/i.test(rawMsg);
      const userMsg = isBlocked
        ? "内容未通过安全审查，请修改提示词后再试"
        : "生成失败，请稍后重试（积分已自动退还）";
      try {
        await refundCredits(userId, totalCost);
      } catch (refundErr) {
        console.error("[gemini/generate] refund failed:", refundErr);
        throw new HttpError(
          `生成失败，且积分退款异常，请截图本订单联系客服处理（${userMsg}）`,
          502
        );
      }
      throw new HttpError(userMsg, isBlocked ? 400 : 502);
    }

    const failedCount = count - images.length;
    if (failedCount > 0) {
      try {
        await refundCredits(userId, failedCount * costPerImage);
      } catch (refundErr) {
        console.error("[gemini/generate] partial refund failed:", refundErr);
        return NextResponse.json({
          images,
          warning: `${failedCount} 张生成失败，但积分退款异常，请截图联系客服补退`,
        });
      }
    }

    return NextResponse.json({
      images,
      warning:
        failures.length > 0
          ? `${failures.length} 张图片生成失败，对应积分已自动退还`
          : undefined,
    });
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    const message = err instanceof Error ? err.message : String(err);
    console.error("[gemini/generate] failed:", message);
    return NextResponse.json({ error: message }, { status });
  }
}
