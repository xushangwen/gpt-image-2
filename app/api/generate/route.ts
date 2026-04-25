import { NextRequest, NextResponse } from "next/server";

type ImageResult = { b64?: string; url?: string; mediaType: string };
type ProviderName = "tuzi" | "bltcy" | "custom";
type ReferenceEndpointKind = "chat-completions" | "images-edits" | "images-generations";
type SizeFormat = "pixel" | "ratio";
type GenerateConfig = {
  provider: ProviderName;
  apiKey: string;
  apiEndpoint: string;
  referenceEndpoint: string;
  referenceEndpointKind: ReferenceEndpointKind | null;
  model: string;
  referenceModel: string;
  referenceImageField: string;
  referenceQuality: string;
  sizeFormat: SizeFormat;
};
type ReferenceImageInput = {
  data?: string;
  mediaType?: string;
  name?: string;
};

const PROVIDER_PRESETS: Record<Exclude<ProviderName, "custom">, {
  apiEndpoint: string;
  referenceEndpoint: string;
  referenceImageField: string;
  referenceQuality: string;
  sizeFormat: SizeFormat;
}> = {
  tuzi: {
    apiEndpoint: "https://api.tu-zi.com/v1/images/generations",
    referenceEndpoint: "https://api.tu-zi.com/v1/images/generations",
    referenceImageField: "image",
    referenceQuality: "",
    sizeFormat: "ratio",
  },
  bltcy: {
    apiEndpoint: "https://api.bltcy.ai/v1/images/generations",
    referenceEndpoint: "https://api.bltcy.ai/v1/images/edits",
    referenceImageField: "image",
    referenceQuality: "",
    sizeFormat: "pixel",
  },
};

const ALLOWED_SIZES = new Set(["1024x1024", "1536x1024", "1024x1536"]);
const ALLOWED_QUALITIES = new Set(["low", "medium", "high"]);
const SIZE_TO_RATIO: Record<string, string> = {
  "1024x1024": "1:1",
  "1536x1024": "3:2",
  "1024x1536": "2:3",
};
const ALLOWED_REFERENCE_TYPES = new Set(["image/png", "image/jpeg", "image/jpg", "image/webp"]);
const MAX_PROMPT_LENGTH = 4000;
const MAX_REFERENCE_BYTES = 10 * 1024 * 1024;
const UPSTREAM_TIMEOUT_MS = 120_000;

class HttpError extends Error {
  constructor(message: string, public status = 500) {
    super(message);
  }
}

function getProvider(): ProviderName {
  const provider = (process.env.IMAGE_PROVIDER ?? "tuzi").trim().toLowerCase();
  if (provider === "tuzi" || provider === "bltcy" || provider === "custom") return provider;
  throw new HttpError(`不支持的图像中转配置：${provider}`, 500);
}

function providerEnvName(provider: ProviderName, suffix: string) {
  return `${provider.toUpperCase()}_${suffix}`;
}

function getProviderEnv(provider: ProviderName, suffix: string) {
  if (provider === "custom") return undefined;
  return process.env[providerEnvName(provider, suffix)]?.trim();
}

function getEndpointKind(endpoint: string): ReferenceEndpointKind {
  const pathname = new URL(endpoint).pathname.replace(/\/+$/, "");
  if (pathname.endsWith("/chat/completions")) return "chat-completions";
  if (pathname.endsWith("/images/generations")) return "images-generations";
  return "images-edits";
}

function getSizeFormat(provider: ProviderName, preset: typeof PROVIDER_PRESETS.tuzi | null): SizeFormat {
  const configured =
    getProviderEnv(provider, "SIZE_FORMAT") ||
    (provider === "custom" ? process.env.IMAGE_SIZE_FORMAT?.trim() : "") ||
    preset?.sizeFormat ||
    "pixel";
  if (configured === "pixel" || configured === "ratio") return configured;
  throw new HttpError(`不支持的图像尺寸格式配置：${configured}`, 500);
}

function getConfig(): GenerateConfig {
  const provider = getProvider();
  const preset = provider === "custom" ? null : PROVIDER_PRESETS[provider];
  const apiKey = getProviderEnv(provider, "API_KEY") || process.env.IMAGE_API_KEY?.trim();
  const apiEndpoint = getProviderEnv(provider, "API_ENDPOINT") || preset?.apiEndpoint || process.env.IMAGE_API_ENDPOINT?.trim();
  const configuredReferenceEndpoint =
    getProviderEnv(provider, "REFERENCE_ENDPOINT") ||
    preset?.referenceEndpoint ||
    process.env.IMAGE_REFERENCE_ENDPOINT?.trim() ||
    process.env.IMAGE_EDIT_ENDPOINT?.trim();
  const model = getProviderEnv(provider, "IMAGE_MODEL") || process.env.IMAGE_MODEL?.trim() || "gpt-image-2";
  const referenceModel = getProviderEnv(provider, "REFERENCE_MODEL") || process.env.IMAGE_REFERENCE_MODEL?.trim() || model;
  const referenceImageField =
    getProviderEnv(provider, "REFERENCE_IMAGE_FIELD") ||
    preset?.referenceImageField ||
    process.env.IMAGE_REFERENCE_IMAGE_FIELD?.trim() ||
    "image";
  const referenceQuality =
    getProviderEnv(provider, "REFERENCE_QUALITY") ||
    preset?.referenceQuality ||
    (provider === "custom" ? process.env.IMAGE_REFERENCE_QUALITY?.trim() : "") ||
    "";
  const sizeFormat = getSizeFormat(provider, preset);

  if (!apiKey || !apiEndpoint || !model || !referenceModel) {
    throw new HttpError("服务端图像生成配置缺失，请检查环境变量", 500);
  }

  let endpointUrl: URL;
  try {
    endpointUrl = new URL(apiEndpoint);
  } catch {
    throw new HttpError("服务端图像生成接口地址配置无效", 500);
  }

  const referenceEndpoint = configuredReferenceEndpoint;
  try {
    if (!referenceEndpoint) {
      return {
        provider,
        apiKey,
        apiEndpoint: endpointUrl.href,
        referenceEndpoint: "",
        referenceEndpointKind: null,
        model,
        referenceModel,
        referenceImageField,
        referenceQuality,
        sizeFormat,
      };
    }
    const referenceUrl = new URL(referenceEndpoint);
    return {
      provider,
      apiKey,
      apiEndpoint: endpointUrl.href,
      referenceEndpoint: referenceUrl.href,
      referenceEndpointKind: getEndpointKind(referenceUrl.href),
      model,
      referenceModel,
      referenceImageField,
      referenceQuality,
      sizeFormat,
    };
  } catch {
    throw new HttpError("服务端参考图接口地址配置无效", 500);
  }
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

function parseReferenceImage(input: unknown): ReferenceImageInput | null {
  if (!input || typeof input !== "object") return null;
  const ref = input as ReferenceImageInput;
  if (typeof ref.data !== "string" || typeof ref.mediaType !== "string") {
    throw new HttpError("参考图数据格式无效", 400);
  }
  if (!ALLOWED_REFERENCE_TYPES.has(ref.mediaType)) {
    throw new HttpError("参考图仅支持 PNG、JPG 或 WebP", 400);
  }

  const byteLength = Math.floor(ref.data.length * 0.75);
  if (byteLength > MAX_REFERENCE_BYTES) {
    throw new HttpError("参考图不能超过 10 MB", 400);
  }

  return {
    data: ref.data,
    mediaType: ref.mediaType,
    name: typeof ref.name === "string" && ref.name.trim() ? ref.name.trim() : "reference-image",
  };
}

function getExtension(mediaType: string) {
  if (mediaType === "image/png") return "png";
  if (mediaType === "image/webp") return "webp";
  return "jpg";
}

function appendIfDefined(formData: FormData, key: string, value: string | number | undefined) {
  if (value !== undefined && value !== "") formData.append(key, String(value));
}

function normalizeReferenceMediaType(mediaType?: string) {
  return mediaType === "image/jpg" ? "image/jpeg" : mediaType || "image/png";
}

function referenceImageToDataUrl(referenceImage: ReferenceImageInput) {
  return `data:${normalizeReferenceMediaType(referenceImage.mediaType)};base64,${referenceImage.data}`;
}

function getReferenceQuality(config: GenerateConfig, quality: string) {
  return config.referenceQuality || quality;
}

function getProviderSize(config: GenerateConfig, size: string) {
  return config.sizeFormat === "ratio" ? SIZE_TO_RATIO[size] ?? size : size;
}

function parseImageResponse(rawText: string): ImageResult {
  let data: unknown;
  try {
    data = JSON.parse(rawText);
  } catch {
    throw new Error("API 返回了无法解析的数据");
  }

  const image = collectImageResult(data);
  if (image) return image;

  throw new Error("API 未返回可用图片");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function imageFromString(value: string): ImageResult | null {
  const dataUrlMatch = value.match(/data:(image\/[a-z0-9.+-]+);base64,([a-z0-9+/=\s]+)/i);
  if (dataUrlMatch) {
    return { b64: dataUrlMatch[2].replace(/\s/g, ""), mediaType: dataUrlMatch[1] };
  }

  const markdownImageMatch = value.match(/!\[[^\]]*]\((https?:\/\/[^)\s]+)\)/i);
  const url = markdownImageMatch?.[1] ?? value.match(/https?:\/\/[^\s"'<>）)]+/i)?.[0];
  if (url) {
    return { url, mediaType: "image/png" };
  }

  return null;
}

function collectImageResult(value: unknown): ImageResult | null {
  if (typeof value === "string") return imageFromString(value);

  if (Array.isArray(value)) {
    for (const item of value) {
      const result = collectImageResult(item);
      if (result) return result;
    }
    return null;
  }

  if (!isRecord(value)) return null;

  if (typeof value.b64_json === "string") {
    return { b64: value.b64_json, mediaType: typeof value.mime_type === "string" ? value.mime_type : "image/png" };
  }
  if (typeof value.base64 === "string") {
    return { b64: value.base64, mediaType: typeof value.mime_type === "string" ? value.mime_type : "image/png" };
  }
  if (typeof value.url === "string") {
    return imageFromString(value.url) ?? { url: value.url, mediaType: "image/png" };
  }
  if (typeof value.image_url === "string") {
    return imageFromString(value.image_url) ?? { url: value.image_url, mediaType: "image/png" };
  }
  if (isRecord(value.image_url) && typeof value.image_url.url === "string") {
    return imageFromString(value.image_url.url) ?? { url: value.image_url.url, mediaType: "image/png" };
  }

  const priorityKeys = ["images", "content", "message", "data", "output", "choices"];
  for (const key of priorityKeys) {
    const result = collectImageResult(value[key]);
    if (result) return result;
  }

  return null;
}

function extractChatText(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(extractChatText).filter(Boolean).join("\n");
  if (!isRecord(value)) return "";
  if (typeof value.text === "string") return value.text;
  if (typeof value.content === "string") return value.content;
  return extractChatText(value.content ?? value.message ?? value.choices);
}

function parseChatImageResponse(rawText: string): ImageResult {
  let data: unknown;
  try {
    data = JSON.parse(rawText);
  } catch {
    throw new Error("Chat 图片接口返回了无法解析的数据");
  }

  const image = collectImageResult(data);
  if (image) return image;

  const text = extractChatText(data).trim().slice(0, 180);
  throw new Error(text ? `Chat 图片接口未返回图片：${text}` : "Chat 图片接口未返回可用图片");
}

function buildReferenceChatPrompt(prompt: string, size: string, quality: string) {
  const sizeHint: Record<string, string> = {
    "1024x1024": "方形 1:1 构图",
    "1536x1024": "横版 3:2 构图",
    "1024x1536": "竖版 2:3 构图",
    "1:1": "方形 1:1 构图",
    "3:2": "横版 3:2 构图",
    "2:3": "竖版 2:3 构图",
  };
  const qualityHint: Record<string, string> = {
    low: "快速概念图，保留主要视觉方向",
    medium: "完整细节，质感清晰",
    high: "高质量商业级图像，细节丰富，光影精致",
  };

  return [
    "请基于随附参考图生成一张新图。",
    `用户提示词：${prompt}`,
    "参考图只用于视觉风格、色彩调性、光影、构图手法、材质质感和细节语言；画面主体与内容必须以用户提示词为准。",
    `目标画幅：${sizeHint[size] ?? size}`,
    `输出质量：${qualityHint[quality] ?? quality}`,
    "请直接返回生成后的图片，不要只返回文字说明。",
  ].join("\n");
}

// 单次请求，兼容不支持 n>1 的中转服务
async function generateOne(body: object, config: GenerateConfig): Promise<ImageResult> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  const startedAt = Date.now();

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
  console.info("[generate] upstream status:", response.status, `elapsed=${Date.now() - startedAt}ms`);

  if (!response.ok) {
    let message = `API 错误 ${response.status}`;
    try {
      const errJson = JSON.parse(rawText);
      message = errJson.error?.message ?? errJson.message ?? message;
    } catch {}
    throw new Error(message);
  }

  return parseImageResponse(rawText);
}

async function editOneViaGenerationsEndpoint(
  prompt: string,
  size: string,
  quality: string,
  referenceImage: ReferenceImageInput,
  config: GenerateConfig
): Promise<ImageResult> {
  if (!config.referenceEndpoint) {
    throw new HttpError("参考图生成接口未配置，请设置 IMAGE_REFERENCE_ENDPOINT 后再使用参考图", 500);
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  const startedAt = Date.now();
  const body: Record<string, unknown> = {
    model: config.referenceModel,
    prompt,
    size,
    response_format: "url",
    n: 1,
    [config.referenceImageField]: referenceImageToDataUrl(referenceImage),
  };
  const resolvedQuality = getReferenceQuality(config, quality);
  if (resolvedQuality) body.quality = resolvedQuality;

  let response: Response;
  try {
    response = await fetch(config.referenceEndpoint, {
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
      throw new Error("参考图生成请求超时，请稍后重试");
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }

  const rawText = await response.text();
  console.info("[generate] upstream reference generation status:", response.status, `elapsed=${Date.now() - startedAt}ms`);

  if (!response.ok) {
    let message = `API 错误 ${response.status}`;
    try {
      const errJson = JSON.parse(rawText);
      message = errJson.error?.message ?? errJson.message ?? message;
    } catch {}
    throw new Error(message);
  }

  return parseImageResponse(rawText);
}

async function editOneViaImagesEndpoint(
  prompt: string,
  size: string,
  quality: string,
  referenceImage: ReferenceImageInput,
  config: GenerateConfig
): Promise<ImageResult> {
  if (!config.referenceEndpoint) {
    throw new HttpError("参考图生成接口未配置，请设置 IMAGE_REFERENCE_ENDPOINT 后再使用参考图", 500);
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  const startedAt = Date.now();
  const bytes = Buffer.from(referenceImage.data!, "base64");
  const extension = getExtension(referenceImage.mediaType!);
  const safeBaseName = referenceImage.name!.replace(/\.[^.]+$/, "").replace(/[^\w.-]+/g, "-").slice(0, 80) || "reference-image";
  const file = new File([bytes], `${safeBaseName}.${extension}`, { type: referenceImage.mediaType });
  const formData = new FormData();

  appendIfDefined(formData, "model", config.referenceModel);
  appendIfDefined(formData, "prompt", prompt);
  appendIfDefined(formData, "size", size);
  appendIfDefined(formData, "quality", getReferenceQuality(config, quality));
  appendIfDefined(formData, "response_format", "url");
  formData.append(config.referenceImageField, file);

  let response: Response;
  try {
    response = await fetch(config.referenceEndpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: formData,
      signal: controller.signal,
    });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error("参考图生成请求超时，请稍后重试");
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }

  const rawText = await response.text();
  console.info("[generate] upstream edit status:", response.status, `elapsed=${Date.now() - startedAt}ms`);

  if (!response.ok) {
    let message = `API 错误 ${response.status}`;
    try {
      const errJson = JSON.parse(rawText);
      message = errJson.error?.message ?? errJson.message ?? message;
    } catch {}
    throw new Error(message);
  }

  return parseImageResponse(rawText);
}

async function editOneViaChatEndpoint(
  prompt: string,
  size: string,
  quality: string,
  referenceImage: ReferenceImageInput,
  config: GenerateConfig
): Promise<ImageResult> {
  if (!config.referenceEndpoint) {
    throw new HttpError("参考图生成接口未配置，请设置 IMAGE_REFERENCE_ENDPOINT 后再使用参考图", 500);
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  const startedAt = Date.now();

  let response: Response;
  try {
    response = await fetch(config.referenceEndpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.referenceModel,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: buildReferenceChatPrompt(prompt, size, quality) },
              { type: "image_url", image_url: { url: referenceImageToDataUrl(referenceImage) } },
            ],
          },
        ],
        max_tokens: 4096,
      }),
      signal: controller.signal,
    });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error("参考图生成请求超时，请稍后重试");
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }

  const rawText = await response.text();
  console.info("[generate] upstream reference chat status:", response.status, `elapsed=${Date.now() - startedAt}ms`);

  if (!response.ok) {
    let message = `API 错误 ${response.status}`;
    try {
      const errJson = JSON.parse(rawText);
      message = errJson.error?.message ?? errJson.message ?? message;
    } catch {}
    throw new Error(message);
  }

  return parseChatImageResponse(rawText);
}

function generateWithReference(
  prompt: string,
  size: string,
  quality: string,
  referenceImage: ReferenceImageInput,
  config: GenerateConfig
) {
  if (config.referenceEndpointKind === "chat-completions") {
    return editOneViaChatEndpoint(prompt, size, quality, referenceImage, config);
  }
  if (config.referenceEndpointKind === "images-generations") {
    return editOneViaGenerationsEndpoint(prompt, size, quality, referenceImage, config);
  }
  return editOneViaImagesEndpoint(prompt, size, quality, referenceImage, config);
}

export async function POST(req: NextRequest) {
  try {
    const config = getConfig();
    const { prompt, size = "1024x1024", quality = "high", n = 1, referenceImage } = await readJson(req);
    const parsedReferenceImage = parseReferenceImage(referenceImage);

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
    const upstreamSize = getProviderSize(config, size);
    const baseBody = {
      model: config.model,
      prompt: prompt.trim(),
      size: upstreamSize,
      quality,
      response_format: "url",
      n: 1,
    };

    const startedAt = Date.now();
    console.info(
      "[generate] request:",
      `provider=${config.provider}`,
      `count=${count}`,
      `size=${size}`,
      `upstreamSize=${upstreamSize}`,
      `quality=${quality}`,
      `reference=${parsedReferenceImage ? "yes" : "no"}`,
      `referenceKind=${config.referenceEndpointKind ?? "none"}`,
      `model=${parsedReferenceImage ? config.referenceModel : config.model}`,
      `apiHost=${new URL(config.apiEndpoint).hostname}`,
      `referenceHost=${config.referenceEndpoint ? new URL(config.referenceEndpoint).hostname : "none"}`
    );

    // 并发生成 count 张，每次独立请求，兼容所有不支持 n>1 的中转
    const results = await Promise.allSettled(
      Array.from({ length: count }, () => (
        parsedReferenceImage
          ? generateWithReference(prompt.trim(), upstreamSize, quality, parsedReferenceImage, config)
          : generateOne(baseBody, config)
      ))
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
