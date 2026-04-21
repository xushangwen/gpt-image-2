import { NextRequest, NextResponse } from "next/server";

const API_KEY = process.env.IMAGE_API_KEY!.trim();
const API_ENDPOINT = process.env.IMAGE_API_ENDPOINT!.trim();
const MODEL = process.env.IMAGE_MODEL!.trim();

type ImageResult = { b64?: string; url?: string; mediaType: string };

export async function POST(req: NextRequest) {
  try {
    const { prompt, size, quality, n = 1 } = await req.json();

    if (!prompt?.trim()) {
      return NextResponse.json({ error: "Prompt is required" }, { status: 400 });
    }

    const requestBody = {
      model: MODEL,
      prompt: prompt.trim(),
      size: size ?? "1024x1024",
      quality: quality ?? "high",
      response_format: "b64_json",
      n: Math.min(Math.max(Number(n) || 1, 1), 4),
    };

    console.log("[generate] →", API_ENDPOINT, `n=${requestBody.n}`, "prompt:", prompt.trim().slice(0, 80));

    const response = await fetch(API_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${API_KEY}`,
      },
      body: JSON.stringify(requestBody),
    });

    const rawText = await response.text();
    console.log("[generate] ← status:", response.status, rawText.slice(0, 500));

    if (!response.ok) {
      let message = `API 错误 ${response.status}`;
      try {
        const errJson = JSON.parse(rawText);
        message = errJson.error?.message ?? errJson.message ?? message;
      } catch {}
      return NextResponse.json({ error: message }, { status: response.status });
    }

    const data = JSON.parse(rawText);

    // Images API 格式: data 数组，每项含 b64_json 或 url
    if (Array.isArray(data.data) && data.data.length > 0) {
      const images: ImageResult[] = data.data.map((img: { b64_json?: string; url?: string }) => ({
        b64: img.b64_json,
        url: img.url,
        mediaType: "image/png",
      }));
      return NextResponse.json({ images });
    }

    return NextResponse.json({ error: "API 返回了未知格式，请稍后重试" }, { status: 500 });
  } catch (err) {
    console.error("[generate] exception:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
