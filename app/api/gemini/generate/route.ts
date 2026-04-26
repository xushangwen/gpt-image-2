import { NextRequest, NextResponse } from "next/server";

export const maxDuration = 300;

const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta";
const UPSTREAM_TIMEOUT_MS = 180_000;
const ALLOWED_QUALITIES = new Set(["low", "medium", "high"]);
const ALLOWED_REFERENCE_TYPES = new Set(["image/png", "image/jpeg", "image/jpg", "image/webp"]);
const MAX_PROMPT_LENGTH = 4000;
const MAX_REFERENCE_BYTES = 10 * 1024 * 1024;

class HttpError extends Error {
  constructor(message: string, public status = 500) {
    super(message);
  }
}

function getApiKey(): string {
  const key = process.env.GEMINI_API_KEY?.trim();
  if (!key) throw new HttpError("GEMINI_API_KEY 未配置，请在 .env.local 中添加", 500);
  return key;
}

function getModel(): string {
  return (process.env.GEMINI_IMAGE_MODEL?.trim() || "gemini-3.1-flash-image-preview");
}

// quality → Gemini imageSize
const QUALITY_TO_IMAGE_SIZE: Record<string, string> = {
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
  const parts: GeminiPart[] = [];

  if (referenceImage) {
    parts.push({
      inlineData: {
        mimeType: normalizeMediaType(referenceImage.mediaType),
        data: referenceImage.data,
      },
    });
  }
  parts.push({ text: prompt });

  const imageSize = QUALITY_TO_IMAGE_SIZE[quality] ?? "1K";

  const body = {
    contents: [{ parts }],
    generationConfig: {
      responseModalities: ["TEXT", "IMAGE"],
      imageConfig: {
        aspectRatio,
        imageSize,
      },
    },
  };

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  const startedAt = Date.now();

  let response: Response;
  try {
    response = await fetch(
      `${GEMINI_API_BASE}/models/${model}:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      }
    );
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error("Gemini 图像生成请求超时，请稍后重试");
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }

  const rawText = await response.text();
  console.info("[gemini/generate] upstream status:", response.status, `elapsed=${Date.now() - startedAt}ms`);

  if (!response.ok) {
    let message = `Gemini API 错误 ${response.status}`;
    try {
      const errJson: GeminiResponse = JSON.parse(rawText);
      message = errJson.error?.message ?? message;
    } catch {}
    throw new Error(message);
  }

  let data: GeminiResponse;
  try {
    data = JSON.parse(rawText);
  } catch {
    throw new Error("Gemini API 返回了无法解析的数据");
  }

  // 200 响应体内仍可能嵌有 error 字段
  if (data.error) {
    throw new Error(data.error.message ?? `Gemini API 错误 (code=${data.error.code ?? "unknown"})`);
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

  // 构造有意义的错误信息
  if (blockReason) {
    throw new Error(`内容被安全过滤拦截 (blockReason=${blockReason})`);
  }
  if (finishReason && finishReason !== "STOP") {
    throw new Error(`Gemini 未完成图像生成 (finishReason=${finishReason})`);
  }
  if (!data.candidates?.length) {
    throw new Error("Gemini 返回空 candidates，请检查 API Key 权限或账户配额");
  }
  // 如果有文字内容，提取前 120 字作为线索
  const textHint = parts2.find(p => p.text)?.text?.slice(0, 120);
  if (textHint) {
    throw new Error(`Gemini 返回文字而非图像："${textHint}"（请确认模型支持图像生成）`);
  }
  throw new Error("Gemini API 未返回图像，请检查 API Key 和模型配置");
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

    const sizeStr = typeof size === "string" ? size : "1024x1024";

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

    const apiKey = getApiKey();
    const model = getModel();
    const count = Math.min(Math.max(Number(n) || 1, 1), 4);
    // aspectRatio from payload takes priority; fall back to pixel-size conversion
    const resolvedAspect =
      typeof aspectRatio === "string" && aspectRatio.includes(":")
        ? aspectRatio
        : (PIXEL_SIZE_TO_ASPECT[sizeStr] ?? "1:1");

    const startedAt = Date.now();
    console.info(
      "[gemini/generate] request:",
      `count=${count}`,
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
      const msg = firstReason
        ? firstReason.reason instanceof Error
          ? firstReason.reason.message
          : String(firstReason.reason)
        : "生成失败，请重试";
      throw new Error(msg);
    }

    return NextResponse.json({
      images,
      warning:
        failures.length > 0
          ? `${failures.length} 张图片生成失败，已返回成功结果`
          : undefined,
    });
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    const message = err instanceof Error ? err.message : String(err);
    console.error("[gemini/generate] failed:", message);
    return NextResponse.json({ error: message }, { status });
  }
}
