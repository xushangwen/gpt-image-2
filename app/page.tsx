"use client";

import { useState, useRef, useCallback } from "react";

type AspectRatio = "auto" | "1:1" | "3:2" | "2:3";
type Quality = "low" | "medium" | "high";

const ASPECT_OPTIONS: { label: string; value: AspectRatio; size: string; icon: string }[] = [
  { label: "自动", value: "auto", size: "auto", icon: "ri-magic-line" },
  { label: "方形", value: "1:1", size: "1024x1024", icon: "ri-square-line" },
  { label: "横版", value: "3:2", size: "1536x1024", icon: "ri-rectangle-line" },
  { label: "竖版", value: "2:3", size: "1024x1536", icon: "ri-layout-column-line" },
];

const QUALITY_OPTIONS: { label: string; value: Quality }[] = [
  { label: "低", value: "low" },
  { label: "中", value: "medium" },
  { label: "高", value: "high" },
];

const PROMPT_SUGGESTIONS = [
  "赛博朋克城市夜景，霓虹灯倒映在湿润的街道上",
  "极简主义建筑摄影，清晨柔和光线，大面积留白",
  "水墨风格的山水画，云雾缭绕，意境深远",
  "未来主义产品渲染，银色金属质感，黑色背景",
];

export default function HomePage() {
  const [prompt, setPrompt] = useState("");
  const [aspect, setAspect] = useState<AspectRatio>("auto");
  // 记录生成时实际使用的尺寸，用于展示标注
  const [generatedSize, setGeneratedSize] = useState<string | null>(null);
  const [quality, setQuality] = useState<Quality>("high");
  const [loading, setLoading] = useState(false);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [imageB64, setImageB64] = useState<string | null>(null);
  const [mediaType, setMediaType] = useState<string>("image/png");
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startRef = useRef<number>(0);

  const selectedAspect = ASPECT_OPTIONS.find((o) => o.value === aspect)!;

  const handleGenerate = useCallback(async () => {
    if (!prompt.trim() || loading) return;

    setLoading(true);
    setError(null);
    setImageUrl(null);
    setImageB64(null);
    setElapsed(null);
    setGeneratedSize(null);

    startRef.current = Date.now();
    timerRef.current = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startRef.current) / 1000));
    }, 1000);

    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, size: selectedAspect.size, quality }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error ?? "生成失败，请重试");
      }

      if (data.b64) {
        setImageB64(data.b64);
        setMediaType(data.mediaType ?? "image/png");
        setGeneratedSize(selectedAspect.size);
      } else if (data.url) {
        setImageUrl(data.url);
        setGeneratedSize(selectedAspect.size);
      } else {
        throw new Error("未收到图片数据");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "未知错误");
    } finally {
      setLoading(false);
      if (timerRef.current) clearInterval(timerRef.current);
    }
  }, [prompt, loading, selectedAspect.size, quality]);

  // 使用 Canvas 转 JPEG 下载，确保 macOS 缩略图正常显示
  const handleDownload = useCallback(() => {
    const img = new Image();
    const src = imageB64
      ? `data:${mediaType};base64,${imageB64}`
      : imageUrl!;

    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(img, 0, 0);
      canvas.toBlob(
        (blob) => {
          if (!blob) return;
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = `imagegen-${Date.now()}.jpg`;
          a.click();
          URL.revokeObjectURL(url);
        },
        "image/jpeg",
        0.95
      );
    };

    img.crossOrigin = "anonymous";
    img.src = src;
  }, [imageB64, imageUrl, mediaType]);

  const displaySrc = imageB64
    ? `data:${mediaType};base64,${imageB64}`
    : imageUrl;

  return (
    <div className="min-h-full flex flex-col" style={{ background: "var(--bg)" }}>
      {/* Header */}
      <header
        className="flex items-center justify-between px-6 py-4 border-b"
        style={{ borderColor: "var(--border)" }}
      >
        <div className="flex items-center gap-2">
          <span className="text-lg font-medium tracking-tight" style={{ color: "var(--text-primary)", fontFamily: "var(--font-space)" }}>
            ImageGen
          </span>
          <span
            className="text-xs px-2 py-0.5 rounded-full border"
            style={{
              color: "var(--accent)",
              borderColor: "var(--accent-dim)",
              background: "var(--accent-dim)",
              fontFamily: "var(--font-space)",
            }}
          >
            GPT-Image-2
          </span>
        </div>
        <span className="text-xs tracking-widest uppercase" style={{ color: "var(--text-muted)", fontFamily: "var(--font-space)" }}>
          QY.Studio
        </span>
      </header>

      <main className="flex flex-1 overflow-hidden">
        {/* 左栏：控制面板 */}
        <aside
          className="w-80 flex-shrink-0 flex flex-col border-r overflow-y-auto"
          style={{ borderColor: "var(--border)", background: "var(--surface)" }}
        >
          <div className="flex-1 p-6 flex flex-col gap-6">
            {/* 提示词 */}
            <div className="flex flex-col gap-2">
              <label className="text-xs font-medium tracking-wider uppercase" style={{ color: "var(--text-secondary)" }}>
                提示词
              </label>
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                onKeyDown={(e) => {
                  if ((e.metaKey || e.ctrlKey) && e.key === "Enter") handleGenerate();
                }}
                placeholder="描述你想生成的图像..."
                rows={5}
                className="w-full resize-none rounded-lg px-3 py-3 text-sm outline-none transition-all"
                style={{
                  background: "var(--surface-2)",
                  border: "1px solid var(--border)",
                  color: "var(--text-primary)",
                  fontFamily: "var(--font-ibm), system-ui",
                }}
                onFocus={(e) => (e.target.style.borderColor = "var(--border-focus)")}
                onBlur={(e) => (e.target.style.borderColor = "var(--border)")}
              />
              {/* 建议词 */}
              <div className="flex flex-col gap-1">
                {PROMPT_SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    onClick={() => setPrompt(s)}
                    className="text-left text-xs px-2 py-1.5 rounded transition-colors truncate"
                    style={{ color: "var(--text-muted)" }}
                    onMouseEnter={(e) => {
                      (e.target as HTMLElement).style.color = "var(--text-secondary)";
                      (e.target as HTMLElement).style.background = "var(--surface-2)";
                    }}
                    onMouseLeave={(e) => {
                      (e.target as HTMLElement).style.color = "var(--text-muted)";
                      (e.target as HTMLElement).style.background = "transparent";
                    }}
                  >
                    <i className="ri-arrow-right-line mr-1" />
                    {s}
                  </button>
                ))}
              </div>
            </div>

            {/* 宽高比 */}
            <div className="flex flex-col gap-2">
              <label className="text-xs font-medium tracking-wider uppercase" style={{ color: "var(--text-secondary)" }}>
                尺寸
              </label>
              <div className="grid grid-cols-4 gap-2">
                {ASPECT_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => {
                      setAspect(opt.value);
                      // 切换尺寸时清空当前图片，避免误以为是新尺寸
                      setImageUrl(null);
                      setImageB64(null);
                      setGeneratedSize(null);
                      setError(null);
                    }}
                    className="flex flex-col items-center gap-1.5 py-3 rounded-lg border text-xs transition-all"
                    style={{
                      background: aspect === opt.value ? "var(--accent-dim)" : "var(--surface-2)",
                      borderColor: aspect === opt.value ? "var(--accent)" : "var(--border)",
                      color: aspect === opt.value ? "var(--accent)" : "var(--text-secondary)",
                    }}
                  >
                    <i className={`${opt.icon} text-base`} />
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {/* 质量 */}
            <div className="flex flex-col gap-2">
              <label className="text-xs font-medium tracking-wider uppercase" style={{ color: "var(--text-secondary)" }}>
                质量
              </label>
              <div className="flex gap-2">
                {QUALITY_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => setQuality(opt.value)}
                    className="flex-1 py-2 rounded-lg border text-xs transition-all"
                    style={{
                      background: quality === opt.value ? "var(--accent-dim)" : "var(--surface-2)",
                      borderColor: quality === opt.value ? "var(--accent)" : "var(--border)",
                      color: quality === opt.value ? "var(--accent)" : "var(--text-secondary)",
                    }}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* 生成按钮 */}
          <div className="p-6 border-t" style={{ borderColor: "var(--border)" }}>
            <button
              onClick={handleGenerate}
              disabled={!prompt.trim() || loading}
              className="w-full py-3 rounded-lg text-sm font-medium transition-all flex items-center justify-center gap-2"
              style={{
                background: !prompt.trim() || loading ? "var(--surface-2)" : "var(--accent)",
                color: !prompt.trim() || loading ? "var(--text-muted)" : "#000",
                cursor: !prompt.trim() || loading ? "not-allowed" : "pointer",
              }}
            >
              {loading ? (
                <>
                  <i className="ri-loader-4-line animate-spin" />
                  生成中{elapsed !== null ? `（${elapsed}s）` : ""}
                </>
              ) : (
                <>
                  <i className="ri-sparkling-line" />
                  生成图像
                  <span className="text-xs opacity-50 ml-1">⌘↵</span>
                </>
              )}
            </button>
          </div>
        </aside>

        {/* 右栏：预览区 */}
        <section className="flex-1 flex items-center justify-center p-8 overflow-auto">
          {loading && (
            <div className="flex flex-col items-center gap-4">
              <div
                className="w-12 h-12 rounded-full border-2 animate-spin"
                style={{ borderColor: "var(--border)", borderTopColor: "var(--accent)" }}
              />
              <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
                正在生成{elapsed !== null ? ` · ${elapsed}s` : ""}
              </p>
            </div>
          )}

          {error && !loading && (
            <div
              className="flex flex-col items-center gap-3 max-w-sm text-center p-6 rounded-xl border"
              style={{ background: "var(--surface)", borderColor: "rgba(255,80,80,0.15)" }}
            >
              <i className="ri-error-warning-line text-2xl" style={{ color: "#ff6060" }} />
              <p className="text-sm leading-relaxed" style={{ color: "var(--text-secondary)" }}>{error}</p>
              {error.includes("child") || error.includes("轮询") || error.includes("busy") ? (
                <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                  服务器正忙，稍后重试通常可以成功
                </p>
              ) : null}
              <button
                onClick={handleGenerate}
                className="text-xs px-4 py-2 rounded-lg border transition-all"
                style={{ borderColor: "var(--border)", color: "var(--text-secondary)" }}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLElement).style.borderColor = "var(--border-focus)";
                  (e.currentTarget as HTMLElement).style.color = "var(--text-primary)";
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLElement).style.borderColor = "var(--border)";
                  (e.currentTarget as HTMLElement).style.color = "var(--text-secondary)";
                }}
              >
                重试
              </button>
            </div>
          )}

          {displaySrc && !loading && (
            <div className="flex flex-col items-center gap-4 w-full max-w-2xl">
              {/* 图片按生成时的原生尺寸展示，不裁切 */}
              <div
                className="rounded-xl overflow-hidden border"
                style={{ borderColor: "var(--border)", maxWidth: "100%", maxHeight: "70vh" }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={displaySrc}
                  alt={prompt}
                  style={{ display: "block", maxWidth: "100%", maxHeight: "70vh", objectFit: "contain" }}
                />
              </div>
              {generatedSize && (
                <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                  {generatedSize.replace("x", " × ")} px
                </p>
              )}
              <div className="flex items-center gap-3">
                <button
                  onClick={handleDownload}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg border text-sm transition-all"
                  style={{ borderColor: "var(--border)", color: "var(--text-secondary)" }}
                  onMouseEnter={(e) => {
                    (e.currentTarget as HTMLElement).style.borderColor = "var(--border-focus)";
                    (e.currentTarget as HTMLElement).style.color = "var(--text-primary)";
                  }}
                  onMouseLeave={(e) => {
                    (e.currentTarget as HTMLElement).style.borderColor = "var(--border)";
                    (e.currentTarget as HTMLElement).style.color = "var(--text-secondary)";
                  }}
                >
                  <i className="ri-download-2-line" />
                  下载 JPEG
                </button>
                <button
                  onClick={handleGenerate}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg border text-sm transition-all"
                  style={{ borderColor: "var(--border)", color: "var(--text-secondary)" }}
                  onMouseEnter={(e) => {
                    (e.currentTarget as HTMLElement).style.borderColor = "var(--border-focus)";
                    (e.currentTarget as HTMLElement).style.color = "var(--text-primary)";
                  }}
                  onMouseLeave={(e) => {
                    (e.currentTarget as HTMLElement).style.borderColor = "var(--border)";
                    (e.currentTarget as HTMLElement).style.color = "var(--text-secondary)";
                  }}
                >
                  <i className="ri-refresh-line" />
                  重新生成
                </button>
              </div>
            </div>
          )}

          {!displaySrc && !loading && !error && (
            <div className="flex flex-col items-center gap-3 select-none">
              <div
                className="w-16 h-16 rounded-2xl flex items-center justify-center"
                style={{ background: "var(--surface-2)" }}
              >
                <i className="ri-image-ai-line text-2xl" style={{ color: "var(--text-muted)" }} />
              </div>
              <p className="text-sm" style={{ color: "var(--text-muted)" }}>
                在左侧输入提示词，开始生成
              </p>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
