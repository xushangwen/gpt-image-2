import { NextRequest, NextResponse } from "next/server";

type ImageResult = { b64?: string; url?: string; mediaType: string };
type GenerateConfig = { apiKey: string; apiEndpoint: string; model: string };

const ALLOWED_SIZES = new Set(["auto", "1024x1024", "1536x1024", "1024x1536"]);
const ALLOWED_QUALITIES = new Set(["low", "medium", "high"]);
const MAX_PROMPT_LENGTH = 4000;
const UPSTREAM_TIMEOUT_MS = 120_000;

class HttpError extends Error {
  constructor(message: string, public status = 500) {
    super(message);
  }
}

function getConfig(): GenerateConfig {
  const apiKey = process.env.IMAGE_API_KEY?.trim();
  const apiEndpoint = process.env.IMAGE_API_ENDPOINT?.trim();
  const model = process.env.IMAGE_MODEL?.trim();

  if (!apiKey || !apiEndpoint || !model) {
    throw new HttpError("服务端图像生成配置缺失，请检查环境变量", 500);
  }

  try {
    new URL(apiEndpoint);
  } catch {
    throw new HttpError("服务端图像生成接口地址配置无效", 500);
  }

  return { apiKey, apiEndpoint, model };
}

function getErrorMessage(err: unknown) {
  return err instanceof Error ? err.message : String(err);
}

async function readJson(req: NextRequest) {
  try {
    return await req.json();
  } catch {
    throw new HttpError("请求体不是有效的 JSON", 400);
  }
}

// 单次请求，兼容不支持 n>1 的中转服务
async function generateOne(body: object, config: GenerateConfig): Promise<ImageResult> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(config.apiEndpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error("图像生成请求超时，请稍后重试");
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }

  const rawText = await response.text();
  console.info("[generate] upstream status:", response.status);

  if (!response.ok) {
    let message = `API 错误 ${response.status}`;
    try {
      const errJson = JSON.parse(rawText);
      message = errJson.error?.message ?? errJson.message ?? message;
    } catch {}
    throw new Error(message);
  }

  let data: { data?: { b64_json?: string; url?: string }[] };
  try {
    data = JSON.parse(rawText);
  } catch {
    throw new Error("API 返回了无法解析的数据");
  }

  if (!Array.isArray(data.data) || data.data.length === 0) {
    throw new Error("API 返回了未知格式，请稍后重试");
  }

  const img = data.data[0];
  if (!img.b64_json && !img.url) {
    throw new Error("API 未返回可用图片");
  }

  return { b64: img.b64_json, url: img.url, mediaType: "image/png" };
}

export async function POST(req: NextRequest) {
  try {
    const config = getConfig();
    const { prompt, size = "1024x1024", quality = "high", n = 1 } = await readJson(req);

    if (typeof prompt !== "string" || !prompt.trim()) {
      throw new HttpError("Prompt is required", 400);
    }
    if (prompt.length > MAX_PROMPT_LENGTH) {
      throw new HttpError(`Prompt 不能超过 ${MAX_PROMPT_LENGTH} 个字符`, 400);
    }
    if (typeof size !== "string" || !ALLOWED_SIZES.has(size)) {
      throw new HttpError("不支持的图片尺寸", 400);
    }
    if (typeof quality !== "string" || !ALLOWED_QUALITIES.has(quality)) {
      throw new HttpError("不支持的画质选项", 400);
    }

    const count = Math.min(Math.max(Number(n) || 1, 1), 4);
    const baseBody = {
      model: config.model,
      prompt: prompt.trim(),
      size,
      quality,
      response_format: "b64_json",
      n: 1,
    };

    const startedAt = Date.now();
    console.info("[generate] request:", `count=${count}`, `size=${size}`, `quality=${quality}`);

    // 并发生成 count 张，每次独立请求，兼容所有不支持 n>1 的中转
    const results = await Promise.allSettled(
      Array.from({ length: count }, () => generateOne(baseBody, config))
    );
    const images = results
      .filter((result): result is PromiseFulfilledResult<ImageResult> => result.status === "fulfilled")
      .map(result => result.value);

    const failures = results.filter(result => result.status === "rejected");
    console.info(
      "[generate] completed:",
      `ok=${images.length}`,
      `failed=${failures.length}`,
      `elapsed=${Date.now() - startedAt}ms`
    );

    if (images.length === 0) {
      const firstReason = failures[0] as PromiseRejectedResult | undefined;
      throw new Error(firstReason ? getErrorMessage(firstReason.reason) : "生成失败，请重试");
    }

    return NextResponse.json({
      images,
      warning: failures.length > 0 ? `${failures.length} 张图片生成失败，已返回成功结果` : undefined,
    });
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    const message = getErrorMessage(err);
    console.error("[generate] failed:", message);
    return NextResponse.json({ error: message }, { status });
  }
}
