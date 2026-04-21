import { NextRequest, NextResponse } from "next/server";

const API_KEY = process.env.IMAGE_API_KEY!.trim();
const API_ENDPOINT = process.env.IMAGE_API_ENDPOINT!.trim();
const MODEL = process.env.IMAGE_MODEL!.trim();

type ImageResult = { b64?: string; url?: string; mediaType: string };

// 单次请求，兼容不支持 n>1 的中转服务
async function generateOne(body: object): Promise<ImageResult> {
  const response = await fetch(API_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${API_KEY}`,
    },
    body: JSON.stringify(body),
  });

  const rawText = await response.text();
  console.log("[generate] ← status:", response.status, rawText.slice(0, 300));

  if (!response.ok) {
    let message = `API 错误 ${response.status}`;
    try {
      const errJson = JSON.parse(rawText);
      message = errJson.error?.message ?? errJson.message ?? message;
    } catch {}
    throw new Error(message);
  }

  const data = JSON.parse(rawText);
  if (!Array.isArray(data.data) || data.data.length === 0) {
    throw new Error("API 返回了未知格式，请稍后重试");
  }

  const img = data.data[0] as { b64_json?: string; url?: string };
  return { b64: img.b64_json, url: img.url, mediaType: "image/png" };
}

export async function POST(req: NextRequest) {
  try {
    const { prompt, size, quality, n = 1 } = await req.json();

    if (!prompt?.trim()) {
      return NextResponse.json({ error: "Prompt is required" }, { status: 400 });
    }

    const count = Math.min(Math.max(Number(n) || 1, 1), 4);
    const baseBody = {
      model: MODEL,
      prompt: prompt.trim(),
      size: size ?? "1024x1024",
      quality: quality ?? "high",
      response_format: "b64_json",
      n: 1,
    };

    console.log("[generate] →", API_ENDPOINT, `count=${count}`, "prompt:", prompt.trim().slice(0, 80));

    // 并发生成 count 张，每次独立请求，兼容所有不支持 n>1 的中转
    const images = await Promise.all(
      Array.from({ length: count }, () => generateOne(baseBody))
    );

    return NextResponse.json({ images });
  } catch (err) {
    console.error("[generate] exception:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
