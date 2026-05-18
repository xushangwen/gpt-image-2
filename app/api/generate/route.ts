import { NextRequest, NextResponse } from "next/server";
import { auth, currentUser } from "@clerk/nextjs/server";
import { getOrCreateCredits, getCreditsOnly, deductCredits, refundCredits } from "@/lib/credits";
import { acquireGenerationLock, releaseGenerationLock } from "@/lib/locks";
import { getSupabase } from "@/lib/supabase";
import { fetchSafeUrl, UrlSafetyError } from "@/lib/url-safety";
import { HttpError } from "@/lib/errors";

export const maxDuration = 300;

type ImageResult = { b64?: string; url?: string; mediaType: string };
type ProviderName = "tuzi" | "yunwu" | "custom";
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
  // 线路二：yunwu.ai（云雾，OpenAI 兼容接口）
  yunwu: {
    apiEndpoint: "https://yunwu.ai/v1/images/generations",
    referenceEndpoint: "https://yunwu.ai/v1/images/edits",
    referenceImageField: "image",
    referenceQuality: "",
    sizeFormat: "pixel",
  },
};

const ALLOWED_SIZES = new Set(["1024x1024", "1536x1024", "1024x1536"]);
const ALLOWED_QUALITIES = new Set(["auto", "low", "medium", "high"]);
const SIZE_TO_RATIO: Record<string, string> = {
  "1024x1024": "1:1",
  "1536x1024": "3:2",
  "1024x1536": "2:3",
};
const ALLOWED_REFERENCE_TYPES = new Set(["image/png", "image/jpeg", "image/jpg", "image/webp"]);
const MAX_PROMPT_LENGTH = 4000;
const MAX_REFERENCE_BYTES = 10 * 1024 * 1024;
// gpt-image-2 + yunwu 实测 130-180s。150s 阈值会误杀 149s 才完成的请求
// （事故：客户端已 timeout abort，但上游已完成生图并扣 token，钱白花）。
// 拉到 270s 给响应/退款留 30s 余量，仍在 Vercel maxDuration=300s 内。
const UPSTREAM_TIMEOUT_MS = 270_000;
// 本项目只用 gpt-image-2。按 OpenAI 官方支持 low/medium/high/auto。
const QUALITY_SUPPORTED_MODELS = new Set(["gpt-image-2"]);
// 生图请求一旦发到上游，服务端 Abort/超时不保证能取消上游后台任务。
// 自动重试会造成"前端失败，但上游继续出图并重复扣费"，所以始终单次调用。

function getProvider(): ProviderName {
  const provider = (process.env.IMAGE_PROVIDER ?? "tuzi").trim().toLowerCase();
  if (provider === "tuzi" || provider === "yunwu" || provider === "custom") return provider;
  throw new HttpError(`不支持的图像中转配置：${provider}`, 500);
}

function providerEnvName(provider: ProviderName, suffix: string) {
  return `${provider.toUpperCase()}_${suffix}`;
}

function getProviderEnv(provider: ProviderName, suffix: string) {
  if (provider === "custom") return undefined;
  return process.env[providerEnvName(provider, suffix)]?.trim();
}

// 支持逗号 / 空白分隔多 key，随机挑一个。serverless 无共享状态，随机比轮询更稳。
function pickApiKey(provider: ProviderName): string | undefined {
  const raw =
    provider === "custom"
      ? process.env.IMAGE_API_KEY?.trim()
      : getProviderEnv(provider, "API_KEY");
  if (!raw) return undefined;
  const keys = raw.split(/[,\s]+/).map((k) => k.trim()).filter(Boolean);
  if (keys.length === 0) return undefined;
  if (keys.length === 1) return keys[0];
  const picked = keys[Math.floor(Math.random() * keys.length)];
  console.log(`[generate] ${provider} 使用 key ...${picked.slice(-4)}（共 ${keys.length} 个）`);
  return picked;
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

function getConfig(providerOverride?: ProviderName): GenerateConfig {
  const provider = providerOverride ?? getProvider();
  const preset = provider === "custom" ? null : PROVIDER_PRESETS[provider];
  const apiKey = pickApiKey(provider);
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

// 上游有时会忽略 response_format: b64_json 而返回 URL；在服务端代理 fetch 并转成 base64，
// 保证前端永远只收到 b64，杜绝 URL 过期 / CORS 导致图裂。
async function resolveImageResult(img: ImageResult): Promise<ImageResult> {
  if (img.b64) {
    return img;
  }
  // url 必须是合法的 http(s) 地址才值得 fetch；空字符串直接跳过
  if (!img.url || !img.url.startsWith("http")) {
    console.warn("[generate] image has no valid b64 or url, discarding");
    return img;
  }
  try {
    const res = await fetchSafeUrl(img.url, { signal: AbortSignal.timeout(30_000) });
    if (!res.ok) {
      console.warn("[generate] url fetch failed:", res.status);
      return img;
    }
    const mediaType = res.headers.get("content-type")?.split(";")[0].trim() || img.mediaType;
    const b64 = Buffer.from(await res.arrayBuffer()).toString("base64");
    return { b64, mediaType };
  } catch (err) {
    if (err instanceof UrlSafetyError) {
      console.warn("[generate] blocked unsafe image url:", err.message);
      return img;
    }
    console.warn("[generate] url fetch error:", err instanceof Error ? err.message : String(err));
    return img;
  }
}

async function readJson(req: NextRequest) {
  try {
    return await req.json();
  } catch {
    throw new HttpError("请求体不是有效的 JSON", 400);
  }
}

const MAX_REFERENCE_IMAGES = 4;

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
    throw new HttpError("单张参考图不能超过 10 MB", 400);
  }

  return {
    data: ref.data,
    mediaType: ref.mediaType,
    name: typeof ref.name === "string" && ref.name.trim() ? ref.name.trim() : "reference-image",
  };
}

// 支持新版数组 referenceImages 与旧版单图 referenceImage（向后兼容）
function parseReferenceImages(arrInput: unknown, singleInput: unknown): ReferenceImageInput[] {
  const raw = Array.isArray(arrInput) ? arrInput : (singleInput ? [singleInput] : []);
  if (raw.length > MAX_REFERENCE_IMAGES) {
    throw new HttpError(`最多支持 ${MAX_REFERENCE_IMAGES} 张参考图`, 400);
  }
  const parsed: ReferenceImageInput[] = [];
  for (const item of raw) {
    const ref = parseReferenceImage(item);
    if (ref) parsed.push(ref);
  }
  return parsed;
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

// 部分中转的 b64_json 字段返回完整 data URL（data:image/png;base64,<data>）
// 而非纯 base64，此函数统一提取出纯 base64 并去除 MIME 换行
function normalizeB64(rawB64: string, fallbackMediaType: string): { b64: string; mediaType: string } {
  const dataUrlMatch = rawB64.match(/^data:(image\/[a-z0-9.+\-]+);base64,/i);
  if (dataUrlMatch) {
    return { b64: rawB64.slice(dataUrlMatch[0].length).replace(/\s/g, ""), mediaType: dataUrlMatch[1] };
  }
  return { b64: rawB64.replace(/\s/g, ""), mediaType: fallbackMediaType };
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

  const fallbackMediaType = typeof value.mime_type === "string" ? value.mime_type : "image/png";
  if (typeof value.b64_json === "string" && value.b64_json) {
    return normalizeB64(value.b64_json, fallbackMediaType);
  }
  if (typeof value.base64 === "string" && value.base64) {
    return normalizeB64(value.base64, fallbackMediaType);
  }
  if (typeof value.url === "string" && value.url) {
    return imageFromString(value.url) ?? { url: value.url, mediaType: "image/png" };
  }
  if (typeof value.image_url === "string" && value.image_url) {
    return imageFromString(value.image_url) ?? { url: value.image_url, mediaType: "image/png" };
  }
  if (isRecord(value.image_url) && typeof value.image_url.url === "string" && value.image_url.url) {
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

type UpstreamErrorKind =
  | "timeout"
  | "network"
  | "server_5xx"
  | "rate_limit"
  | "quota_exhausted"
  | "content_blocked"
  | "auth_failed"
  | "bad_request"
  | "unknown";

class UpstreamError extends Error {
  constructor(public kind: UpstreamErrorKind, message: string, public status?: number) {
    super(message);
    this.name = "UpstreamError";
  }
  // 这种错误适合在换 key 后重试一次
  get retriable() {
    return this.kind === "timeout" || this.kind === "network" || this.kind === "server_5xx" || this.kind === "rate_limit";
  }
  // 给用户看的友好中文文案，不暴露上游原文
  get userMessage() {
    switch (this.kind) {
      case "timeout":          return "生成超时，请稍后重试（积分已自动退还）";
      case "network":          return "网络异常，请检查连接后重试";
      case "server_5xx":       return "上游服务暂时不可用，请稍后重试";
      case "rate_limit":       return "请求过于频繁，请等待几秒后重试";
      case "quota_exhausted":  return "服务暂时繁忙，已知悉并在处理，请稍后重试";
      case "content_blocked":  return "内容未通过安全审查，请修改提示词后再试";
      case "auth_failed":      return "服务配置异常，请联系管理员";
      case "bad_request":      return "请求参数有误，请调整后重试";
      default:                 return "生成失败，请稍后重试";
    }
  }
}

function classifyUpstreamError(status: number, rawText: string): UpstreamError {
  let raw = "";
  try {
    const j = JSON.parse(rawText);
    raw = String(j.error?.message ?? j.message ?? "").toLowerCase();
  } catch {
    raw = rawText.slice(0, 200).toLowerCase();
  }

  if (status === 401 || status === 403) return new UpstreamError("auth_failed", `auth ${status}`, status);
  if (status === 429) {
    if (raw.includes("quota") || raw.includes("balance") || raw.includes("额度") || raw.includes("余额")) {
      return new UpstreamError("quota_exhausted", `quota: ${raw}`, status);
    }
    return new UpstreamError("rate_limit", `rate limit ${status}`, status);
  }
  if (status >= 500) return new UpstreamError("server_5xx", `upstream ${status}`, status);
  if (status >= 400) {
    if (raw.includes("content_policy") || raw.includes("safety") || raw.includes("policy") || raw.includes("禁止") || raw.includes("敏感")) {
      return new UpstreamError("content_blocked", `blocked: ${raw}`, status);
    }
    return new UpstreamError("bad_request", `bad request ${status}: ${raw.slice(0, 80)}`, status);
  }
  return new UpstreamError("unknown", `unknown ${status}`, status);
}

// 把中转商真实返回的 model + usage 字段记到日志，便于判断是否在做"我们送 gpt-image-2
// 实际跑 gpt-image-1.5"这种偷偷模型映射，以及核对计费 token 数与官方档位是否吻合。
function logUpstreamMeta(rawText: string, label: string) {
  try {
    const j = JSON.parse(rawText);
    const model = j?.model;
    const usage = j?.usage;
    if (model || usage) {
      console.log(
        `[upstream:${label}] model=${model ?? "-"} usage=${JSON.stringify(usage ?? {})}`
      );
    }
  } catch {
    // 非 JSON 响应（如 chat-completions 流文本）直接跳过
  }
}

async function fetchUpstream(
  url: string,
  init: Omit<RequestInit, "signal">,
  timeoutLabel: string
): Promise<string> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(url, { ...init, signal: controller.signal });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new UpstreamError("timeout", `${timeoutLabel}超时`);
    }
    throw new UpstreamError("network", `network error: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    clearTimeout(timeoutId);
  }

  const rawText = await response.text();
  if (!response.ok) {
    throw classifyUpstreamError(response.status, rawText);
  }
  return rawText;
}

// 单次上游请求。当前不自动重试（上游 abort 不保证取消任务，重试会导致中转商二次扣费）
async function generateOne(body: object, config: GenerateConfig): Promise<ImageResult> {
  const rawText = await fetchUpstream(
    config.apiEndpoint,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.apiKey}` },
      body: JSON.stringify(body),
    },
    "图像生成请求"
  );
  logUpstreamMeta(rawText, `${config.provider}:gen:${config.model}`);
  return parseImageResponse(rawText);
}

async function editOneViaGenerationsEndpoint(
  prompt: string,
  size: string,
  quality: string,
  referenceImages: ReferenceImageInput[],
  config: GenerateConfig
): Promise<ImageResult> {
  if (!config.referenceEndpoint) {
    throw new HttpError("参考图生成接口未配置，请设置 IMAGE_REFERENCE_ENDPOINT 后再使用参考图", 500);
  }

  // tuzi 文档示例：image 字段支持数组 ["base64", "base64"]；单图时仍兼容传字符串
  const imageField = referenceImages.length === 1
    ? referenceImageToDataUrl(referenceImages[0])
    : referenceImages.map(referenceImageToDataUrl);

  const body: Record<string, unknown> = {
    model: config.referenceModel,
    prompt,
    size,
    response_format: "b64_json",
    n: 1,
    output_format: "jpeg",
    output_compression: 85,
    [config.referenceImageField]: imageField,
  };
  if (QUALITY_SUPPORTED_MODELS.has(config.referenceModel)) {
    const resolvedQuality = getReferenceQuality(config, quality);
    if (resolvedQuality) body.quality = resolvedQuality;
  }

  const rawText = await fetchUpstream(
    config.referenceEndpoint,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.apiKey}` },
      body: JSON.stringify(body),
    },
    "参考图生成请求"
  );
  logUpstreamMeta(rawText, `${config.provider}:edit-gen:${config.referenceModel}`);
  return parseImageResponse(rawText);
}

async function editOneViaImagesEndpoint(
  prompt: string,
  size: string,
  quality: string,
  referenceImages: ReferenceImageInput[],
  config: GenerateConfig
): Promise<ImageResult> {
  if (!config.referenceEndpoint) {
    throw new HttpError("参考图生成接口未配置，请设置 IMAGE_REFERENCE_ENDPOINT 后再使用参考图", 500);
  }

  const formData = new FormData();
  appendIfDefined(formData, "model", config.referenceModel);
  appendIfDefined(formData, "prompt", prompt);
  appendIfDefined(formData, "size", size);
  if (QUALITY_SUPPORTED_MODELS.has(config.referenceModel)) {
    appendIfDefined(formData, "quality", getReferenceQuality(config, quality));
  }
  appendIfDefined(formData, "response_format", "b64_json");
  appendIfDefined(formData, "output_format", "jpeg");
  appendIfDefined(formData, "output_compression", 85);

  // OpenAI / yunwu 标准：多张参考图通过同名 image[] 字段重复 append
  // 单张时按 image 也兼容；多张时统一用 image[] 以避免被服务端覆盖
  const fieldKey = referenceImages.length > 1
    ? `${config.referenceImageField}[]`
    : config.referenceImageField;

  for (let i = 0; i < referenceImages.length; i++) {
    const ref = referenceImages[i];
    const bytes = Buffer.from(ref.data!, "base64");
    const extension = getExtension(ref.mediaType!);
    const safeBaseName = ref.name!.replace(/\.[^.]+$/, "").replace(/[^\w.-]+/g, "-").slice(0, 80) || `reference-${i + 1}`;
    const file = new File([bytes], `${safeBaseName}.${extension}`, { type: ref.mediaType });
    formData.append(fieldKey, file);
  }

  const rawText = await fetchUpstream(
    config.referenceEndpoint,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${config.apiKey}` },
      body: formData,
    },
    "参考图生成请求"
  );
  logUpstreamMeta(rawText, `${config.provider}:edit-multipart:${config.referenceModel}`);
  return parseImageResponse(rawText);
}

async function editOneViaChatEndpoint(
  prompt: string,
  size: string,
  quality: string,
  referenceImages: ReferenceImageInput[],
  config: GenerateConfig
): Promise<ImageResult> {
  if (!config.referenceEndpoint) {
    throw new HttpError("参考图生成接口未配置，请设置 IMAGE_REFERENCE_ENDPOINT 后再使用参考图", 500);
  }

  const rawText = await fetchUpstream(
    config.referenceEndpoint,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.apiKey}` },
      body: JSON.stringify({
        model: config.referenceModel,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: buildReferenceChatPrompt(prompt, size, quality) },
              // 多图：逐张 append 为 image_url part
              ...referenceImages.map(ref => ({
                type: "image_url" as const,
                image_url: { url: referenceImageToDataUrl(ref) },
              })),
            ],
          },
        ],
        max_tokens: 4096,
      }),
    },
    "参考图生成请求"
  );
  logUpstreamMeta(rawText, `${config.provider}:edit-chat:${config.referenceModel}`);
  return parseChatImageResponse(rawText);
}

function generateWithReference(
  prompt: string,
  size: string,
  quality: string,
  referenceImages: ReferenceImageInput[],
  config: GenerateConfig
) {
  if (config.referenceEndpointKind === "chat-completions") {
    return editOneViaChatEndpoint(prompt, size, quality, referenceImages, config);
  }
  if (config.referenceEndpointKind === "images-generations") {
    return editOneViaGenerationsEndpoint(prompt, size, quality, referenceImages, config);
  }
  return editOneViaImagesEndpoint(prompt, size, quality, referenceImages, config);
}

export async function POST(req: NextRequest) {
  const reqStart = Date.now();
  const traceId = Math.random().toString(36).slice(2, 8);
  let acquiredUserId: string | null = null;
  try {
    const { userId } = await auth();
    if (!userId) throw new HttpError("请先登录", 401);

    // 同一用户并发拦截：Supabase 数据库锁，跨 vercel 项目/实例/部署都生效
    // （防止用户在多个项目实例打开页面时同一 userId 被同时扣费多次）
    const lockResult = await acquireGenerationLock(userId);
    if (lockResult === "held") {
      console.warn(`[generate ${traceId}] REJECTED user=${userId.slice(-8)} reason=lock_held`);
      throw new HttpError("已有生图任务进行中，请等待完成（如果你刚才取消过页面，请稍等 5 分钟自动释放）", 429);
    }
    if (lockResult === "error") {
      console.warn(`[generate ${traceId}] REJECTED user=${userId.slice(-8)} reason=lock_db_error`);
      throw new HttpError("系统繁忙，请稍后重试", 503);
    }
    acquiredUserId = userId;

    console.log(`[generate ${traceId}] START user=${userId.slice(-8)}`);

    const raw = await readJson(req);
    const { prompt, size = "1024x1024", quality = "high", n = 1, referenceImage, referenceImages } = raw;
    // 前端线路一/线路二切换是产品特性；服务端只接受白名单值，不接受其他覆盖
    const reqProvider: ProviderName | undefined =
      raw.provider === "tuzi" || raw.provider === "yunwu" ? raw.provider : undefined;
    const config = getConfig(reqProvider);
    // 同时兼容新版 referenceImages 数组与旧版 referenceImage 单图
    const parsedReferenceImages = parseReferenceImages(referenceImages, referenceImage);

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

    // ── 积分验证与扣除（先扣后生成，防并发超用）──

    let creditsRemaining = await getCreditsOnly(userId);
    if (creditsRemaining === null) {
      const user = await currentUser();
      const email = user?.emailAddresses[0]?.emailAddress ?? "";
      const credits = await getOrCreateCredits(userId, email);
      creditsRemaining = credits.credits_remaining;
    }

    const newBalance = await deductCredits(userId, count, prompt, {
      engine: "openai",
      provider: config.provider,
      size,
      quality,
    });
    if (newBalance < 0) {
      throw new HttpError("积分不足，请购买套餐", 402);
    }
    console.log(`[generate ${traceId}] DEDUCT count=${count} provider=${config.provider} model=${config.model} size=${size} quality=${quality} balance=${newBalance} prompt="${prompt.slice(0, 40)}"`);

    const upstreamSize = getProviderSize(config, size);
    const baseBody: Record<string, unknown> = {
      model: config.model,
      prompt: prompt.trim(),
      size: upstreamSize,
      response_format: "b64_json",
      n: 1,
      // 国内用户跨境拉 vercel(hkg1) 时，PNG base64 单张 4-7MB，下行常常 40-70s。
      // OpenAI gpt-image-2 原生支持 output_format=jpeg + output_compression，
      // 体积可砍到 1.2-2MB（视觉无损 85），下行时间减半。
      // 参考：https://developers.openai.com/api/docs/guides/image-generation
      output_format: "jpeg",
      output_compression: 85,
    };
    // 仅对支持 quality 的模型（如 dall-e-3）传 quality；gpt-image-2 中转商不接受会报 400
    if (QUALITY_SUPPORTED_MODELS.has(config.model)) {
      baseBody.quality = quality;
    }

    // 并发生成 count 张，每次独立请求，兼容所有不支持 n>1 的中转
    const results = await Promise.allSettled(
      Array.from({ length: count }, () => (
        parsedReferenceImages.length > 0
          ? generateWithReference(prompt.trim(), upstreamSize, quality, parsedReferenceImages, config)
          : generateOne(baseBody, config)
      ))
    );
    const fulfilled = results.filter(
      (result): result is PromiseFulfilledResult<ImageResult> => result.status === "fulfilled"
    );
    const images = await Promise.all(fulfilled.map(r => resolveImageResult(r.value)));

    const failures = results.filter(result => result.status === "rejected");

    if (images.length === 0) {
      const firstReason = failures[0] as PromiseRejectedResult | undefined;
      const upstreamErr = firstReason?.reason instanceof UpstreamError ? firstReason.reason : null;
      console.log(`[generate ${traceId}] FAIL elapsed=${Date.now() - reqStart}ms kind=${upstreamErr?.kind ?? "unknown"}`);
      try {
        await refundCredits(userId, count);
      } catch (refundErr) {
        // 退款也挂了，告诉用户去找客服，不要让用户白扣
        console.error("[generate] refund failed after generation failure:", refundErr);
        throw new HttpError(
          `生成失败，且积分退款异常，请截图本订单联系客服处理（${upstreamErr?.userMessage ?? "未知错误"}）`,
          502
        );
      }
      const userMsg = upstreamErr?.userMessage ?? getErrorMessage(firstReason?.reason ?? "生成失败");
      throw new HttpError(userMsg, upstreamErr?.kind === "content_blocked" ? 400 : 502);
    }

    const failedCount = count - images.length;
    if (failedCount > 0) {
      try {
        await refundCredits(userId, failedCount);
      } catch (refundErr) {
        // 部分成功时退款失败：仍把成功的图片返回，但 warning 强调
        console.error("[generate] partial refund failed:", refundErr);
        return NextResponse.json({
          images,
          warning: `${failedCount} 张生成失败，但积分退款异常，请截图联系客服补退`,
        });
      }
    }

    console.log(`[generate ${traceId}] OK elapsed=${Date.now() - reqStart}ms ok=${images.length} failed=${failures.length}`);
    return NextResponse.json({
      images,
      warning: failures.length > 0 ? `${failures.length} 张图片生成失败，对应积分已自动退还` : undefined,
    });
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    const message = err instanceof UpstreamError ? err.userMessage : getErrorMessage(err);
    console.error("[generate] failed:", err);
    return NextResponse.json({ error: message }, { status });
  } finally {
    if (acquiredUserId) {
      await releaseGenerationLock(acquiredUserId);
    }
  }
}
