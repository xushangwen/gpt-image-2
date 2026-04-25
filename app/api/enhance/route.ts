import { NextRequest, NextResponse } from "next/server";

export const maxDuration = 60;

const ENHANCE_TIMEOUT_MS = 30_000;
type ProviderName = "tuzi" | "bltcy" | "custom";

const PROVIDER_CHAT_ENDPOINTS: Record<Exclude<ProviderName, "custom">, string> = {
  tuzi: "https://api.tu-zi.com/v1/chat/completions",
  bltcy: "https://api.bltcy.ai/v1/chat/completions",
};

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

function getProviderEnv(provider: ProviderName, suffix: string) {
  if (provider === "custom") return undefined;
  return process.env[`${provider.toUpperCase()}_${suffix}`]?.trim();
}

function getConfig(providerOverride?: ProviderName) {
  const provider = providerOverride ?? getProvider();
  const apiKey = getProviderEnv(provider, "API_KEY") || process.env.IMAGE_API_KEY?.trim();
  const chatEndpoint =
    getProviderEnv(provider, "CHAT_ENDPOINT") ||
    getProviderEnv(provider, "ENHANCE_ENDPOINT") ||
    (provider === "custom" ? process.env.ENHANCE_API_ENDPOINT?.trim() : PROVIDER_CHAT_ENDPOINTS[provider]);
  const model = (
    getProviderEnv(provider, "ENHANCE_MODEL") ||
    process.env.ENHANCE_MODEL ||
    "gemini-2.0-flash-lite"
  ).trim();

  if (!apiKey || !chatEndpoint) {
    throw new HttpError("服务端配置缺失，请检查环境变量", 500);
  }

  try {
    new URL(chatEndpoint);
  } catch {
    throw new HttpError("提示词增强接口地址配置无效", 500);
  }

  return { provider, apiKey, chatEndpoint, model };
}

const SYSTEM_PROMPT = `你是一位专业的 AI 图像生成提示词专家，专门为 gpt-image-2 模型优化提示词。
将用户的简短描述改写成高质量的图像生成提示词。

基本规则：
- 保留用户的核心创意意图，不改变内容主体
- 用中文描述，语言精练清晰
- 补充具体的视觉细节：光影氛围、材质质感、色彩倾向、空间层次
- 适当加入艺术风格或摄影手法描述（如：电影感光效、自然散射光、极简构图）
- 避免空泛形容词，改用具体可视化的描述
- 只输出提示词本身，不加解释、不加引号、不加标题

当用户提供了参考图时，严格遵守以下规则：
- 内容主体（画什么）：完全由用户的文字提示词决定，绝对不能被参考图的内容主体所替代
- 视觉风格（怎么画）：从参考图中提取色彩调性、光影风格、材质感觉、构图手法、艺术技法
- 正确做法示例：用户说"五一劳动节海报"，参考图是深色背景的太空几何海报
  → 输出"五一劳动节海报，工人劳动场景为主体，采用深色极简背景，几何硬朗构图，红黑强对比配色，粗线条装饰元素，工业感视觉风格"
  → 内容是五一主题，风格借鉴参考图
- 错误做法：输出太空卫星（把参考图内容当成了画面主体）
- 提示词中需要明确体现：用户的内容意图 + 从参考图提炼的视觉风格关键词`;

const ASPECT_DESC: Record<string, string> = {
  auto: "由模型自行决定最佳构图",
  "1:1": "方形画幅（1024×1024），适合社交媒体封面",
  "3:2": "横版画幅（1536×1024），适合风景、Banner、桌面壁纸",
  "2:3": "竖版画幅（1024×1536），适合海报、手机封面、人像",
};

const QUALITY_DESC: Record<string, string> = {
  low: "快速出图，保留主要视觉方向",
  medium: "完整细节，质感清晰",
  high: "高质量商业级图像，细节丰富，光影精致",
};

const ALLOWED_REFERENCE_MEDIA_TYPES = new Set(["image/png", "image/jpeg", "image/jpg", "image/webp"]);

function normalizeMediaType(mediaType: string) {
  return mediaType === "image/jpg" ? "image/jpeg" : mediaType;
}

type ContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

export async function POST(req: NextRequest) {
  try {
    let body: {
      prompt?: unknown;
      aspect?: unknown;
      quality?: unknown;
      referenceImage?: { data?: string; mediaType?: string };
      provider?: unknown;
    };
    try {
      body = await req.json();
    } catch {
      throw new HttpError("请求体不是有效的 JSON", 400);
    }

    const { prompt, aspect = "auto", quality = "high", referenceImage } = body;
    const reqProvider: ProviderName | undefined =
      body.provider === "tuzi" || body.provider === "bltcy" ? body.provider : undefined;
    const config = getConfig(reqProvider);

    if (typeof prompt !== "string" || !prompt.trim()) {
      throw new HttpError("Prompt is required", 400);
    }
    if (prompt.length > 4000) {
      throw new HttpError("Prompt 不能超过 4000 个字符", 400);
    }

    const contextLines = [
      referenceImage?.data
        ? "【参考图说明】参考图仅提供视觉风格参考（色彩、光影、构图手法、材质质感），画面的内容主体必须完全来自用户的文字提示词，不得照搬参考图的内容"
        : null,
      `目标画幅：${ASPECT_DESC[String(aspect)] ?? ASPECT_DESC["auto"]}`,
      `输出质量：${QUALITY_DESC[String(quality)] ?? QUALITY_DESC["high"]}`,
    ]
      .filter(Boolean)
      .join("\n");

    const userContent: ContentPart[] = [];

    if (referenceImage?.data && referenceImage?.mediaType) {
      if (!ALLOWED_REFERENCE_MEDIA_TYPES.has(referenceImage.mediaType)) {
        throw new HttpError("参考图类型不支持", 400);
      }
      userContent.push({
        type: "image_url",
        image_url: { url: `data:${normalizeMediaType(referenceImage.mediaType)};base64,${referenceImage.data}` },
      });
    }

    userContent.push({
      type: "text",
      text: `用户原始提示词：「${prompt.trim()}」\n\n附加说明：\n${contextLines}\n\n请输出优化后的提示词（内容主体必须是"${prompt.trim()}"，风格从参考图中提炼）：`,
    });

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), ENHANCE_TIMEOUT_MS);

    let response: Response;
    try {
      response = await fetch(config.chatEndpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify({
          model: config.model,
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: userContent },
          ],
          max_tokens: 600,
          temperature: 0.7,
        }),
        signal: controller.signal,
      });
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        throw new Error("提示词增强请求超时，请稍后重试");
      }
      throw err;
    } finally {
      clearTimeout(timeoutId);
    }

    const rawText = await response.text();
    console.info("[enhance] upstream status:", response.status, `provider=${config.provider}`, `apiHost=${new URL(config.chatEndpoint).hostname}`);

    if (!response.ok) {
      let message = `API 错误 ${response.status}`;
      try {
        const errJson = JSON.parse(rawText);
        message = errJson.error?.message ?? errJson.message ?? message;
      } catch {}
      throw new Error(message);
    }

    let data: { choices?: { message?: { content?: string } }[] };
    try {
      data = JSON.parse(rawText);
    } catch {
      throw new Error("模型返回了无法解析的数据");
    }

    const enhancedPrompt = data.choices?.[0]?.message?.content?.trim();
    if (!enhancedPrompt) throw new Error("模型未返回增强结果，请重试");

    return NextResponse.json({ enhancedPrompt });
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    const message = err instanceof Error ? err.message : String(err);
    console.error("[enhance] failed:", message);
    return NextResponse.json({ error: message }, { status });
  }
}
