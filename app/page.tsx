"use client";

import { useState, useRef, useCallback, useEffect } from "react";

/* ── Types ── */
type AspectRatio = "auto" | "1:1" | "3:2" | "2:3";
type Quality = "low" | "medium" | "high";
type ImageResult = { b64?: string; url?: string; mediaType: string };
type ReferenceImage = {
  name: string;
  dataUrl: string;
  thumbnail: string;
  mediaType: string;
  size: number;
};
type HistoryEntry = {
  id: string;
  prompt: string;
  aspect: AspectRatio;
  quality: Quality;
  count: number;
  timestamp: number;
  thumbnail: string;
  imageCount: number;
  referenceName?: string;
  versionLabel?: string;
};
type VersionEntry = HistoryEntry & {
  images: ImageResult[];
  referenceThumbnail?: string;
};

/* ── Constants ── */
const ASPECT_OPTIONS: { label: string; value: AspectRatio; size: string; icon: string; rotate?: number }[] = [
  { label: "自动", value: "auto",  size: "auto",      icon: "ri-aspect-ratio-line" },
  { label: "方形", value: "1:1",   size: "1024x1024", icon: "ri-square-line" },
  { label: "横版", value: "3:2",   size: "1536x1024", icon: "ri-rectangle-line" },
  { label: "竖版", value: "2:3",   size: "1024x1536", icon: "ri-rectangle-line", rotate: 90 },
];

const QUALITY_OPTIONS: { label: string; value: Quality; icon: string }[] = [
  { label: "低", value: "low",    icon: "ri-signal-wifi-1-fill" },
  { label: "中", value: "medium", icon: "ri-signal-wifi-2-fill" },
  { label: "高", value: "high",   icon: "ri-signal-wifi-3-fill" },
];

const COUNT_OPTIONS: { n: number; icon: string }[] = [
  { n: 1, icon: "ri-image-line" },
  { n: 2, icon: "ri-gallery-line" },
  { n: 4, icon: "ri-layout-grid-line" },
];

const CARD_ASPECT: Record<AspectRatio, string> = {
  auto: "1 / 1",
  "1:1": "1 / 1",
  "3:2": "3 / 2",
  "2:3": "2 / 3",
};

const LS_HISTORY = "imagegen_history_v2";
const LS_PROMPTS = "imagegen_prompts_v2";
const MAX_HISTORY = 20;
const MAX_PROMPTS = 15;
const MAX_REFERENCE_SIZE = 6 * 1024 * 1024;

/* ── Utils ── */
function imageSrc(img: ImageResult) {
  return img.b64 ? `data:${img.mediaType};base64,${img.b64}` : img.url!;
}

function downloadImage(img: ImageResult, index: number) {
  if (!img.b64 && img.url) {
    const a = document.createElement("a");
    a.href = img.url;
    a.download = `imagegen-${Date.now()}-${index + 1}`;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.click();
    return;
  }

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
  el.src = imageSrc(img);
}

function createThumbnail(src: string, maxW = 200): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      try {
        const ratio = img.naturalHeight / img.naturalWidth;
        const w = Math.min(maxW, img.naturalWidth);
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = Math.round(w * ratio);
        canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/jpeg", 0.5));
      } catch {
        resolve("");
      }
    };
    img.onerror = () => resolve("");
    img.crossOrigin = "anonymous";
    img.src = src;
  });
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("参考图读取失败"));
    reader.readAsDataURL(file);
  });
}

function formatFileSize(size: number) {
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function dataUrlToBase64(dataUrl: string) {
  return dataUrl.includes(",") ? dataUrl.split(",")[1] : dataUrl;
}

function buildEnhancedPrompt(prompt: string, referenceImage: ReferenceImage | null, aspect: AspectRatio, quality: Quality) {
  const trimmed = prompt.trim();
  const aspectHint: Record<AspectRatio, string> = {
    auto: "构图自然，主体明确，留白克制",
    "1:1": "方形构图，主体居中但不呆板，适合社交媒体封面",
    "3:2": "横版构图，空间层次清晰，适合海报和横幅",
    "2:3": "竖版构图，纵深感明确，适合封面和手机屏幕",
  };
  const qualityHint: Record<Quality, string> = {
    low: "快速概念草图，保留主要视觉方向",
    medium: "完整视觉细节，质感清楚，完成度较高",
    high: "高质量商业视觉，细节丰富，光影干净，质感精致",
  };
  const referenceHint = referenceImage
    ? `参考上传图片「${referenceImage.name}」的视觉方向，延续其主体关系、色彩气质、构图节奏和材质感觉`
    : "画面风格统一，色彩克制，主体与背景关系清楚";

  return [
    trimmed,
    referenceHint,
    aspectHint[aspect],
    qualityHint[quality],
    "避免杂乱元素，避免多余文字，画面干净，边缘细节自然",
  ].filter(Boolean).join("，");
}

function loadHistory(): HistoryEntry[] {
  try { return JSON.parse(localStorage.getItem(LS_HISTORY) ?? "[]"); } catch { return []; }
}
function saveHistory(entries: HistoryEntry[]) {
  try { localStorage.setItem(LS_HISTORY, JSON.stringify(entries.slice(0, MAX_HISTORY))); } catch { /* quota */ }
}
function loadPrompts(): string[] {
  try { return JSON.parse(localStorage.getItem(LS_PROMPTS) ?? "[]"); } catch { return []; }
}
function savePrompts(prompts: string[]) {
  try { localStorage.setItem(LS_PROMPTS, JSON.stringify(prompts.slice(0, MAX_PROMPTS))); } catch { /* quota */ }
}

function formatTime(ts: number): string {
  const diff = (Date.now() - ts) / 1000;
  if (diff < 60) return "刚刚";
  if (diff < 3600) return `${Math.floor(diff / 60)}分钟前`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}小时前`;
  return `${Math.floor(diff / 86400)}天前`;
}

/* ── Shared button styles ── */
const overlayBtnStyle: React.CSSProperties = {
  padding: "5px 9px",
  borderRadius: 7,
  border: "none",
  background: "rgba(0,0,0,0.52)",
  color: "#fff",
  cursor: "pointer",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  backdropFilter: "blur(8px)",
  gap: 5,
  fontSize: 12,
};

const actionBtnStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 7,
  padding: "8px 16px",
  borderRadius: 9,
  border: "1px solid var(--border)",
  background: "transparent",
  color: "var(--text-secondary)",
  cursor: "pointer",
  fontSize: 13,
  transition: "all 0.15s",
};

const lightboxBtnStyle: React.CSSProperties = {
  width: 40,
  height: 40,
  borderRadius: 10,
  border: "none",
  background: "rgba(255,255,255,0.1)",
  color: "#fff",
  cursor: "pointer",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  backdropFilter: "blur(8px)",
};

const lightboxNavStyle: React.CSSProperties = {
  position: "absolute",
  top: "50%",
  transform: "translateY(-50%)",
  width: 48,
  height: 48,
  borderRadius: 14,
  border: "none",
  background: "rgba(255,255,255,0.08)",
  color: "#fff",
  cursor: "pointer",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  backdropFilter: "blur(8px)",
  zIndex: 10,
  transition: "opacity 0.15s, background 0.15s",
};

/* ── Main Component ── */
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
  const [lightboxIdx, setLightboxIdx] = useState<number | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [versions, setVersions] = useState<VersionEntry[]>([]);
  const [activeVersionId, setActiveVersionId] = useState<string | null>(null);
  const [recentPrompts, setRecentPrompts] = useState<string[]>([]);
  const [showPromptHistory, setShowPromptHistory] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [referenceImage, setReferenceImage] = useState<ReferenceImage | null>(null);
  const [toast, setToast] = useState<{ msg: string; id: number } | null>(null);
  const [copyingIdx, setCopyingIdx] = useState<number | null>(null);

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const generateControllerRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(true);
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const referenceInputRef = useRef<HTMLInputElement>(null);

  /* Load from localStorage */
  useEffect(() => {
    setHistory(loadHistory());
    setRecentPrompts(loadPrompts());
  }, []);

  /* Theme */
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", dark ? "dark" : "light");
  }, [dark]);

  /* Cleanup async UI work on unmount */
  useEffect(() => {
    return () => {
      mountedRef.current = false;
      if (timerRef.current) clearInterval(timerRef.current);
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
      generateControllerRef.current?.abort();
    };
  }, []);

  /* Keyboard: ESC / arrows for lightbox */
  useEffect(() => {
    if (lightboxIdx === null) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setLightboxIdx(null);
      if (e.key === "ArrowLeft") setLightboxIdx(i => i !== null ? Math.max(0, i - 1) : null);
      if (e.key === "ArrowRight") setLightboxIdx(i => i !== null ? Math.min(images.length - 1, i + 1) : null);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [lightboxIdx, images.length]);

  /* Close prompt history on outside click */
  useEffect(() => {
    if (!showPromptHistory) return;
    const handler = (e: MouseEvent) => {
      if (!(e.target as Element).closest(".prompt-area")) setShowPromptHistory(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showPromptHistory]);

  const showToast = useCallback((msg: string) => {
    const id = Date.now();
    setToast({ msg, id });
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToast(null), 2500);
  }, []);

  const selectedAspect = ASPECT_OPTIONS.find(o => o.value === aspect)!;

  const handleReferenceUpload = useCallback(async (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      showToast("请选择图片文件");
      return;
    }
    if (file.size > MAX_REFERENCE_SIZE) {
      showToast("参考图不能超过 6 MB");
      return;
    }

    try {
      const dataUrl = await readFileAsDataUrl(file);
      const thumbnail = await createThumbnail(dataUrl, 320);
      setReferenceImage({
        name: file.name,
        dataUrl,
        thumbnail: thumbnail || dataUrl,
        mediaType: file.type,
        size: file.size,
      });
      showToast("参考图已加入");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "参考图读取失败");
    } finally {
      if (referenceInputRef.current) referenceInputRef.current.value = "";
    }
  }, [showToast]);

  const enhancePrompt = useCallback(() => {
    if (!prompt.trim()) {
      promptRef.current?.focus();
      showToast("先输入一句提示词");
      return;
    }
    setPrompt(buildEnhancedPrompt(prompt, referenceImage, aspect, quality));
    showToast("提示词已增强");
  }, [prompt, referenceImage, aspect, quality, showToast]);

  const handleGenerate = useCallback(async () => {
    if (!prompt.trim() || loading) return;
    generateControllerRef.current?.abort();
    const controller = new AbortController();
    generateControllerRef.current = controller;
    const generationPrompt = referenceImage
      ? (prompt.includes(referenceImage.name) ? prompt : buildEnhancedPrompt(prompt, referenceImage, aspect, quality))
      : prompt;

    setLoading(true);
    setError(null);
    setImages([]);
    setElapsed(0);
    setShowPromptHistory(false);

    const start = Date.now();
    timerRef.current = setInterval(() => setElapsed(Math.floor((Date.now() - start) / 1000)), 1000);

    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: generationPrompt,
          size: selectedAspect.size,
          quality,
          n: count,
          referenceImage: referenceImage
            ? {
                data: dataUrlToBase64(referenceImage.dataUrl),
                mediaType: referenceImage.mediaType,
                name: referenceImage.name,
              }
            : undefined,
        }),
        signal: controller.signal,
      });
      const rawText = await res.text();
      let data: { images?: ImageResult[]; warning?: string; error?: string } | null = null;
      if (rawText) {
        try {
          data = JSON.parse(rawText);
        } catch {
          if (!res.ok) throw new Error("生成服务暂时不可用，请稍后重试");
          throw new Error("生成服务返回了无法解析的数据");
        }
      }
      if (!res.ok) throw new Error(data?.error ?? "生成失败，请重试");
      if (!data?.images?.length) throw new Error("未收到图片数据");
      if (!mountedRef.current) return;

      const newImages: ImageResult[] = data.images;
      setImages(newImages);
      if (data.warning) showToast(data.warning);

      /* Save to history */
      const thumbnail = await createThumbnail(imageSrc(newImages[0]));
      const entry: HistoryEntry = {
        id: String(Date.now()),
        prompt: prompt.trim(),
        aspect,
        quality,
        count,
        timestamp: Date.now(),
        thumbnail,
        imageCount: newImages.length,
        referenceName: referenceImage?.name,
        versionLabel: `V${versions.length + 1}`,
      };
      const versionEntry: VersionEntry = {
        ...entry,
        images: newImages,
        referenceThumbnail: referenceImage?.thumbnail,
      };
      setVersions(prev => [versionEntry, ...prev].slice(0, 12));
      setActiveVersionId(versionEntry.id);
      const newHistory = [entry, ...loadHistory()].slice(0, MAX_HISTORY);
      saveHistory(newHistory);
      setHistory(newHistory);

      /* Save prompt */
      const trimmed = prompt.trim();
      const newPrompts = [trimmed, ...loadPrompts().filter(p => p !== trimmed)].slice(0, MAX_PROMPTS);
      savePrompts(newPrompts);
      setRecentPrompts(newPrompts);

    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") return;
      if (!mountedRef.current) return;
      setError(err instanceof Error ? err.message : "未知错误");
    } finally {
      if (generateControllerRef.current === controller) generateControllerRef.current = null;
      if (mountedRef.current) setLoading(false);
      if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    }
  }, [prompt, loading, selectedAspect.size, quality, count, aspect, referenceImage, versions.length, showToast]);

  const clearImages = () => { setImages([]); setError(null); setActiveVersionId(null); };

  const downloadAll = () => {
    images.forEach((img, i) => setTimeout(() => downloadImage(img, i), i * 400));
    showToast(`正在下载 ${images.length} 张图片`);
  };

  const copyImageToClipboard = useCallback(async (img: ImageResult, idx: number) => {
    setCopyingIdx(idx);
    try {
      if (!img.b64 && img.url) {
        try {
          const response = await fetch(img.url, { mode: "cors" });
          const blob = await response.blob();
          if (!blob.type.startsWith("image/")) throw new Error();
          await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]);
          showToast("已复制到剪贴板");
        } catch {
          await navigator.clipboard.writeText(img.url);
          showToast("已复制图片链接");
        }
        return;
      }

      const image = new Image();
      await new Promise<void>((resolve, reject) => {
        image.onload = () => resolve();
        image.onerror = reject;
        image.src = imageSrc(img);
      });
      const canvas = document.createElement("canvas");
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      canvas.getContext("2d")!.drawImage(image, 0, 0);
      const blob = await new Promise<Blob | null>(r => canvas.toBlob(r, "image/png"));
      if (!blob) throw new Error();
      await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
      showToast("已复制到剪贴板");
    } catch {
      showToast("复制失败，请手动保存图片");
    } finally {
      setCopyingIdx(null);
    }
  }, [showToast]);

  const restoreHistory = (entry: HistoryEntry) => {
    setPrompt(entry.prompt);
    setAspect(entry.aspect);
    setQuality(entry.quality);
    setCount(entry.count);
    clearImages();
    promptRef.current?.focus();
  };

  const restoreVersion = (entry: VersionEntry) => {
    setImages(entry.images);
    setPrompt(entry.prompt);
    setAspect(entry.aspect);
    setQuality(entry.quality);
    setCount(entry.count);
    setActiveVersionId(entry.id);
    setError(null);
  };

  const deleteHistoryEntry = (id: string) => {
    const next = history.filter(h => h.id !== id);
    saveHistory(next);
    setHistory(next);
  };

  const clearAllHistory = () => { saveHistory([]); setHistory([]); };

  /* Segmented control style */
  const segBtn = (active: boolean): React.CSSProperties => ({
    flex: 1,
    padding: "7px 0",
    fontSize: 12,
    fontWeight: active ? 500 : 400,
    border: "none",
    borderLeft: "1px solid var(--border)",
    background: active ? "var(--accent-dim)" : "transparent",
    color: active ? "var(--accent)" : "var(--text-secondary)",
    cursor: "pointer",
    transition: "all 0.15s",
  });

  return (
    <div style={{ height: "100vh", display: "flex", flexDirection: "column", background: "var(--bg)", overflow: "hidden" }}>

      {/* ── Header ── */}
      <header style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "0 20px",
        height: 50,
        borderBottom: "1px solid var(--border)",
        background: "var(--surface)",
        flexShrink: 0,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 28, height: 28, borderRadius: 8, background: "var(--text-primary)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            <i className="ri-image-ai-line" style={{ fontSize: 16, lineHeight: 1, color: "var(--bg)" }} />
          </div>
          <span style={{ fontSize: 14, fontWeight: 600, letterSpacing: "-0.02em", color: "var(--text-primary)", fontFamily: "var(--font-space)" }}>
            ImageGen
          </span>
          <span style={{ fontSize: 11, padding: "2px 7px", borderRadius: 20, border: "1px solid var(--border-focus)", background: "var(--surface-2)", color: "var(--text-secondary)", fontFamily: "var(--font-space)", letterSpacing: "0.01em" }}>
            GPT-Image-2
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <span style={{ fontSize: 11, color: "var(--text-muted)", letterSpacing: "0.1em", textTransform: "uppercase", fontFamily: "var(--font-space)" }}>
            QY.Studio
          </span>
          <button
            className="theme-btn"
            onClick={() => setDark(d => !d)}
            style={{ width: 32, height: 32, borderRadius: 8, border: "1px solid var(--border)", background: "transparent", color: "var(--text-secondary)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", transition: "all 0.15s" }}
            title={dark ? "切换亮色" : "切换暗色"}
          >
            <i className={dark ? "ri-sun-line" : "ri-moon-line"} style={{ fontSize: 16, lineHeight: 1 }} />
          </button>
        </div>
      </header>

      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>

        {/* ── Left Sidebar ── */}
        <aside style={{ width: 280, flexShrink: 0, display: "flex", flexDirection: "column", borderRight: "1px solid var(--border)", background: "var(--surface)", overflow: "hidden" }}>
          <div style={{ flex: 1, overflowY: "auto", padding: "18px 14px", display: "flex", flexDirection: "column", gap: 18 }}>

            {/* Prompt */}
            <div className="prompt-area" style={{ display: "flex", flexDirection: "column", gap: 7 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <SideLabel icon="ri-pencil-line">提示词</SideLabel>
                <span style={{ fontSize: 11, color: "var(--text-muted)", fontFamily: "var(--font-space)" }}>{prompt.length}</span>
              </div>
              <div style={{ position: "relative" }}>
                <textarea
                  ref={promptRef}
                  value={prompt}
                  onChange={e => setPrompt(e.target.value)}
                  onKeyDown={e => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") handleGenerate(); }}
                  onFocus={e => {
                    e.target.style.borderColor = "var(--border-focus)";
                    if (recentPrompts.length > 0) setShowPromptHistory(true);
                  }}
                  onBlur={e => e.target.style.borderColor = "var(--border)"}
                  placeholder="描述你想生成的图像..."
                  rows={6}
                  style={{ width: "100%", resize: "none", borderRadius: 10, padding: "10px 12px", fontSize: 13, lineHeight: 1.65, outline: "none", background: "var(--surface-2)", border: "1px solid var(--border)", color: "var(--text-primary)", fontFamily: "var(--font-ibm), system-ui", transition: "border-color 0.15s" }}
                />

                {/* Prompt history dropdown */}
                {showPromptHistory && recentPrompts.length > 0 && (
                  <div style={{ marginTop: 6, borderRadius: 10, border: "1px solid var(--border-focus)", background: "var(--surface)", boxShadow: "0 8px 22px rgba(0,0,0,0.18)", overflow: "hidden", maxHeight: 154, overflowY: "auto" }}>
                    <div style={{ padding: "8px 12px 5px", display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: "1px solid var(--border)" }}>
                      <span style={{ fontSize: 11, color: "var(--text-muted)", display: "flex", alignItems: "center", gap: 5 }}>
                        <i className="ri-time-line" style={{ fontSize: 14, lineHeight: 1 }} /> 最近使用
                      </span>
                      <button
                        onMouseDown={e => { e.preventDefault(); savePrompts([]); setRecentPrompts([]); setShowPromptHistory(false); }}
                        style={{ fontSize: 11, color: "var(--text-muted)", background: "none", border: "none", cursor: "pointer" }}
                      >
                        清空
                      </button>
                    </div>
                    {recentPrompts.slice(0, 3).map((p, i) => (
                      <button
                        key={i}
                        onMouseDown={e => { e.preventDefault(); setPrompt(p); setShowPromptHistory(false); promptRef.current?.focus(); }}
                        style={{ width: "100%", padding: "8px 12px", textAlign: "left", fontSize: 12, color: "var(--text-secondary)", background: "transparent", border: "none", cursor: "pointer", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", display: "block", transition: "background 0.1s" }}
                        onMouseEnter={e => (e.currentTarget.style.background = "var(--surface-2)")}
                        onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
                      >
                        {p}
                      </button>
                    ))}
                    {recentPrompts.length > 3 && (
                      <div style={{ padding: "5px 12px 7px", borderTop: "1px solid var(--border)", fontSize: 11, color: "var(--text-muted)", textAlign: "center" }}>
                        还有 {recentPrompts.length - 3} 条最近提示词
                      </div>
                    )}
                  </div>
                )}
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, position: "relative", zIndex: 25 }}>
                <button
                  type="button"
                  onClick={() => {
                    setShowPromptHistory(false);
                    enhancePrompt();
                  }}
                  className="action-btn"
                  style={{ ...actionBtnStyle, justifyContent: "center", padding: "7px 10px", fontSize: 12, borderRadius: 8 }}
                >
                  <i className="ri-magic-line" style={{ fontSize: 14, lineHeight: 1 }} /> 增强
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowPromptHistory(false);
                    referenceInputRef.current?.click();
                  }}
                  className="action-btn"
                  style={{ ...actionBtnStyle, justifyContent: "center", padding: "7px 10px", fontSize: 12, borderRadius: 8 }}
                >
                  <i className="ri-image-add-line" style={{ fontSize: 14, lineHeight: 1 }} /> 参考图
                </button>
                <input
                  ref={referenceInputRef}
                  type="file"
                  accept="image/*"
                  onChange={e => handleReferenceUpload(e.target.files?.[0])}
                  style={{ display: "none" }}
                />
              </div>
            </div>

            {/* Reference image */}
            {referenceImage && (
              <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
                <SideLabel icon="ri-image-circle-line">创作参考</SideLabel>
                <div style={{ display: "flex", gap: 9, padding: 8, borderRadius: 10, border: "1px solid var(--border)", background: "var(--surface-2)" }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={referenceImage.thumbnail} alt="" style={{ width: 52, height: 52, objectFit: "cover", borderRadius: 7, flexShrink: 0, border: "1px solid var(--border)" }} />
                  <div style={{ minWidth: 0, flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", gap: 3 }}>
                    <p style={{ fontSize: 12, color: "var(--text-primary)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{referenceImage.name}</p>
                    <p style={{ fontSize: 11, color: "var(--text-muted)", fontFamily: "var(--font-space)" }}>{formatFileSize(referenceImage.size)}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setReferenceImage(null)}
                    title="移除参考图"
                    style={{ alignSelf: "center", width: 26, height: 26, borderRadius: 7, border: "1px solid var(--border)", background: "transparent", color: "var(--text-muted)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}
                  >
                    <i className="ri-close-line" style={{ fontSize: 15, lineHeight: 1 }} />
                  </button>
                </div>
              </div>
            )}

            {/* Aspect Ratio */}
            <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
              <SideLabel icon="ri-aspect-ratio-line">画面比例</SideLabel>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 5 }}>
                {ASPECT_OPTIONS.map(opt => {
                  const active = aspect === opt.value;
                  return (
                    <button
                      key={opt.value}
                      onClick={() => { setAspect(opt.value); clearImages(); }}
                      style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 6, padding: "10px 4px", borderRadius: 8, border: "1px solid", borderColor: active ? "var(--accent)" : "var(--border)", background: active ? "var(--accent-dim)" : "transparent", color: active ? "var(--accent)" : "var(--text-muted)", cursor: "pointer", transition: "all 0.15s", fontSize: 11 }}
                    >
                      <i className={opt.icon} style={{ fontSize: 17, lineHeight: 1, transform: opt.rotate ? `rotate(${opt.rotate}deg)` : undefined, display: "inline-block" }} />
                      {opt.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Quality */}
            <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
              <SideLabel icon="ri-hd-line">画质</SideLabel>
              <div style={{ display: "flex", borderRadius: 8, overflow: "hidden", border: "1px solid var(--border)" }}>
                {QUALITY_OPTIONS.map((opt, i) => (
                  <button key={opt.value} onClick={() => setQuality(opt.value)} style={{ ...segBtn(quality === opt.value), borderLeft: i === 0 ? "none" : "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "center", gap: 4 }}>
                    <i className={opt.icon} style={{ fontSize: 14, lineHeight: 1 }} />{opt.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Count */}
            <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
              <SideLabel icon="ri-apps-line">生成数量</SideLabel>
              <div style={{ display: "flex", borderRadius: 8, overflow: "hidden", border: "1px solid var(--border)" }}>
                {COUNT_OPTIONS.map((opt, i) => (
                  <button key={opt.n} onClick={() => setCount(opt.n)} style={{ ...segBtn(count === opt.n), borderLeft: i === 0 ? "none" : "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "center", gap: 4 }}>
                    <i className={opt.icon} style={{ fontSize: 14, lineHeight: 1 }} />{opt.n}
                  </button>
                ))}
              </div>
            </div>

            {/* History */}
            {history.length > 0 && (
              <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
                <button
                  onClick={() => setShowHistory(h => !h)}
                  style={{ display: "flex", alignItems: "center", justifyContent: "space-between", background: "none", border: "none", cursor: "pointer", padding: 0 }}
                >
                  <span style={{ fontSize: 11, fontWeight: 500, color: "var(--text-muted)", letterSpacing: "0.07em", textTransform: "uppercase", display: "flex", alignItems: "center", gap: 5 }}>
                    <i className="ri-history-line" style={{ fontSize: 14, lineHeight: 1 }} /> 历史 ({history.length})
                  </span>
                  <i className={showHistory ? "ri-arrow-up-s-line" : "ri-arrow-down-s-line"} style={{ fontSize: 16, lineHeight: 1, color: "var(--text-muted)" }} />
                </button>

                {showHistory && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    {history.slice(0, 10).map(entry => (
                      <div
                        key={entry.id}
                        className="history-item"
                        style={{ display: "flex", alignItems: "center", gap: 9, padding: "7px 9px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--surface-2)", cursor: "pointer", transition: "border-color 0.15s", position: "relative" }}
                        onClick={() => restoreHistory(entry)}
                        onMouseEnter={e => (e.currentTarget.style.borderColor = "var(--border-focus)")}
                        onMouseLeave={e => (e.currentTarget.style.borderColor = "var(--border)")}
                      >
                        {entry.thumbnail && (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={entry.thumbnail} alt="" style={{ width: 34, height: 34, objectFit: "cover", borderRadius: 5, flexShrink: 0 }} />
                        )}
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <p style={{ fontSize: 12, color: "var(--text-primary)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", marginBottom: 2 }}>{entry.prompt}</p>
                          <p style={{ fontSize: 11, color: "var(--text-muted)" }}>
                            {entry.versionLabel ? `${entry.versionLabel} · ` : ""}{formatTime(entry.timestamp)} · {entry.imageCount} 张{entry.referenceName ? " · 参考" : ""}
                          </p>
                        </div>
                        <button
                          className="delete-btn"
                          onClick={e => { e.stopPropagation(); deleteHistoryEntry(entry.id); }}
                          style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", padding: 3, flexShrink: 0 }}
                        >
                          <i className="ri-close-line" style={{ fontSize: 16, lineHeight: 1 }} />
                        </button>
                      </div>
                    ))}
                    {history.length > 10 && (
                      <p style={{ fontSize: 11, color: "var(--text-muted)", textAlign: "center", padding: "2px 0" }}>
                        +{history.length - 10} 条更多
                      </p>
                    )}
                    <button
                      onClick={clearAllHistory}
                      style={{ fontSize: 11, color: "var(--text-muted)", background: "none", border: "none", cursor: "pointer", padding: "3px 0", display: "flex", alignItems: "center", justifyContent: "center", gap: 4 }}
                    >
                      <i className="ri-delete-bin-6-line" style={{ fontSize: 14, lineHeight: 1 }} /> 清空历史
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Generate Button */}
          <div style={{ padding: "14px", borderTop: "1px solid var(--border)", flexShrink: 0 }}>
            <button
              onClick={handleGenerate}
              disabled={!prompt.trim() || loading}
              style={{
                width: "100%",
                padding: "11px 0",
                borderRadius: 10,
                fontSize: 14,
                fontWeight: 500,
                border: "none",
                cursor: !prompt.trim() || loading ? "not-allowed" : "pointer",
                background: !prompt.trim() || loading ? "var(--surface-2)" : "var(--accent)",
                color: !prompt.trim() || loading ? "var(--text-muted)" : "var(--btn-text)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 8,
                transition: "all 0.15s",
                boxShadow: !prompt.trim() || loading ? "none" : "0 4px 20px var(--accent-glow)",
              }}
            >
              {loading ? (
                <>
                  <i className="ri-loader-4-line" style={{ fontSize: 16, lineHeight: 1, animation: "spin 1s linear infinite", display: "inline-block" }} />
                  生成中{elapsed !== null ? ` · ${elapsed}s` : ""}
                </>
              ) : (
                <>
                  <i className="ri-image-ai-line" style={{ fontSize: 16, lineHeight: 1 }} />
                  生成图像
                  <span
                    aria-label="Command + Enter"
                    style={{
                      opacity: 0.48,
                      marginLeft: 2,
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 1,
                    }}
                  >
                    <i className="ri-command-line" style={{ fontSize: 12, lineHeight: 1 }} />
                    <i className="ri-corner-down-left-line" style={{ fontSize: 13, lineHeight: 1 }} />
                  </span>
                </>
              )}
            </button>
          </div>
        </aside>

        {/* ── Main Preview Area ── */}
        <main style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 32, overflow: "auto", gap: 22 }}>

          {/* Loading skeleton */}
          {loading && (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 20, width: "100%" }}>
              <div style={{ display: "grid", gridTemplateColumns: count > 1 ? "repeat(2, 1fr)" : "1fr", gap: 14, width: "100%", maxWidth: count > 1 ? 620 : 400 }}>
                {Array.from({ length: count }).map((_, i) => (
                  <GeneratingPreviewCard
                    key={i}
                    aspect={aspect}
                    index={i}
                    elapsed={elapsed}
                    dark={dark}
                  />
                ))}
              </div>
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
                <p style={{ fontSize: 13, color: "var(--text-secondary)" }}>正在生成{elapsed !== null ? ` · ${elapsed}s` : ""}</p>
                {elapsed !== null && elapsed >= 60 && (
                  <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 14px", borderRadius: 8, border: "1px solid rgba(255,180,0,0.22)", background: "rgba(255,180,0,0.05)", fontSize: 12, color: "#ffb400" }}>
                    <i className="ri-alert-line" style={{ fontSize: 14, lineHeight: 1 }} /> 超过 60s，完成后可尝试重新生成
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Error */}
          {error && !loading && (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12, padding: "28px 32px", borderRadius: 16, border: "1px solid var(--border-focus)", background: "var(--surface)", maxWidth: 360, textAlign: "center" }}>
              <i className="ri-error-warning-line" style={{ fontSize: 22, lineHeight: 1, color: "var(--text-secondary)" }} />
              <p style={{ fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.65 }}>{error}</p>
              <button
                className="action-btn"
                onClick={handleGenerate}
                style={{ ...actionBtnStyle, fontSize: 12, padding: "6px 16px" }}
              >
                <i className="ri-refresh-line" style={{ fontSize: 14, lineHeight: 1 }} /> 重试
              </button>
            </div>
          )}

          {/* Results */}
          {images.length > 0 && !loading && (
            <>
              <div
                style={{ display: "grid", gridTemplateColumns: images.length > 1 ? "repeat(2, 1fr)" : "1fr", gap: 14, width: "100%", maxWidth: images.length > 1 ? 620 : 400 }}
              >
                {images.map((img, i) => (
                  <div
                    key={i}
                    className="img-card"
                    style={{ position: "relative", borderRadius: 14, overflow: "hidden", border: "1px solid var(--border)", background: "var(--surface-2)", aspectRatio: CARD_ASPECT[aspect], cursor: "zoom-in", animation: `fadeUp 0.3s ease ${i * 0.06}s both` }}
                    onClick={() => setLightboxIdx(i)}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={imageSrc(img)} alt={`${prompt} ${i + 1}`} style={{ width: "100%", height: "100%", objectFit: "contain", display: "block" }} />
                    <div
                      className="img-overlay"
                      style={{ position: "absolute", inset: 0, display: "flex", alignItems: "flex-end", justifyContent: "flex-end", gap: 5, padding: 10, background: "linear-gradient(to top, rgba(0,0,0,0.55) 0%, transparent 50%)" }}
                    >
                      <button onClick={e => { e.stopPropagation(); copyImageToClipboard(img, i); }} style={overlayBtnStyle} title="复制">
                        {copyingIdx === i
                          ? <i className="ri-loader-4-line" style={{ fontSize: 14, lineHeight: 1, animation: "spin 1s linear infinite", display: "inline-block" }} />
                          : <i className="ri-file-copy-line" style={{ fontSize: 14, lineHeight: 1 }} />
                        }
                      </button>
                      <button onClick={e => { e.stopPropagation(); downloadImage(img, i); }} style={overlayBtnStyle} title="下载">
                        <i className="ri-download-2-line" style={{ fontSize: 14, lineHeight: 1 }} />
                      </button>
                      <button onClick={e => { e.stopPropagation(); setLightboxIdx(i); }} style={overlayBtnStyle} title="放大">
                        <i className="ri-zoom-in-line" style={{ fontSize: 14, lineHeight: 1 }} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              {/* Action bar */}
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                {images.length > 1 && (
                  <button className="action-btn" onClick={downloadAll} style={actionBtnStyle}>
                    <i className="ri-download-2-line" style={{ fontSize: 14, lineHeight: 1 }} /> 下载全部
                  </button>
                )}
                {images.length === 1 && (
                  <button className="action-btn" onClick={() => downloadImage(images[0], 0)} style={actionBtnStyle}>
                    <i className="ri-download-2-line" style={{ fontSize: 14, lineHeight: 1 }} /> 下载 JPEG
                  </button>
                )}
                {images.length === 1 && (
                  <button className="action-btn" onClick={() => copyImageToClipboard(images[0], 0)} style={actionBtnStyle}>
                    {copyingIdx === 0
                      ? <i className="ri-loader-4-line" style={{ fontSize: 14, lineHeight: 1, animation: "spin 1s linear infinite", display: "inline-block" }} />
                      : <i className="ri-file-copy-line" style={{ fontSize: 14, lineHeight: 1 }} />
                    }
                    复制图片
                  </button>
                )}
                <button className="action-btn" onClick={handleGenerate} style={actionBtnStyle}>
                  <i className="ri-refresh-line" style={{ fontSize: 14, lineHeight: 1 }} /> 重新生成
                </button>
              </div>

              {versions.length > 0 && (
                <section style={{ width: "100%", maxWidth: 620, display: "flex", flexDirection: "column", gap: 8 }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <SideLabel icon="ri-stack-line">版本</SideLabel>
                    <span style={{ fontSize: 11, color: "var(--text-muted)", fontFamily: "var(--font-space)" }}>{versions.length}/12</span>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(128px, 1fr))", gap: 8 }}>
                    {versions.slice(0, 6).map(version => {
                      const active = activeVersionId === version.id;
                      return (
                        <button
                          key={version.id}
                          type="button"
                          onClick={() => restoreVersion(version)}
                          style={{
                            minWidth: 0,
                            display: "flex",
                            alignItems: "center",
                            gap: 8,
                            padding: 7,
                            borderRadius: 10,
                            border: "1px solid",
                            borderColor: active ? "var(--accent)" : "var(--border)",
                            background: active ? "var(--accent-dim)" : "var(--surface-2)",
                            color: active ? "var(--accent)" : "var(--text-secondary)",
                            cursor: "pointer",
                            textAlign: "left",
                          }}
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={version.thumbnail} alt="" style={{ width: 34, height: 34, objectFit: "cover", borderRadius: 6, flexShrink: 0 }} />
                          <span style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
                            <span style={{ fontSize: 12, fontWeight: 500, fontFamily: "var(--font-space)" }}>{version.versionLabel}</span>
                            <span style={{ fontSize: 10, color: "var(--text-muted)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                              {version.imageCount} 张{version.referenceName ? " · 有参考" : ""}
                            </span>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </section>
              )}
            </>
          )}

          {/* Empty state */}
          {images.length === 0 && !loading && !error && (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 16, userSelect: "none", animation: "fadeIn 0.4s ease" }}>
              <div style={{ width: 60, height: 60, borderRadius: 16, background: "var(--surface-2)", border: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <i className="ri-image-ai-line" style={{ fontSize: 28, lineHeight: 1, color: "var(--text-muted)" }} />
              </div>
              <div style={{ textAlign: "center", display: "flex", flexDirection: "column", gap: 5 }}>
                <p style={{ fontSize: 14, color: "var(--text-secondary)" }}>在左侧输入提示词，开始生成</p>
                <p style={{ fontSize: 12, color: "var(--text-muted)" }}>支持中英文描述 · <kbd style={{ fontFamily: "var(--font-space)", fontSize: 11, padding: "1px 5px", borderRadius: 4, border: "1px solid var(--border)", background: "var(--surface-2)", color: "var(--text-muted)" }}>⌘↵</kbd> 快速生成</p>
              </div>
            </div>
          )}
        </main>
      </div>

      {/* ── Lightbox ── */}
      {lightboxIdx !== null && images[lightboxIdx] && (
        <div
          style={{ position: "fixed", inset: 0, zIndex: 50, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,0.92)", backdropFilter: "blur(14px)", animation: "fadeIn 0.15s ease" }}
          onClick={() => setLightboxIdx(null)}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={imageSrc(images[lightboxIdx])}
            alt="大图预览"
            style={{ maxWidth: "84vw", maxHeight: "88vh", objectFit: "contain", borderRadius: 14, boxShadow: "0 32px 80px rgba(0,0,0,0.7)", animation: "fadeUp 0.2s ease" }}
            onClick={e => e.stopPropagation()}
          />

          {/* Prev / Next */}
          {images.length > 1 && (
            <>
              <button
                onClick={e => { e.stopPropagation(); setLightboxIdx(i => i !== null ? Math.max(0, i - 1) : null); }}
                disabled={lightboxIdx === 0}
                style={{ ...lightboxNavStyle, left: 20, opacity: lightboxIdx === 0 ? 0.25 : 1 }}
              >
                <i className="ri-arrow-left-s-line" style={{ fontSize: 24, lineHeight: 1 }} />
              </button>
              <button
                onClick={e => { e.stopPropagation(); setLightboxIdx(i => i !== null ? Math.min(images.length - 1, i + 1) : null); }}
                disabled={lightboxIdx === images.length - 1}
                style={{ ...lightboxNavStyle, right: 20, opacity: lightboxIdx === images.length - 1 ? 0.25 : 1 }}
              >
                <i className="ri-arrow-right-s-line" style={{ fontSize: 24, lineHeight: 1 }} />
              </button>
              <div style={{ position: "absolute", bottom: 22, left: "50%", transform: "translateX(-50%)", fontSize: 13, color: "rgba(255,255,255,0.45)", fontFamily: "var(--font-space)", letterSpacing: "0.05em" }}>
                {lightboxIdx + 1} / {images.length}
              </div>
            </>
          )}

          {/* Top-right actions */}
          <div style={{ position: "absolute", top: 18, right: 18, display: "flex", gap: 7 }}>
            <button onClick={e => { e.stopPropagation(); copyImageToClipboard(images[lightboxIdx], lightboxIdx); }} style={lightboxBtnStyle} title="复制">
              {copyingIdx === lightboxIdx
                ? <i className="ri-loader-4-line" style={{ fontSize: 16, lineHeight: 1, animation: "spin 1s linear infinite", display: "inline-block" }} />
                : <i className="ri-file-copy-line" style={{ fontSize: 16, lineHeight: 1 }} />
              }
            </button>
            <button onClick={e => { e.stopPropagation(); downloadImage(images[lightboxIdx], lightboxIdx); }} style={lightboxBtnStyle} title="下载">
              <i className="ri-download-2-line" style={{ fontSize: 16, lineHeight: 1 }} />
            </button>
            <button onClick={() => setLightboxIdx(null)} style={lightboxBtnStyle} title="关闭 (ESC)">
              <i className="ri-close-line" style={{ fontSize: 16, lineHeight: 1 }} />
            </button>
          </div>
        </div>
      )}

      {/* ── Toast ── */}
      {toast && (
        <div
          key={toast.id}
          style={{ position: "fixed", bottom: 24, left: "50%", transform: "translateX(-50%)", zIndex: 100, padding: "9px 16px", borderRadius: 10, background: dark ? "rgba(32,32,32,0.96)" : "rgba(255,255,255,0.96)", border: "1px solid var(--border-focus)", color: "var(--text-primary)", fontSize: 13, display: "flex", alignItems: "center", gap: 8, boxShadow: "0 8px 32px rgba(0,0,0,0.2)", backdropFilter: "blur(12px)", animation: "fadeUp 0.2s ease", whiteSpace: "nowrap" }}
        >
          <i className="ri-check-line" style={{ fontSize: 16, lineHeight: 1 }} /> {toast.msg}
        </div>
      )}
    </div>
  );
}

/* ── Sidebar label helper ── */
function SideLabel({ children, icon }: { children: React.ReactNode; icon?: string }) {
  return (
    <span style={{ fontSize: 11, fontWeight: 500, color: "var(--text-muted)", letterSpacing: "0.07em", textTransform: "uppercase", display: "flex", alignItems: "center", gap: 5 }}>
      {icon && <i className={icon} style={{ fontSize: 14, lineHeight: 1 }} />}
      {children}
    </span>
  );
}

function GeneratingPreviewCard({
  aspect,
  index,
  elapsed,
  dark,
}: {
  aspect: AspectRatio;
  index: number;
  elapsed: number | null;
  dark: boolean;
}) {
  return (
    <div
      className="generating-card"
      aria-label={`正在生成图片${elapsed !== null ? `，已等待 ${elapsed} 秒` : ""}`}
      style={{
        aspectRatio: CARD_ASPECT[aspect],
        "--preview-delay": `${index * 0.18}s`,
      } as React.CSSProperties}
    >
      <FlickeringGrid
        color={dark ? "255,255,255" : "58,52,44"}
        flickerChance={dark ? 0.08 : 0.06}
        gridGap={8}
        maxOpacity={dark ? 0.1 : 0.078}
        squareSize={5}
      />
      <div className="generating-card__label">
        正在创建图像......
      </div>
    </div>
  );
}

function FlickeringGrid({
  color,
  flickerChance,
  gridGap,
  maxOpacity,
  squareSize,
}: {
  color: string;
  flickerChance: number;
  gridGap: number;
  maxOpacity: number;
  squareSize: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const parent = canvas?.parentElement;
    if (!canvas || !parent) return;

    let animationFrameId = 0;
    let width = 0;
    let height = 0;
    let columns = 0;
    let rows = 0;
    let opacities: number[] = [];
    const reduceMotionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    let reduceMotion = reduceMotionQuery.matches;

    const initializeGrid = () => {
      const rect = parent.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = Math.max(1, Math.floor(rect.width + 24));
      height = Math.max(1, Math.floor(rect.height + 24));
      columns = Math.ceil(width / (squareSize + gridGap));
      rows = Math.ceil(height / (squareSize + gridGap));
      opacities = Array.from({ length: columns * rows }, () => Math.random() * maxOpacity);

      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;

      const ctx = canvas.getContext("2d");
      if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const drawGrid = () => {
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      ctx.clearRect(0, 0, width, height);

      for (let row = 0; row < rows; row += 1) {
        for (let col = 0; col < columns; col += 1) {
          const index = row * columns + col;
          if (!reduceMotion && Math.random() < flickerChance) {
            opacities[index] = Math.random() * maxOpacity;
          }

          const x = col * (squareSize + gridGap) - 12;
          const y = row * (squareSize + gridGap) - 12;
          ctx.fillStyle = `rgba(${color}, ${opacities[index]})`;
          ctx.fillRect(x, y, squareSize, squareSize);
        }
      }

      if (!reduceMotion) {
        animationFrameId = window.requestAnimationFrame(drawGrid);
      }
    };

    const resizeObserver = new ResizeObserver(() => {
      window.cancelAnimationFrame(animationFrameId);
      initializeGrid();
      drawGrid();
    });
    const handleReduceMotionChange = (event: MediaQueryListEvent) => {
      reduceMotion = event.matches;
      window.cancelAnimationFrame(animationFrameId);
      drawGrid();
    };

    initializeGrid();
    drawGrid();
    resizeObserver.observe(parent);
    reduceMotionQuery.addEventListener("change", handleReduceMotionChange);

    return () => {
      window.cancelAnimationFrame(animationFrameId);
      resizeObserver.disconnect();
      reduceMotionQuery.removeEventListener("change", handleReduceMotionChange);
    };
  }, [color, flickerChance, gridGap, maxOpacity, squareSize]);

  return <canvas className="flickering-grid" ref={canvasRef} aria-hidden="true" />;
}
