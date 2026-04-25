import { NextRequest, NextResponse } from "next/server";

const ENHANCE_TIMEOUT_MS = 30_000;

class HttpError extends Error {
  constructor(message: string, public status = 500) {
    super(message);
  }
}

function getConfig() {
  const apiKey = process.env.IMAGE_API_KEY?.trim();
  const imageEndpoint = process.env.IMAGE_API_ENDPOINT?.trim();
  const model = (process.env.ENHANCE_MODEL ?? "gemini-3.1-flash-lite-preview").trim();

  if (!apiKey || !imageEndpoint) {
    throw new HttpError("服务端配置缺失，请检查环境变量", 500);
  }

  let origin: string;
  try {
    origin = new URL(imageEndpoint).origin;
  } catch {
    throw new HttpError("IMAGE_API_ENDPOINT 配置无效", 500);
  }

  return { apiKey, chatEndpoint: `${origin}/v1/chat/completions`, model };
}

const SYSTEM_PROMPT = `你是一位专业的 AI 图像生成提示词专家，专门为 gpt-image-2 模型优化提示词。
将用户的简短描述改写成高质量的图像生成提示词。

规则：
- 保留用户的核心创意意图，不改变主题
- 用中文描述，语言精练清晰
- 补充具体的视觉细节：光影氛围、材质质感、色彩倾向、空间层次
- 适当加入艺术风格或摄影手法描述（如：电影感光效、自然散射光、极简构图）
- 避免空泛形容词，改用具体可视化的描述
- 若有参考图，先分析其视觉风格、色彩调性、构图特点，将这些元素自然融入提示词
- 只输出提示词本身，不加解释、不加引号、不加标题`;

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

type ContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

export async function POST(req: NextRequest) {
  try {
    const config = getConfig();

    let body: {
      prompt?: unknown;
      aspect?: unknown;
      quality?: unknown;
      referenceImage?: { data?: string; mediaType?: string };
    };
    try {
      body = await req.json();
    } catch {
      throw new HttpError("请求体不是有效的 JSON", 400);
    }

    const { prompt, aspect = "auto", quality = "high", referenceImage } = body;

    if (typeof prompt !== "string" || !prompt.trim()) {
      throw new HttpError("Prompt is required", 400);
    }
    if (prompt.length > 4000) {
      throw new HttpError("Prompt 不能超过 4000 个字符", 400);
    }

    const contextLines = [
      referenceImage?.data
        ? "参考图已上传，请分析其视觉风格、色彩调性、构图特点，将这些元素融入提示词"
        : null,
      `目标画幅：${ASPECT_DESC[String(aspect)] ?? ASPECT_DESC["auto"]}`,
      `输出质量：${QUALITY_DESC[String(quality)] ?? QUALITY_DESC["high"]}`,
    ]
      .filter(Boolean)
      .join("\n");

    const userContent: ContentPart[] = [];

    if (referenceImage?.data && referenceImage?.mediaType) {
      userContent.push({
        type: "image_url",
        image_url: { url: `data:${referenceImage.mediaType};base64,${referenceImage.data}` },
      });
    }

    userContent.push({
      type: "text",
      text: `用户原始提示词：「${prompt.trim()}」\n\n当前参数：\n${contextLines}\n\n请输出优化后的提示词：`,
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
    console.info("[enhance] upstream status:", response.status);

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
