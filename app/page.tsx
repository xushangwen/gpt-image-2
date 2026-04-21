"use client";

import { useState, useRef, useCallback, useEffect } from "react";

type AspectRatio = "auto" | "1:1" | "3:2" | "2:3";
type Quality = "low" | "medium" | "high";
type ImageResult = { b64?: string; url?: string; mediaType: string };

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

const COUNT_OPTIONS = [1, 2, 4];

function imageSrc(img: ImageResult) {
  return img.b64 ? `data:${img.mediaType};base64,${img.b64}` : img.url!;
}

function downloadImage(img: ImageResult, index: number) {
  const src = imageSrc(img);
  const el = new Image();
  el.onload = () => {
    const canvas = document.createElement("canvas");
    canvas.width = el.naturalWidth;
    canvas.height = el.naturalHeight;
    canvas.getContext("2d")!.drawImage(el, 0, 0);
    canvas.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `imagegen-${Date.now()}-${index + 1}.jpg`;
      a.click();
      URL.revokeObjectURL(url);
    }, "image/jpeg", 0.95);
  };
  el.crossOrigin = "anonymous";
  el.src = src;
}

export default function HomePage() {
  const [prompt, setPrompt] = useState("");
  const [aspect, setAspect] = useState<AspectRatio>("auto");
  const [quality, setQuality] = useState<Quality>("high");
  const [count, setCount] = useState(1);
  const [dark, setDark] = useState(true);
  const [loading, setLoading] = useState(false);
  const [images, setImages] = useState<ImageResult[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // 同步主题到 html 标签
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", dark ? "dark" : "light");
  }, [dark]);

  const selectedAspect = ASPECT_OPTIONS.find((o) => o.value === aspect)!;

  const handleGenerate = useCallback(async () => {
    if (!prompt.trim() || loading) return;

    setLoading(true);
    setError(null);
    setImages([]);
    setElapsed(0);

    const start = Date.now();
    timerRef.current = setInterval(() => {
      setElapsed(Math.floor((Date.now() - start) / 1000));
    }, 1000);

    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, size: selectedAspect.size, quality, n: count }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "生成失败，请重试");
      if (!data.images?.length) throw new Error("未收到图片数据");
      setImages(data.images);
    } catch (err) {
      setError(err instanceof Error ? err.message : "未知错误");
    } finally {
      setLoading(false);
      if (timerRef.current) clearInterval(timerRef.current);
    }
  }, [prompt, loading, selectedAspect.size, quality, count]);

  const clearImages = () => { setImages([]); setError(null); };

  const btnBase: React.CSSProperties = { borderColor: "var(--border)", color: "var(--text-secondary)" };
  const btnHover = (e: React.MouseEvent<HTMLButtonElement>) => {
    (e.currentTarget as HTMLElement).style.borderColor = "var(--border-focus)";
    (e.currentTarget as HTMLElement).style.color = "var(--text-primary)";
  };
  const btnLeave = (e: React.MouseEvent<HTMLButtonElement>) => {
    (e.currentTarget as HTMLElement).style.borderColor = "var(--border)";
    (e.currentTarget as HTMLElement).style.color = "var(--text-secondary)";
  };

  return (
    <div className="min-h-full flex flex-col" style={{ background: "var(--bg)" }}>
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-4 border-b" style={{ borderColor: "var(--border)" }}>
        {/* 左：logo + 名称 */}
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0"
            style={{ background: "var(--accent)" }}>
            <i className="ri-image-ai-line text-sm text-white" />
          </div>
          <span className="text-base font-semibold tracking-tight" style={{ color: "var(--text-primary)", fontFamily: "var(--font-space)" }}>
            ImageGen
          </span>
          <span className="text-xs px-2 py-0.5 rounded-full border" style={{
            color: "var(--accent)", borderColor: "var(--accent-dim)", background: "var(--accent-dim)", fontFamily: "var(--font-space)",
          }}>
            GPT-Image-2
          </span>
        </div>

        {/* 右：署名 + 主题切换 */}
        <div className="flex items-center gap-4">
          <span className="text-xs tracking-widest uppercase" style={{ color: "var(--text-muted)", fontFamily: "var(--font-space)" }}>
            QY.Studio
          </span>
          <button
            onClick={() => setDark((d) => !d)}
            className="w-8 h-8 rounded-lg border flex items-center justify-center transition-all"
            style={btnBase}
            onMouseEnter={btnHover}
            onMouseLeave={btnLeave}
            title={dark ? "切换亮色" : "切换暗色"}
          >
            <i className={dark ? "ri-sun-line text-sm" : "ri-moon-line text-sm"} />
          </button>
        </div>
      </header>

      <main className="flex flex-1 overflow-hidden">
        {/* 左栏：控制面板 */}
        <aside className="w-72 flex-shrink-0 flex flex-col border-r overflow-y-auto"
          style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
          <div className="flex-1 p-5 flex flex-col gap-5">

            {/* 提示词 */}
            <div className="flex flex-col gap-2">
              <label className="text-xs font-medium tracking-wider uppercase" style={{ color: "var(--text-secondary)" }}>
                提示词
              </label>
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") handleGenerate(); }}
                placeholder="描述你想生成的图像..."
                rows={6}
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
            </div>

            {/* 尺寸 */}
            <div className="flex flex-col gap-2">
              <label className="text-xs font-medium tracking-wider uppercase" style={{ color: "var(--text-secondary)" }}>
                尺寸
              </label>
              <div className="grid grid-cols-4 gap-1.5">
                {ASPECT_OPTIONS.map((opt) => (
                  <button key={opt.value}
                    onClick={() => { setAspect(opt.value); clearImages(); }}
                    className="flex flex-col items-center gap-1.5 py-2.5 rounded-lg border text-xs transition-all"
                    style={{
                      background: aspect === opt.value ? "var(--accent-dim)" : "var(--surface-2)",
                      borderColor: aspect === opt.value ? "var(--accent)" : "var(--border)",
                      color: aspect === opt.value ? "var(--accent)" : "var(--text-secondary)",
                    }}>
                    <i className={`${opt.icon} text-sm`} />
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
              <div className="flex gap-1.5">
                {QUALITY_OPTIONS.map((opt) => (
                  <button key={opt.value}
                    onClick={() => setQuality(opt.value)}
                    className="flex-1 py-2 rounded-lg border text-xs transition-all"
                    style={{
                      background: quality === opt.value ? "var(--accent-dim)" : "var(--surface-2)",
                      borderColor: quality === opt.value ? "var(--accent)" : "var(--border)",
                      color: quality === opt.value ? "var(--accent)" : "var(--text-secondary)",
                    }}>
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {/* 张数 */}
            <div className="flex flex-col gap-2">
              <label className="text-xs font-medium tracking-wider uppercase" style={{ color: "var(--text-secondary)" }}>
                张数
              </label>
              <div className="flex gap-1.5">
                {COUNT_OPTIONS.map((n) => (
                  <button key={n}
                    onClick={() => setCount(n)}
                    className="flex-1 py-2 rounded-lg border text-xs transition-all"
                    style={{
                      background: count === n ? "var(--accent-dim)" : "var(--surface-2)",
                      borderColor: count === n ? "var(--accent)" : "var(--border)",
                      color: count === n ? "var(--accent)" : "var(--text-secondary)",
                    }}>
                    {n} 张
                  </button>
                ))}
              </div>
            </div>

          </div>

          {/* 生成按钮 */}
          <div className="p-5 border-t" style={{ borderColor: "var(--border)" }}>
            <button
              onClick={handleGenerate}
              disabled={!prompt.trim() || loading}
              className="w-full py-3 rounded-lg text-sm font-medium transition-all flex items-center justify-center gap-2"
              style={{
                background: !prompt.trim() || loading ? "var(--surface-2)" : "var(--accent)",
                color: !prompt.trim() || loading ? "var(--text-muted)" : "#fff",
                cursor: !prompt.trim() || loading ? "not-allowed" : "pointer",
              }}>
              {loading ? (
                <>
                  <i className="ri-loader-4-line animate-spin" />
                  生成中{elapsed !== null ? `（${elapsed}s）` : ""}
                </>
              ) : (
                <>
                  <i className="ri-sparkling-line" />
                  生成图像
                  <span className="text-xs opacity-40 ml-1">⌘↵</span>
                </>
              )}
            </button>
          </div>
        </aside>

        {/* 右栏：预览区 */}
        <section className="flex-1 flex flex-col items-center justify-center p-8 overflow-auto gap-6">

          {/* 加载状态 */}
          {loading && (
            <div className="flex flex-col items-center gap-3">
              <div className="w-11 h-11 rounded-full border-2 animate-spin"
                style={{ borderColor: "var(--border)", borderTopColor: "var(--accent)" }} />
              <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
                正在生成{elapsed !== null ? ` · ${elapsed}s` : ""}
              </p>
              {/* 超过 60s 提示 */}
              {elapsed !== null && elapsed >= 60 && (
                <div className="flex items-center gap-2 px-4 py-2 rounded-lg border text-xs"
                  style={{ borderColor: "rgba(255,180,0,0.3)", background: "rgba(255,180,0,0.06)", color: "#ffb400" }}>
                  <i className="ri-time-line" />
                  已超过 60s，生成可能出现问题，完成后可尝试重新生成
                </div>
              )}
            </div>
          )}

          {/* 错误状态 */}
          {error && !loading && (
            <div className="flex flex-col items-center gap-3 max-w-sm text-center p-6 rounded-xl border"
              style={{ background: "var(--surface)", borderColor: "rgba(255,80,80,0.15)" }}>
              <i className="ri-error-warning-line text-2xl" style={{ color: "#ff6060" }} />
              <p className="text-sm leading-relaxed" style={{ color: "var(--text-secondary)" }}>{error}</p>
              <button onClick={handleGenerate}
                className="text-xs px-4 py-2 rounded-lg border transition-all"
                style={btnBase} onMouseEnter={btnHover} onMouseLeave={btnLeave}>
                重试
              </button>
            </div>
          )}

          {/* 图片结果 */}
          {images.length > 0 && !loading && (
            <>
              <div className={`w-full max-w-4xl grid gap-4 ${images.length === 1 ? "grid-cols-1 max-w-2xl" : images.length === 2 ? "grid-cols-2" : "grid-cols-2"}`}>
                {images.map((img, i) => (
                  <div key={i} className="group relative rounded-xl overflow-hidden border"
                    style={{ borderColor: "var(--border)" }}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={imageSrc(img)} alt={`${prompt} ${i + 1}`}
                      style={{ display: "block", width: "100%", height: "auto" }} />
                    {/* hover 下载按钮 */}
                    <button
                      onClick={() => downloadImage(img, i)}
                      className="absolute bottom-3 right-3 opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium"
                      style={{ background: "rgba(0,0,0,0.6)", color: "#fff", backdropFilter: "blur(6px)" }}>
                      <i className="ri-download-2-line" />
                      下载
                    </button>
                  </div>
                ))}
              </div>

              {/* 操作栏 */}
              <div className="flex items-center gap-3">
                {images.length === 1 && (
                  <button onClick={() => downloadImage(images[0], 0)}
                    className="flex items-center gap-2 px-4 py-2 rounded-lg border text-sm transition-all"
                    style={btnBase} onMouseEnter={btnHover} onMouseLeave={btnLeave}>
                    <i className="ri-download-2-line" />
                    下载 JPEG
                  </button>
                )}
                <button onClick={handleGenerate}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg border text-sm transition-all"
                  style={btnBase} onMouseEnter={btnHover} onMouseLeave={btnLeave}>
                  <i className="ri-refresh-line" />
                  重新生成
                </button>
              </div>
            </>
          )}

          {/* 空状态 */}
          {images.length === 0 && !loading && !error && (
            <div className="flex flex-col items-center gap-3 select-none">
              <div className="w-16 h-16 rounded-2xl flex items-center justify-center"
                style={{ background: "var(--surface-2)" }}>
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
