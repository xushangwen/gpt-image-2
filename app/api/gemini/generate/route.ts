import { NextRequest, NextResponse } from "next/server";
import { auth, currentUser } from "@clerk/nextjs/server";
import { getOrCreateCredits, getCreditsOnly, deductCredits, refundCredits } from "@/lib/credits";
import { acquireGenerationLock, releaseGenerationLock } from "@/lib/locks";
import { HttpError } from "@/lib/errors";
import { computeCreditCost } from "@/lib/pricing";
import { pickKey, markKeyFailed, getKeyCount } from "@/lib/api-keys";
import type { Quality } from "@/lib/types";

export const maxDuration = 300;
export const preferredRegion = "iad1";

// 走 yunwu 中转商，兼容 Google 原生 generateContent 协议
// 旧 GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta"（Google 直连，已不用）
const GEMINI_API_BASE = (process.env.GEMINI_API_BASE?.trim() || "https://yunwu.ai/v1beta");
// 与 OpenAI 路由对齐：Gemini 4K + 多参考图也常见 3 分钟级别，180s 阈值会误杀真实仍在跑的请求
const UPSTREAM_TIMEOUT_MS = 270_000;
const ALLOWED_QUALITIES = new Set(["auto", "low", "medium", "high"]);
const ALLOWED_SIZES = new Set(["1024x1024", "1536x1024", "1024x1536"]);
const ALLOWED_REFERENCE_TYPES = new Set(["image/png", "image/jpeg", "image/jpg", "image/webp"]);
const MAX_PROMPT_LENGTH = 4000;
const MAX_REFERENCE_BYTES = 10 * 1024 * 1024;
const MAX_REFERENCE_IMAGES = 4;

// 多 key 轮询 + 失败冷却。优先 YUNWU_GEMINI_API_KEY，向后兼容 GEMINI_API_KEY（旧 Google 直连）
function getRawApiKey(): string | undefined {
  return (process.env.YUNWU_GEMINI_API_KEY ?? process.env.GEMINI_API_KEY ?? "").trim() || undefined;
}

function pickApiKey(): string {
  const raw = getRawApiKey();
  if (!raw) throw new HttpError("YUNWU_GEMINI_API_KEY 未配置，请在 .env.local 中添加", 500);
  const picked = pickKey({ namespace: "gen:gemini", raw });
  if (!picked) throw new HttpError("YUNWU_GEMINI_API_KEY 配置无效", 500);
  const keyCount = getKeyCount(raw);
  if (keyCount > 1) {
    console.log(`[gemini/generate] 使用 key ...${picked.slice(-4)}（共 ${keyCount} 个，轮询）`);
  }
  return picked;
}

// 上游错误对应的 key 冷却时长（毫秒）
function cooldownForStatus(status: number, isTimeout: boolean): number {
  if (isTimeout) return 20_000;
  if (status === 429) return 30_000;
  if (status === 401 || status === 403) return 300_000;
  if (status >= 500) return 15_000;
  return 0;
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
  prompt: string,
  aspectRatio: string,
  quality: string,
  referenceImages: { data: string; mediaType: string }[] = []
): Promise<{ b64: string; mediaType: string }> {
  // 官方文档要求：文字在前，图片在后。多图按顺序 push，模型按位置语义识别（"图一/图二"）
  const parts: GeminiPart[] = [{ text: prompt }];
  for (const ref of referenceImages) {
    parts.push({
      inlineData: {
        mimeType: normalizeMediaType(ref.mediaType),
        data: ref.data,
      },
    });
  }

  const imageSize = QUALITY_TO_IMAGE_SIZE[quality] ?? "1K";

  // 垫图模式：不传 aspectRatio，避免与参考图构图冲突；仅传 imageSize 控制分辨率
  const imageConfig = referenceImages.length > 0
    ? { imageSize }
    : { aspectRatio, imageSize };

  const body = {
    contents: [{ parts }],
    generationConfig: {
      responseModalities: ["TEXT", "IMAGE"],
      imageConfig,
    },
  };

  // 每次调用独立挑 key（count>1 并发时分散到不同 key），失败自动冷却
  const apiKey = pickApiKey();
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
      markKeyFailed("gen:gemini", apiKey, cooldownForStatus(0, true));
      throw new HttpError("生成超时，请稍后重试（积分已自动退还）", 504);
    }
    markKeyFailed("gen:gemini", apiKey, 10_000);
    throw new HttpError("网络异常，请检查连接后重试", 502);
  } finally {
    clearTimeout(timeoutId);
  }

  const rawText = await response.text();
  console.info("[gemini/generate] upstream status:", response.status, `elapsed=${Date.now() - startedAt}ms refs=${referenceImages.length}`);

  // 上游 4xx/5xx：原始 error.message 进日志，不暴露给前端（避免泄漏 API key / 配额提示等内部信息）
  if (!response.ok) {
    console.error(`[gemini/generate] upstream ${response.status}: ${rawText.slice(0, 200)}`);
    const cd = cooldownForStatus(response.status, false);
    if (cd > 0) {
      markKeyFailed("gen:gemini", apiKey, cd);
      console.warn(`[gemini/generate] key ...${apiKey.slice(-4)} 冷却 ${cd}ms（status=${response.status}）`);
    }
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
  const reqStart = Date.now();
  const traceId = Math.random().toString(36).slice(2, 8);
  let acquiredUserId: string | null = null;
  try {
    const { userId } = await auth();
    if (!userId) throw new HttpError("请先登录", 401);

    // 同一用户并发拦截。与 OpenAI 路由对齐：
    // 防止用户在前端 abort + 重新点击时，旧请求仍在跑 → 同一用户两次上游计费
    const lockResult = await acquireGenerationLock(userId);
    if (lockResult === "held") {
      console.warn(`[gemini/generate ${traceId}] REJECTED user=${userId.slice(-8)} reason=lock_held`);
      throw new HttpError("已有生图任务进行中，请等待完成（如果你刚才取消过页面，请稍等 5 分钟自动释放）", 429);
    }
    if (lockResult === "error") {
      console.warn(`[gemini/generate ${traceId}] REJECTED user=${userId.slice(-8)} reason=lock_db_error`);
      throw new HttpError("系统繁忙，请稍后重试", 503);
    }
    acquiredUserId = userId;

    let raw: {
      prompt?: unknown;
      size?: unknown;
      quality?: unknown;
      n?: unknown;
      aspectRatio?: unknown;
      referenceImage?: { data?: string; mediaType?: string; name?: string };
      referenceImages?: Array<{ data?: string; mediaType?: string; name?: string }>;
    };
    try {
      raw = await req.json();
    } catch {
      throw new HttpError("请求体不是有效的 JSON", 400);
    }

    const { prompt, size = "1024x1024", quality = "high", n = 1, aspectRatio, referenceImage, referenceImages } = raw;

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

    // 多图垫图：优先取 referenceImages 数组；向后兼容旧 referenceImage 单图字段
    const rawRefs: Array<{ data?: string; mediaType?: string; name?: string }> =
      Array.isArray(referenceImages) && referenceImages.length > 0
        ? referenceImages
        : (referenceImage ? [referenceImage] : []);

    if (rawRefs.length > MAX_REFERENCE_IMAGES) {
      throw new HttpError(`最多支持 ${MAX_REFERENCE_IMAGES} 张参考图`, 400);
    }

    const parsedRefs: { data: string; mediaType: string }[] = [];
    for (const ref of rawRefs) {
      if (!ref || typeof ref.data !== "string" || typeof ref.mediaType !== "string") {
        throw new HttpError("参考图数据格式无效", 400);
      }
      if (!ALLOWED_REFERENCE_TYPES.has(ref.mediaType)) {
        throw new HttpError("参考图仅支持 PNG、JPG 或 WebP", 400);
      }
      const byteLength = Math.floor(ref.data.length * 0.75);
      if (byteLength > MAX_REFERENCE_BYTES) {
        throw new HttpError("单张参考图不能超过 10 MB", 400);
      }
      parsedRefs.push({ data: ref.data, mediaType: ref.mediaType });
    }

    // ── 积分验证 ──

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

    const model = getModel();
    // aspectRatio from payload takes priority; fall back to pixel-size conversion
    const resolvedAspect =
      typeof aspectRatio === "string" && aspectRatio.includes(":")
        ? aspectRatio
        : (PIXEL_SIZE_TO_ASPECT[sizeStr] ?? "1:1");

    console.info(
      `[gemini/generate ${traceId}] START`,
      `user=${userId.slice(-8)}`,
      `count=${count}`,
      `cost/img=${costPerImage}`,
      `total=${totalCost}`,
      `balance=${newBalance}`,
      `size=${sizeStr}`,
      `quality=${quality}`,
      `imageSize=${QUALITY_TO_IMAGE_SIZE[quality]}`,
      `aspectRatio=${resolvedAspect}`,
      `refs=${parsedRefs.length}`,
      `model=${model}`
    );

    const results = await Promise.allSettled(
      Array.from({ length: count }, () =>
        callGemini(model, prompt.trim(), resolvedAspect, quality, parsedRefs)
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
      `[gemini/generate ${traceId}] completed`,
      `ok=${images.length}`,
      `failed=${failures.length}`,
      `elapsed=${Date.now() - reqStart}ms`
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
  } finally {
    if (acquiredUserId) {
      await releaseGenerationLock(acquiredUserId);
    }
  }
}
