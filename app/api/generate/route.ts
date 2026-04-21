import { NextRequest, NextResponse } from "next/server";

const API_KEY = process.env.IMAGE_API_KEY!.trim();
const API_ENDPOINT = process.env.IMAGE_API_ENDPOINT!.trim();
const MODEL = process.env.IMAGE_MODEL!.trim();

export async function POST(req: NextRequest) {
  try {
    const { prompt, size, quality } = await req.json();

    if (!prompt?.trim()) {
      return NextResponse.json({ error: "Prompt is required" }, { status: 400 });
    }

    // 根据端点自动选择请求格式
    const isImagesAPI = API_ENDPOINT.includes("/images/");

    const requestBody = isImagesAPI
      ? {
          model: MODEL,
          prompt: prompt.trim(),
          size: size ?? "1024x1024",
          quality: quality ?? "high",
          response_format: "b64_json",
          n: 1,
        }
      : {
          model: MODEL,
          messages: [{ role: "user", content: prompt.trim() }],
          stream: false,
        };

    console.log("[generate] →", API_ENDPOINT, "prompt:", prompt.trim().slice(0, 80));

    const response = await fetch(API_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${API_KEY}`,
      },
      body: JSON.stringify(requestBody),
    });

    const rawText = await response.text();
    console.log("[generate] ← status:", response.status, rawText.slice(0, 3000));

    if (!response.ok) {
      let message = `API 错误 ${response.status}`;
      try {
        const errJson = JSON.parse(rawText);
        message = errJson.error?.message ?? errJson.message ?? message;
      } catch {}
      return NextResponse.json({ error: message }, { status: response.status });
    }

    const data = JSON.parse(rawText);

    // ── Images API 格式 (/v1/images/generations) ──────────────────────
    if (data.data?.[0]) {
      const img = data.data[0];
      if (img.b64_json) return NextResponse.json({ b64: img.b64_json, mediaType: "image/png" });
      if (img.url) return NextResponse.json({ url: img.url });
    }

    // ── Chat Completions 格式 (/v1/chat/completions) ───────────────────
    const content = data.choices?.[0]?.message?.content;

    if (Array.isArray(content)) {
      for (const block of content) {
        if (block.type === "image_url") {
          const url: string = block.image_url?.url ?? "";
          if (url.startsWith("data:")) {
            const [meta, b64] = url.split(",");
            return NextResponse.json({ b64, mediaType: meta.replace("data:", "").replace(";base64", "") });
          }
          return NextResponse.json({ url });
        }
        if (block.type === "image") {
          return NextResponse.json({
            b64: block.image?.data ?? block.data,
            mediaType: block.image?.media_type ?? block.media_type ?? "image/png",
          });
        }
      }
    }

    if (typeof content === "string") {
      if (content.startsWith("data:")) {
        const [meta, b64] = content.split(",");
        return NextResponse.json({ b64, mediaType: meta.replace("data:", "").replace(";base64", "") });
      }
      if (/^https?:\/\//.test(content.trim())) return NextResponse.json({ url: content.trim() });
      const mdMatch = content.match(/!\[.*?\]\((https?:\/\/[^\s)]+)\)/);
      if (mdMatch) return NextResponse.json({ url: mdMatch[1] });
      const urlMatch = content.match(/https?:\/\/[^\s"')\]]+\.(png|jpg|jpeg|webp|gif)/i);
      if (urlMatch) return NextResponse.json({ url: urlMatch[0] });
      const dataMatch = content.match(/data:(image\/[a-z]+);base64,([A-Za-z0-9+/=]+)/);
      if (dataMatch) return NextResponse.json({ b64: dataMatch[2], mediaType: dataMatch[1] });

      // 纯文本错误（tu-zi 内部错误消息）
      const errLine = content.split("\n").reverse().find((l) => l.includes("❌") || l.includes("失败") || l.includes("error"));
      const message = errLine
        ? errLine.replace(/^[>\s*❌]+/, "").trim()
        : content.replace(/[*>`{}"]/g, "").trim().slice(0, 150);
      return NextResponse.json({ error: `生成失败：${message}` }, { status: 500 });
    }

    return NextResponse.json({ error: "API 返回了未知格式，请稍后重试" }, { status: 500 });
  } catch (err) {
    console.error("[generate] exception:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
