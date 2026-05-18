"use client";

import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { UserButton } from "@clerk/nextjs";
import CreditBadge from "@/components/CreditBadge";
import PaymentModal from "@/components/PaymentModal";
import { userButtonAppearance, userProfileAppearance } from "@/lib/clerk-appearance";
import Spinner from "@/components/ui/Spinner";
import Button from "@/components/ui/Button";
import GeneratingCard from "@/components/GeneratingCard";
import Lightbox from "@/components/Lightbox";
import HistorySidebar from "@/components/HistorySidebar";
import { formatTime } from "@/lib/format";
import { emitCreditsDeduct, emitCreditsRefresh } from "@/lib/events";
import type { AspectRatio, Quality, ProviderChoice, AIEngine, ImageResult, HistoryEntry, VersionEntry, ReferenceImage, ToastType } from "@/lib/types";

/* ── Constants ── */
const ASPECT_OPTIONS: { label: string; value: AspectRatio; size: string; icon: string; rotate?: number }[] = [
  { label: "自动", value: "auto",  size: "auto",      icon: "ri-aspect-ratio-line" },
  { label: "方形", value: "1:1",   size: "1024x1024", icon: "ri-square-line" },
  { label: "横版", value: "3:2",   size: "1536x1024", icon: "ri-rectangle-line" },
  { label: "竖版", value: "2:3",   size: "1024x1536", icon: "ri-rectangle-line", rotate: 90 },
];

// eta = 经验值，给用户心理预期；OpenAI gpt-image-2 + tuzi 中转 + 国内下行综合
const QUALITY_OPTIONS: { label: string; value: Quality; icon: string; eta: string }[] = [
  { label: "自动", value: "auto",   icon: "ri-sparkling-2-line",  eta: "~70s" },
  { label: "低",   value: "low",    icon: "ri-signal-wifi-1-fill", eta: "~50s" },
  { label: "中",   value: "medium", icon: "ri-signal-wifi-2-fill", eta: "~70s" },
  { label: "高",   value: "high",   icon: "ri-signal-wifi-3-fill", eta: "~120s" },
];

const GEMINI_QUALITY_OPTIONS: { label: string; value: Quality; icon: string; eta: string }[] = [
  { label: "自动", value: "auto",   icon: "ri-sparkling-2-line",  eta: "~40s" },
  { label: "1K",   value: "low",    icon: "ri-signal-wifi-1-fill", eta: "~30s" },
  { label: "2K",   value: "medium", icon: "ri-signal-wifi-2-fill", eta: "~40s" },
  { label: "4K",   value: "high",   icon: "ri-signal-wifi-3-fill", eta: "~60s" },
];

// 心理预期时间（秒）：基于 QUALITY_OPTIONS 的 base 值，根据其他参数微调。
// 用途：在生成等待界面给用户参数化预估，而不是用固定文案"超过 60s"。
function estimateEtaSeconds(args: {
  engine: AIEngine;
  quality: Quality;
  aspect: AspectRatio;
  geminiAspect: string;
  hasReference: boolean;
  count: number;
}): number {
  const { engine, quality, aspect, geminiAspect, hasReference, count } = args;
  const base = engine === "gemini"
    ? ({ auto: 40, low: 30, medium: 40, high: 60 } as const)[quality]
    : ({ auto: 70, low: 50, medium: 70, high: 120 } as const)[quality];
  let sec: number = base;
  // 非方形构图通常上游更慢（更多 token / 排队权重不同）
  const isWide = engine === "openai"
    ? aspect === "3:2" || aspect === "2:3"
    : geminiAspect !== "1:1";
  if (isWide) sec += 15;
  // 参考图：OpenAI 走 /v1/images/edits，比文本生图多 15-25s；Gemini 多约 10s
  if (hasReference) sec += engine === "openai" ? 20 : 10;
  // 多张：中转商不一定真并发，保守 +20%
  if (count > 1) sec = Math.round(sec * 1.2);
  return sec;
}

// 生成等待面板的参数摘要（"横版 · 高画质 · 含参考图"），帮用户一眼看出为什么慢
function describeGenerationParams(args: {
  engine: AIEngine;
  quality: Quality;
  aspect: AspectRatio;
  geminiAspect: string;
  count: number;
  hasReference: boolean;
}): string {
  const { engine, quality, aspect, geminiAspect, count, hasReference } = args;
  const parts: string[] = [];
  if (engine === "openai") {
    parts.push(({ auto: "自动构图", "1:1": "方形", "3:2": "横版", "2:3": "竖版" } as const)[aspect]);
    parts.push(`${({ auto: "自动", low: "低", medium: "中", high: "高" } as const)[quality]}画质`);
  } else {
    parts.push(`${({ auto: "自动", low: "1K", medium: "2K", high: "4K" } as const)[quality]}画质`);
    parts.push(geminiAspect);
  }
  if (count > 1) parts.push(`${count} 张`);
  if (hasReference) parts.push("含参考图");
  return parts.join(" · ");
}

// 14 aspect ratios supported by gemini-3.1-flash-image-preview
// 4:1 / 1:4 / 8:1 / 1:8 are exclusive to this model
const GEMINI_ASPECT_OPTIONS: { value: string; group: "common" | "extreme" }[] = [
  { value: "1:1",  group: "common"  },
  { value: "4:3",  group: "common"  },
  { value: "3:4",  group: "common"  },
  { value: "16:9", group: "common"  },
  { value: "9:16", group: "common"  },
  { value: "3:2",  group: "common"  },
  { value: "2:3",  group: "common"  },
  { value: "4:5",  group: "common"  },
  { value: "5:4",  group: "common"  },
  { value: "21:9", group: "common"  },
  { value: "4:1",  group: "extreme" },
  { value: "1:4",  group: "extreme" },
  { value: "8:1",  group: "extreme" },
  { value: "1:8",  group: "extreme" },
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
const LS_PROVIDER = "imagegen_provider";
const LS_ENGINE = "imagegen_engine";
const LS_GEMINI_ASPECT = "imagegen_gemini_aspect";
const LS_GEMINI_QUALITY = "imagegen_gemini_quality";
const LS_HISTORY_OPEN = "imagegen_history_panel_open";
const MAX_HISTORY = 20;
const MAX_PROMPTS = 15;
const GEMINI_ENABLED = process.env.NEXT_PUBLIC_ENABLE_GEMINI === "true";
const MAX_REFERENCE_SIZE = 20 * 1024 * 1024;

// 不暴露中转商名字（进货渠道，对用户屏蔽）
const PROVIDER_LABELS: Record<ProviderChoice, { name: string; recommended: boolean }> = {
  tuzi:  { name: "线路一", recommended: false },
  yunwu: { name: "线路二", recommended: true },
};

// 稳定性评分（5 分制，支持 0.5），用户场景实测经验值
const PROVIDER_STABILITY: Record<ProviderChoice, { score: number; hint: string }> = {
  tuzi:  { score: 2.0, hint: "近期不稳定，建议切换到线路二" },
  yunwu: { score: 4.5, hint: "当前最稳定，推荐使用" },
};

function stabilityColor(score: number): string {
  if (score >= 4) return "#4ade80"; // 绿
  if (score >= 3) return "#fbbf24"; // 黄
  return "#f87171";                 // 红
}

/* ── Utils ── */
function imageSrc(img: ImageResult): string | undefined {
  if (img.b64) return `data:${img.mediaType};base64,${img.b64}`;
  if (img.url) return img.url;
  return undefined;
}

function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener noreferrer";
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function imageElementFromSrc(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error("图片加载失败"));
    el.crossOrigin = "anonymous";
    el.src = src;
  });
}

function canvasToJpegBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("图片导出失败"));
    }, "image/jpeg", 0.95);
  });
}

async function downloadImage(img: ImageResult, index: number) {
  const filename = `imagegen-${Date.now()}-${index + 1}.jpg`;

  if (!img.b64 && img.url) {
    const res = await fetch("/api/download", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: img.url, filename }),
    });
    if (!res.ok) {
      let message = "图片下载失败";
      try {
        const data = await res.json();
        message = data.error ?? message;
      } catch {}
      throw new Error(message);
    }
    saveBlob(await res.blob(), filename);
    return;
  }

  const src = imageSrc(img);
  if (!src) throw new Error("图片数据为空，无法下载");
  const loaded = await imageElementFromSrc(src);
  const canvas = document.createElement("canvas");
  canvas.width = loaded.naturalWidth;
  canvas.height = loaded.naturalHeight;
  canvas.getContext("2d")!.drawImage(loaded, 0, 0);
  saveBlob(await canvasToJpegBlob(canvas), filename);
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
    // data: URL 不需要 crossOrigin，设了反而在部分浏览器会触发 tainted canvas
    if (!src.startsWith("data:")) img.crossOrigin = "anonymous";
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

function getImageDimensions(src: string): Promise<{ width: number; height: number }> {
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => resolve({ width: 0, height: 0 });
    img.src = src;
  });
}

function formatFileSize(size: number) {
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function dataUrlToBase64(dataUrl: string) {
  const idx = dataUrl.indexOf(",");
  return idx !== -1 ? dataUrl.slice(idx + 1) : dataUrl;
}

async function createHistoryThumbnail(img: ImageResult) {
  const src = imageSrc(img);
  return src ? createThumbnail(src) : "";
}

function scaleImageToCanvas(img: HTMLImageElement, maxDim: number): HTMLCanvasElement {
  const scale = Math.min(1, maxDim / Math.max(img.naturalWidth, img.naturalHeight));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(img.naturalWidth * scale);
  canvas.height = Math.round(img.naturalHeight * scale);
  canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas;
}

async function compressForStorage(
  file: File,
  maxDim = 1200
): Promise<{ dataUrl: string; mediaType: string; width: number; height: number; size: number }> {
  const objectUrl = URL.createObjectURL(file);
  try {
    const img = await imageElementFromSrc(objectUrl);
    const canvas = scaleImageToCanvas(img, maxDim);
    const dataUrl = canvas.toDataURL("image/jpeg", 0.92);
    return { dataUrl, mediaType: "image/jpeg", width: canvas.width, height: canvas.height, size: Math.round(dataUrl.length * 0.75) };
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

async function compressReferenceForApi(referenceImage: ReferenceImage): Promise<{ data: string; mediaType: string }> {
  try {
    const img = await imageElementFromSrc(referenceImage.dataUrl);
    const canvas = scaleImageToCanvas(img, 1536);
    return { data: dataUrlToBase64(canvas.toDataURL("image/jpeg", 0.85)), mediaType: "image/jpeg" };
  } catch {
    return { data: dataUrlToBase64(referenceImage.dataUrl), mediaType: referenceImage.mediaType };
  }
}

/* ── Aspect ratio utils ── */
function toDisplayAspect(ratio: string): string {
  if (!ratio || ratio === "auto") return "1 / 1";
  return ratio.replace(":", " / ");
}

// Returns w/h pixel sizes for a mini visual ratio box (max 14px on larger side)
function ratioBox(ratio: string): { w: number; h: number } {
  const [ws, hs] = ratio.split(":");
  const w = Number(ws) || 1;
  const h = Number(hs) || 1;
  const max = 14;
  if (w >= h) return { w: max, h: Math.max(2, Math.round(max * h / w)) };
  return { w: Math.max(2, Math.round(max * w / h)), h: max };
}

/* ── IndexedDB — persist full image data across sessions ── */
const IDB_NAME = "imagegen_idb";
const IDB_VER  = 1;

function openIDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, IDB_VER);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains("versions")) {
        req.result.createObjectStore("versions", { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
}

async function idbSaveVersion(entry: VersionEntry): Promise<void> {
  try {
    const db = await openIDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("versions", "readwrite");
      const store = tx.objectStore("versions");
      store.put(entry);

      // 顺手清理超过 MAX_HISTORY 条的最旧版本，避免 IDB 无限增长 → 移动端配额耗尽
      const items: { id: string; ts: number }[] = [];
      const cursorReq = store.openCursor();
      cursorReq.onsuccess = () => {
        const cursor = cursorReq.result;
        if (cursor) {
          const v = cursor.value as VersionEntry;
          items.push({ id: v.id, ts: v.timestamp });
          cursor.continue();
        } else if (items.length > MAX_HISTORY) {
          items.sort((a, b) => a.ts - b.ts);
          for (const { id } of items.slice(0, items.length - MAX_HISTORY)) {
            store.delete(id);
          }
        }
      };
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror    = () => { db.close(); reject(tx.error); };
    });
  } catch { /* storage full or unavailable */ }
}

async function idbLoadVersions(): Promise<VersionEntry[]> {
  try {
    const db = await openIDB();
    return await new Promise<VersionEntry[]>((resolve, reject) => {
      const tx  = db.transaction("versions", "readonly");
      const req = tx.objectStore("versions").getAll();
      req.onsuccess = () => {
        db.close();
        resolve((req.result as VersionEntry[]).sort((a, b) => b.timestamp - a.timestamp).slice(0, MAX_HISTORY));
      };
      req.onerror = () => { db.close(); reject(req.error); };
    });
  } catch { return []; }
}

async function idbDeleteVersion(id: string): Promise<void> {
  try {
    const db = await openIDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("versions", "readwrite");
      tx.objectStore("versions").delete(id);
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror    = () => { db.close(); reject(tx.error); };
    });
  } catch { /* ignore */ }
}

async function idbClearVersions(): Promise<void> {
  try {
    const db = await openIDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("versions", "readwrite");
      tx.objectStore("versions").clear();
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror    = () => { db.close(); reject(tx.error); };
    });
  } catch { /* ignore */ }
}

/* ── Smart aspect inference ── */
const PORTRAIT_KEYWORDS = [
  '海报', 'poster', '竖版', '竖向', '竖式', '竖幅', '竖型',
  '手机', '手机壁纸', '手机界面', '手机截图', '竖屏',
  '封面', '书封', '杂志封面', '杂志',
  '全身', '人像', '肖像', 'portrait',
  '传单', '宣传单', '单页', '展架', '易拉宝',
  '书签', '长图', 'flyer', 'a4', 'a3',
];
const LANDSCAPE_KEYWORDS = [
  '横版', '横向', '横式', '横幅', '横屏', '宽幅',
  '风景', '全景', 'panorama', 'landscape',
  '桌面', '桌面壁纸', '电脑壁纸', '电脑屏幕', '显示器',
  'banner', 'widescreen', '宽屏',
  '电影', '电影感', '影视', '横幅广告',
];

type SmartInference = { size: string; aspect: AspectRatio; label: string };

function inferSmartAspect(prompt: string, referenceImage: ReferenceImage | null): SmartInference {
  // 优先级 1：参考图实际尺寸
  if (referenceImage && referenceImage.width > 0 && referenceImage.height > 0) {
    const ratio = referenceImage.width / referenceImage.height;
    if (ratio > 1.2) return { size: '1536x1024', aspect: '3:2', label: '横版 · 参考图' };
    if (ratio < 0.83) return { size: '1024x1536', aspect: '2:3', label: '竖版 · 参考图' };
    return { size: '1024x1024', aspect: '1:1', label: '方形 · 参考图' };
  }
  // 优先级 2：关键词语义（竖版优先于横版）
  const text = prompt.toLowerCase();
  if (PORTRAIT_KEYWORDS.some(kw => text.includes(kw))) {
    return { size: '1024x1536', aspect: '2:3', label: '竖版 · 语义推断' };
  }
  if (LANDSCAPE_KEYWORDS.some(kw => text.includes(kw))) {
    return { size: '1536x1024', aspect: '3:2', label: '横版 · 语义推断' };
  }
  return { size: '1024x1024', aspect: '1:1', label: '方形 · 默认' };
}


function loadHistory(): HistoryEntry[] {
  try { return JSON.parse(localStorage.getItem(LS_HISTORY) ?? "[]"); } catch { return []; }
}
function saveHistory(entries: HistoryEntry[]) {
  const trimmed = entries.slice(0, MAX_HISTORY);
  try {
    localStorage.setItem(LS_HISTORY, JSON.stringify(trimmed));
  } catch (err) {
    if (err instanceof DOMException && err.name === "QuotaExceededError") {
      // 降级：清空 thumbnail base64（最占空间）后再试，元数据保留以便 UI 仍能展示
      const lite = trimmed.map(e => ({ ...e, thumbnail: "" }));
      try {
        localStorage.setItem(LS_HISTORY, JSON.stringify(lite));
        console.warn("[storage] localStorage 配额紧张，已退化为不缓存缩略图");
      } catch {
        console.warn("[storage] localStorage 配额溢出，历史未保存");
      }
    }
  }
}
function loadPrompts(): string[] {
  try { return JSON.parse(localStorage.getItem(LS_PROMPTS) ?? "[]"); } catch { return []; }
}
function savePrompts(prompts: string[]) {
  try {
    localStorage.setItem(LS_PROMPTS, JSON.stringify(prompts.slice(0, MAX_PROMPTS)));
  } catch (err) {
    if (err instanceof DOMException && err.name === "QuotaExceededError") {
      console.warn("[storage] localStorage 已满，提示词历史未保存");
    }
  }
}



/* ── Main Component ── */
export default function HomePage() {
  const [prompt, setPrompt] = useState("");
  const [aspect, setAspect] = useState<AspectRatio>("auto");
  const [quality, setQuality] = useState<Quality>("auto");
  const [count, setCount] = useState(1);
  const [dark, setDark] = useState(true);
  // 默认线路二（yunwu，速度更快）；localStorage 有旧值的用户保持原选
  const [provider, setProvider] = useState<ProviderChoice>("yunwu");
  const [aiEngine, setAiEngine] = useState<AIEngine>("openai");
  const [loading, setLoading] = useState(false);
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [currentCredits, setCurrentCredits] = useState(0);
  const [images, setImages] = useState<ImageResult[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState<number | null>(null);
  const [lightboxIdx, setLightboxIdx] = useState<number | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [versions, setVersions] = useState<VersionEntry[]>([]);
  const [activeVersionId, setActiveVersionId] = useState<string | null>(null);
  const [recentPrompts, setRecentPrompts] = useState<string[]>([]);
  const [showPromptHistory, setShowPromptHistory] = useState(false);
  const [showHistory, setShowHistory] = useState(true); // 默认展开，localStorage 有「显式收起」记录的用户保持原选
  const [referenceImages, setReferenceImages] = useState<ReferenceImage[]>([]);
  const MAX_REFERENCE_IMAGES = 4;
  const [toast, setToast] = useState<{ msg: string; id: number; type: ToastType } | null>(null);
  const [copyingIdx, setCopyingIdx] = useState<number | null>(null);
  const [displayAspect, setDisplayAspect] = useState<string>("1 / 1");
  const [geminiAspect, setGeminiAspect] = useState<string>("16:9");
  const [geminiQuality, setGeminiQuality] = useState<Quality>("auto");
  const [enhancing, setEnhancing] = useState(false);
  const [mobileSettingsOpen, setMobileSettingsOpen] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  const versionCounterRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const generateControllerRef = useRef<AbortController | null>(null);
  // 同步门闩：防止快速连点 / Cmd+Enter 重复触发导致并发请求 + 重复扣费。
  // setState 是异步的，loading 不能用作同步守卫；ref 才是。
  const generatingRef = useRef(false);
  const mountedRef = useRef(true);
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const referenceInputRef = useRef<HTMLInputElement>(null);
  const settingsSheetRef = useRef<HTMLDivElement>(null);

  /* Close settings sheet on outside tap */
  useEffect(() => {
    if (!mobileSettingsOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      if (settingsSheetRef.current && !settingsSheetRef.current.contains(e.target as Node)) {
        setMobileSettingsOpen(false);
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [mobileSettingsOpen]);

  /* Load from localStorage */
  useEffect(() => {
    setHistory(loadHistory());
    setRecentPrompts(loadPrompts());
    const savedTheme = localStorage.getItem("theme");
    if (savedTheme !== null) setDark(savedTheme === "dark");
    else setDark(window.matchMedia("(prefers-color-scheme: dark)").matches);
    const savedProvider = localStorage.getItem(LS_PROVIDER);
    if (savedProvider === "tuzi" || savedProvider === "yunwu") setProvider(savedProvider);
    else if (savedProvider === "bltcy") setProvider("yunwu"); // 兼容旧值（重命名前用过线路二）
    const savedEngine = localStorage.getItem(LS_ENGINE);
    if (savedEngine === "openai" || (savedEngine === "gemini" && GEMINI_ENABLED)) setAiEngine(savedEngine);
    const savedGeminiAspect = localStorage.getItem(LS_GEMINI_ASPECT);
    if (savedGeminiAspect) setGeminiAspect(savedGeminiAspect);
    const savedGeminiQuality = localStorage.getItem(LS_GEMINI_QUALITY);
    if (savedGeminiQuality === "auto" || savedGeminiQuality === "low" || savedGeminiQuality === "medium" || savedGeminiQuality === "high") {
      setGeminiQuality(savedGeminiQuality);
    }
    // 历史侧栏开关状态：默认展开，只有用户**显式**收起过（saved === "0"）才保持收起
    try {
      const savedHistoryOpen = localStorage.getItem(LS_HISTORY_OPEN);
      if (savedHistoryOpen === "0") setShowHistory(false);
    } catch {}
    // Load full image history from IndexedDB
    void idbLoadVersions().then(v => { if (v.length > 0) setVersions(v); });
  }, []);

  /* 持久化历史侧栏开关 */
  useEffect(() => {
    try { localStorage.setItem(LS_HISTORY_OPEN, showHistory ? "1" : "0"); } catch {}
  }, [showHistory]);

  /* Theme */
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", dark ? "dark" : "light");
    try { localStorage.setItem("theme", dark ? "dark" : "light"); } catch {}
  }, [dark]);

  /* Provider */
  useEffect(() => {
    try { localStorage.setItem(LS_PROVIDER, provider); } catch {}
  }, [provider]);

  /* AI Engine */
  useEffect(() => {
    try { localStorage.setItem(LS_ENGINE, aiEngine); } catch {}
  }, [aiEngine]);

  /* Gemini aspect */
  useEffect(() => {
    try { localStorage.setItem(LS_GEMINI_ASPECT, geminiAspect); } catch {}
  }, [geminiAspect]);

  /* Gemini quality */
  useEffect(() => {
    try { localStorage.setItem(LS_GEMINI_QUALITY, geminiQuality); } catch {}
  }, [geminiQuality]);

  /* Cleanup async UI work on unmount */
  useEffect(() => {
    return () => {
      mountedRef.current = false;
      if (timerRef.current) clearInterval(timerRef.current);
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
      generateControllerRef.current?.abort();
    };
  }, []);

  // Keyboard for Lightbox 已迁移到 Lightbox 组件内部（避免全局监听 + 修 a11y）

  /* iOS 键盘弹起时把虚拟键盘高度写到 CSS 变量，让 mobile-input-bar 上移避免被遮挡 */
  useEffect(() => {
    if (typeof window === "undefined" || !window.visualViewport) return;
    const vv = window.visualViewport;
    const update = () => {
      const inset = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      document.documentElement.style.setProperty("--keyboard-inset", `${inset}px`);
    };
    update();
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
      document.documentElement.style.removeProperty("--keyboard-inset");
    };
  }, []);

  /* Close prompt history on outside click */
  useEffect(() => {
    if (!showPromptHistory) return;
    const handler = (e: MouseEvent) => {
      if (!(e.target as Element).closest(".prompt-area")) setShowPromptHistory(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showPromptHistory]);

  const showToast = useCallback((msg: string, type: ToastType = "success") => {
    const id = Date.now();
    setToast({ msg, id, type });
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToast(null), 2500);
  }, []);

  const selectedAspect = ASPECT_OPTIONS.find(o => o.value === aspect)!;

  const smartInference = useMemo(
    () => aspect === "auto" ? inferSmartAspect(prompt, referenceImages[0] ?? null) : null,
    [aspect, prompt, referenceImages]
  );

  // 只有在 auto 模式下且不是"默认 1:1 fallback"时才显示推断标签
  const showSmartInference = useMemo(() => {
    if (aspect !== "auto" || !smartInference) return false;
    if (smartInference.aspect === "1:1" && referenceImages.length === 0 && !prompt.trim()) return false;
    return true;
  }, [aspect, smartInference, referenceImages.length, prompt]);

  const generationEta = useMemo(() => estimateEtaSeconds({
    engine: aiEngine,
    quality: aiEngine === "gemini" ? geminiQuality : quality,
    aspect,
    geminiAspect,
    hasReference: referenceImages.length > 0,
    count,
  }), [aiEngine, quality, geminiQuality, aspect, geminiAspect, referenceImages.length, count]);

  const generationParamsDesc = useMemo(() => describeGenerationParams({
    engine: aiEngine,
    quality: aiEngine === "gemini" ? geminiQuality : quality,
    aspect,
    geminiAspect,
    count,
    hasReference: referenceImages.length > 0,
  }), [aiEngine, quality, geminiQuality, aspect, geminiAspect, count, referenceImages.length]);

  const handleReferenceUpload = useCallback(async (files: FileList | File[] | undefined) => {
    if (!files || files.length === 0) return;
    const list = Array.from(files);
    const currentCount = referenceImages.length;
    const room = MAX_REFERENCE_IMAGES - currentCount;
    if (room <= 0) {
      showToast(`最多 ${MAX_REFERENCE_IMAGES} 张参考图`, "warning");
      return;
    }

    const accepted: ReferenceImage[] = [];
    for (const file of list.slice(0, room)) {
      if (!file.type.startsWith("image/")) {
        showToast("请选择图片文件", "error");
        continue;
      }
      if (file.size > MAX_REFERENCE_SIZE) {
        showToast(`${file.name} 超过 20 MB，已跳过`, "error");
        continue;
      }
      try {
        const compressed = await compressForStorage(file);
        const thumbnail = await createThumbnail(compressed.dataUrl, 320);
        accepted.push({
          name: file.name,
          dataUrl: compressed.dataUrl,
          thumbnail: thumbnail || compressed.dataUrl,
          mediaType: compressed.mediaType,
          size: compressed.size,
          width: compressed.width,
          height: compressed.height,
        });
      } catch (err) {
        showToast(err instanceof Error ? err.message : `${file.name} 读取失败`, "error");
      }
    }

    if (accepted.length > 0) {
      setReferenceImages(prev => [...prev, ...accepted].slice(0, MAX_REFERENCE_IMAGES));
      const skipped = list.length > room ? `，超出 ${list.length - room} 张已忽略` : "";
      showToast(`已加入 ${accepted.length} 张参考图${skipped}`);
    }
    if (referenceInputRef.current) referenceInputRef.current.value = "";
  }, [referenceImages.length, showToast]);

  const removeReferenceImage = useCallback((index: number) => {
    setReferenceImages(prev => prev.filter((_, i) => i !== index));
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.types.includes("Files")) setDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOver(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files.length > 0) void handleReferenceUpload(e.dataTransfer.files);
  }, [handleReferenceUpload]);

  const enhancePrompt = useCallback(async () => {
    if (!prompt.trim()) {
      promptRef.current?.focus();
      showToast("先输入一句提示词");
      return;
    }
    if (enhancing) return;
    setEnhancing(true);
    try {
      const res = await fetch("/api/enhance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt,
          aspect,
          quality,
          provider,
          // 增强仅用第一张参考图即可（用作风格上下文）
          referenceImage: referenceImages[0]
            ? { data: dataUrlToBase64(referenceImages[0].thumbnail), mediaType: "image/jpeg" }
            : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "增强失败");
      setPrompt(data.enhancedPrompt);
      showToast("提示词已由 AI 增强");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "增强失败，请重试", "error");
    } finally {
      setEnhancing(false);
    }
  }, [prompt, referenceImages, aspect, quality, enhancing, provider, showToast]);

  const handleGenerate = useCallback(async () => {
    // 同步门闩：在 setLoading(true) 真正生效之前的几毫秒窗口，
    // 用户快速连点 / 同时触发快捷键 都会读到 loading=false，导致并发请求 + 重复扣费。
    // ref 是同步的，能在事件循环同一 tick 内立即阻止后续调用。
    if (!prompt.trim() || generatingRef.current) return;
    generatingRef.current = true;

    setMobileSettingsOpen(false);

    const inference = smartInference;
    const effectiveSize = inference ? inference.size : selectedAspect.size;
    const effectiveAspect: AspectRatio = inference ? inference.aspect : aspect;

    generateControllerRef.current?.abort();
    const controller = new AbortController();
    generateControllerRef.current = controller;

    setLoading(true);
    setError(null);
    setImages([]);
    setElapsed(null);
    setShowPromptHistory(false);
    setDisplayAspect(aiEngine === "gemini" ? toDisplayAspect(geminiAspect) : toDisplayAspect(effectiveAspect));
    emitCreditsDeduct(count);

    setElapsed(0);
    const start = Date.now();
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => setElapsed(Math.floor((Date.now() - start) / 1000)), 1000);

    try {
      const apiRefImages = await Promise.all(
        referenceImages.map(async (ref) => {
          const compressed = await compressReferenceForApi(ref);
          return { data: compressed.data, mediaType: compressed.mediaType, name: ref.name };
        })
      );
      const apiPath = aiEngine === "gemini" ? "/api/gemini/generate" : "/api/generate";
      const bodyPayload: Record<string, unknown> = {
        prompt: prompt.trim(),
        size: aiEngine === "gemini" ? "1024x1024" : effectiveSize,
        quality: aiEngine === "gemini" ? geminiQuality : quality,
        n: count,
        // 新版数组形式；旧字段保留兼容 Gemini 路由（暂未升级多图）
        referenceImages: apiRefImages.length > 0 ? apiRefImages : undefined,
        referenceImage: apiRefImages[0],
      };
      if (aiEngine === "openai") bodyPayload.provider = provider;
      if (aiEngine === "gemini") bodyPayload.aspectRatio = geminiAspect;
      const res = await fetch(apiPath, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(bodyPayload),
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
      if (res.status === 402) {
        // Fetch current credits to show in modal（mountedRef 守卫避免组件卸载后 setState）
        fetch("/api/credits")
          .then(r => r.json())
          .then(d => { if (mountedRef.current) setCurrentCredits(d.credits_remaining ?? 0); })
          .catch(() => {});
        emitCreditsRefresh();
        setShowPaymentModal(true);
        return;
      }
      if (!res.ok) throw new Error(data?.error ?? "生成失败，请重试");
      if (!data?.images?.length) throw new Error("未收到图片数据");
      if (!mountedRef.current) return;

      const newImages: ImageResult[] = data.images;
      setImages(newImages);
      if (data.warning) showToast(data.warning, "warning");

      /* Save to history */
      const thumbnail = await createHistoryThumbnail(newImages[0]);
      versionCounterRef.current += 1;
      const entry: HistoryEntry = {
        id: String(Date.now()),
        prompt: prompt.trim(),
        aspect,
        effectiveAspect: aiEngine === "gemini" ? geminiAspect : effectiveAspect,
        quality: aiEngine === "gemini" ? geminiQuality : quality,
        count,
        timestamp: Date.now(),
        thumbnail,
        imageCount: newImages.length,
        referenceName: referenceImages.length > 0
          ? (referenceImages.length === 1 ? referenceImages[0].name : `${referenceImages.length} 张参考图`)
          : undefined,
        versionLabel: `V${versionCounterRef.current}`,
        engine: aiEngine,
      };
      const versionEntry: VersionEntry = {
        ...entry,
        images: newImages,
        referenceThumbnail: referenceImages[0]?.thumbnail,
      };
      setVersions(prev => [versionEntry, ...prev].slice(0, MAX_HISTORY));
      setActiveVersionId(versionEntry.id);
      idbSaveVersion(versionEntry).catch(err => console.warn("[idb] save version failed:", err));
      emitCreditsRefresh();
      setHistory(prev => {
        const next = [entry, ...prev].slice(0, MAX_HISTORY);
        saveHistory(next);
        return next;
      });

      /* Save prompt */
      const trimmed = prompt.trim();
      setRecentPrompts(prev => {
        const next = [trimmed, ...prev.filter(p => p !== trimmed)].slice(0, MAX_PROMPTS);
        savePrompts(next);
        return next;
      });

    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") return;
      if (!mountedRef.current) return;
      setError(err instanceof Error ? err.message : "未知错误");
      emitCreditsRefresh();
    } finally {
      if (generateControllerRef.current === controller) generateControllerRef.current = null;
      if (mountedRef.current) setLoading(false);
      if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
      generatingRef.current = false;
    }
  }, [prompt, quality, geminiQuality, count, aspect, geminiAspect, referenceImages, provider, aiEngine, showToast, smartInference]);

  /* Global ⌘Enter / Ctrl+Enter shortcut — works regardless of focus.
     用 ref 持有最新 handleGenerate + lightboxIdx，effect 一次性绑定，
     避免 handleGenerate 因依赖众多每次重建导致频繁 add/remove listener */
  const handleGenerateRef = useRef(handleGenerate);
  const lightboxOpenRef = useRef(false);
  useEffect(() => { handleGenerateRef.current = handleGenerate; }, [handleGenerate]);
  useEffect(() => { lightboxOpenRef.current = lightboxIdx !== null; }, [lightboxIdx]);
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && !lightboxOpenRef.current) {
        handleGenerateRef.current();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const clearImages = useCallback(() => { setImages([]); setError(null); setActiveVersionId(null); setLightboxIdx(null); }, []);

  const handleDownload = useCallback((img: ImageResult, index: number) => {
    void downloadImage(img, index).catch(err => {
      showToast(err instanceof Error ? err.message : "图片下载失败", "error");
    });
  }, [showToast]);

  const downloadAllTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const downloadAll = useCallback(() => {
    // 清掉上一次未完成的下载 timer，防止用户重新生成后下载到旧 images（闭包陈旧）
    downloadAllTimersRef.current.forEach(clearTimeout);
    downloadAllTimersRef.current = images.map((img, i) =>
      setTimeout(() => handleDownload(img, i), i * 400)
    );
    showToast(`正在下载 ${images.length} 张图片`);
  }, [images, handleDownload, showToast]);

  // 组件卸载或重新生成时清空遗留下载 timer
  useEffect(() => {
    return () => {
      downloadAllTimersRef.current.forEach(clearTimeout);
      downloadAllTimersRef.current = [];
    };
  }, []);

  const copyImageToClipboard = useCallback(async (img: ImageResult, idx: number) => {
    setCopyingIdx(idx);
    const clipboardAvailable = typeof navigator !== "undefined" && !!navigator.clipboard;
    try {
      if (!img.b64 && img.url) {
        try {
          const response = await fetch(img.url, { mode: "cors" });
          const blob = await response.blob();
          if (!blob.type.startsWith("image/")) throw new Error();
          if (clipboardAvailable) {
            await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]);
            showToast("已复制到剪贴板");
          } else {
            throw new Error("clipboard unavailable");
          }
        } catch {
          if (clipboardAvailable && img.url) {
            await navigator.clipboard.writeText(img.url);
            showToast("已复制图片链接");
          } else {
            showToast("复制失败，请手动保存图片", "error");
          }
        }
        return;
      }

      const imgSrc = imageSrc(img);
      if (!imgSrc) throw new Error("图片数据为空，无法复制");
      const image = new Image();
      await new Promise<void>((resolve, reject) => {
        image.onload = () => resolve();
        image.onerror = reject;
        image.src = imgSrc;
      });
      const canvas = document.createElement("canvas");
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      canvas.getContext("2d")!.drawImage(image, 0, 0);
      const blob = await new Promise<Blob | null>(r => canvas.toBlob(r, "image/png"));
      if (!blob) throw new Error();
      if (!clipboardAvailable) throw new Error("clipboard unavailable");
      await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
      showToast("已复制到剪贴板");
    } catch {
      showToast("复制失败，请手动保存图片", "error");
    } finally {
      setCopyingIdx(null);
    }
  }, [showToast]);

  const restoreHistory = useCallback((entry: HistoryEntry) => {
    setPrompt(entry.prompt);
    setAspect(entry.aspect);
    if (entry.engine === "gemini") setGeminiQuality(entry.quality as Quality);
    else setQuality(entry.quality);
    setCount(entry.count);
    // Restore full images from IndexedDB-backed versions list
    const version = versions.find(v => v.id === entry.id);
    if (version) {
      setImages(version.images);
      setActiveVersionId(version.id);
      const ratio = version.effectiveAspect ?? entry.aspect;
      setDisplayAspect(toDisplayAspect(ratio));
      if (version.engine === "gemini" && version.effectiveAspect) {
        setGeminiAspect(version.effectiveAspect);
      }
    } else {
      clearImages();
      promptRef.current?.focus();
    }
  }, [versions, clearImages]);

  const restoreVersion = useCallback((entry: VersionEntry) => {
    setImages(entry.images);
    setPrompt(entry.prompt);
    setAspect(entry.aspect);
    if (entry.engine === "gemini") setGeminiQuality(entry.quality as Quality);
    else setQuality(entry.quality);
    setCount(entry.count);
    setActiveVersionId(entry.id);
    setError(null);
    const ratio = entry.effectiveAspect ?? entry.aspect;
    setDisplayAspect(toDisplayAspect(ratio));
    if (entry.engine === "gemini" && entry.effectiveAspect) {
      setGeminiAspect(entry.effectiveAspect);
    }
  }, []);

  const deleteHistoryEntry = useCallback((id: string) => {
    const next = history.filter(h => h.id !== id);
    saveHistory(next);
    setHistory(next);
    setVersions(prev => prev.filter(v => v.id !== id));
    void idbDeleteVersion(id);
  }, [history]);

  const clearAllHistory = useCallback(() => {
    saveHistory([]);
    setHistory([]);
    setVersions([]);
    idbClearVersions().catch(err => console.warn("[idb] clear versions failed:", err));
  }, []);

  /* Segmented control style — flat per Clerk tokens */
  const segBtn = (active: boolean): React.CSSProperties => ({
    flex: 1,
    padding: "7px 0",
    fontSize: 12,
    fontWeight: active ? 500 : 400,
    border: "none",
    background: "transparent",
    color: active ? "#fff" : "var(--text-secondary)",
    cursor: "pointer",
    transition: "background 0.15s, color 0.15s",
  });

  const sidebarSectionStyle: React.CSSProperties = {
    display: "flex",
    flexDirection: "column",
    gap: 10,
    padding: "14px 14px 13px",
    borderRadius: 10,
    background: "var(--sidebar-section-bg)",
    border: "1px solid var(--sidebar-section-border)",
    boxShadow: "var(--sidebar-section-shadow)",
    // Flexbox column 容器内子项默认 flex-shrink:1，会压缩兄弟节点而不是触发 scroll；
    // 显式禁用收缩，让外层 scroll 容器接管溢出，避免历史展开等场景挤压上方
    flexShrink: 0,
  };

  const sidebarSectionBodyStyle: React.CSSProperties = {
    display: "flex",
    flexDirection: "column",
    gap: 10,
  };

  return (
    <>
    {showPaymentModal && (
      <PaymentModal
        currentCredits={currentCredits}
        onClose={() => setShowPaymentModal(false)}
        onOrderCreated={() => {}}
      />
    )}
    <div className="layout-root" style={{ height: "100vh", display: "flex", flexDirection: "column", background: "var(--bg)", overflow: "hidden" }}>

      {/* ── Header ── */}
      <header className="ck-app-header" style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "0 20px",
        height: 50,
        background: "var(--bg)",
        boxShadow: "inset 0 -1px 0 var(--border)",
        flexShrink: 0,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div className="ck-logo-tile" style={{ width: 28, height: 28, borderRadius: 6, background: "var(--accent)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, boxShadow: "var(--mosaic-primary-shadow)" }}>
            <i className="ri-image-ai-line" style={{ fontSize: 16, lineHeight: 1, color: "var(--btn-text)", position: "relative", zIndex: 1 }} />
          </div>
          <span style={{ fontSize: 14, fontWeight: 600, letterSpacing: "-0.02em", color: "var(--text-primary)", fontFamily: "var(--font-space)" }}>
            ImageGen
          </span>
          <span className="header-badge ck-pill" style={{ fontSize: 11, padding: "2px 7px", borderRadius: "var(--ck-radius-round)", border: "1px solid var(--border-focus)", background: "var(--surface-2)", color: "var(--text-secondary)", fontFamily: "var(--font-space)", letterSpacing: "0.01em" }}>
            GPT-Image-2
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {/* AI 引擎切换 */}
          <div className={`ck-segmented ck-segmented--header header-engine-seg${!GEMINI_ENABLED ? " header-engine-single" : ""}`} style={{ display: "flex", borderRadius: 8, overflow: "visible" }}>
            {(GEMINI_ENABLED ? ["openai", "gemini"] as const : ["openai"] as const).map((eng, i) => {
              const active = aiEngine === eng;
              return (
                <button
                  key={eng}
                  onClick={() => setAiEngine(eng)}
                  title={eng === "openai" ? "GPT-Image-2" : "Google Gemini"}
                  data-active={active}
                  style={{
                    padding: "4px 10px",
                    height: 28,
                    fontSize: 11,
                    fontFamily: "var(--font-space)",
                    border: "none",
                    borderLeft: i > 0 ? "1px solid var(--border-soft)" : "none",
                    background: "transparent",
                    color: active ? "#fff" : "var(--text-muted)",
                    cursor: "pointer",
                    transition: "background 0.15s, color 0.15s",
                    fontWeight: active ? 500 : 400,
                    lineHeight: 1,
                    display: "flex",
                    alignItems: "center",
                    gap: 4,
                  }}
                >
                  <i className={eng === "openai" ? "ri-openai-line" : "ri-google-line"} style={{ fontSize: 12, lineHeight: 1, color: active ? "#fff" : "currentColor" }} />
                  <span style={{ color: active ? "#fff" : "currentColor" }}>{eng === "openai" ? "GPT" : "Gemini"}</span>
                </button>
              );
            })}
          </div>
          {/* 线路切换（仅 OpenAI 模式可见） */}
          {aiEngine === "openai" && (
            <div className="ck-segmented ck-segmented--header header-provider-seg" style={{ display: "flex", borderRadius: 8, overflow: "visible" }}>
              {(["tuzi", "yunwu"] as const).map((p) => {
                const active = provider === p;
                const recommended = p === "yunwu";
                return (
                  <button
                    key={p}
                    onClick={() => setProvider(p)}
                    title={`${PROVIDER_LABELS[p].name}${PROVIDER_LABELS[p].recommended ? "（推荐）" : ""} · ${PROVIDER_STABILITY[p].hint}`}
                    data-active={active}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 4,
                      padding: "4px 10px",
                      height: 28,
                      fontSize: 11,
                      fontFamily: "var(--font-space)",
                      border: "none",
                      borderLeft: p === "yunwu" ? "1px solid var(--border-soft)" : "none",
                      background: "transparent",
                      color: active ? "#fff" : "var(--text-muted)",
                      cursor: "pointer",
                      transition: "background 0.15s, color 0.15s",
                      fontWeight: active ? 500 : 400,
                      lineHeight: 1,
                    }}
                  >
                    {recommended && (
                      <i
                        className="ri-sparkling-2-fill"
                        aria-label="推荐"
                        style={{ fontSize: 11, lineHeight: 1, color: "#fbbf24", flexShrink: 0 }}
                      />
                    )}
                    <span style={{ color: active ? "#fff" : "currentColor" }}>{PROVIDER_LABELS[p].name}</span>
                  </button>
                );
              })}
            </div>
          )}
          <CreditBadge />
          {/* 历史侧栏 toggle */}
          <Button
            variant="icon"
            onClick={() => setShowHistory(v => !v)}
            title={`${showHistory ? "收起" : "展开"}历史${history.length > 0 ? `（${history.length}）` : ""}`}
            style={{
              position: "relative",
              background: showHistory ? "var(--surface-2)" : undefined,
              color: showHistory ? "var(--accent)" : undefined,
            }}
          >
            <i className="ri-history-line" style={{ fontSize: 16, lineHeight: 1 }} />
            {history.length > 0 && (
              <span style={{
                position: "absolute",
                top: 2,
                right: 2,
                minWidth: 14,
                height: 14,
                padding: "0 4px",
                borderRadius: 999,
                background: "var(--accent)",
                color: "var(--btn-text)",
                fontSize: 9,
                fontFamily: "var(--font-space)",
                fontWeight: 600,
                lineHeight: "14px",
                textAlign: "center",
                pointerEvents: "none",
              }}>
                {history.length > 99 ? "99+" : history.length}
              </span>
            )}
          </Button>
          <Button
            variant="icon"
            onClick={() => setDark(d => !d)}
            title={dark ? "切换亮色" : "切换暗色"}
          >
            <i className={dark ? "ri-sun-line" : "ri-moon-line"} style={{ fontSize: 16, lineHeight: 1 }} />
          </Button>
          <UserButton
            appearance={userButtonAppearance}
            userProfileProps={{ appearance: userProfileAppearance }}
          />
        </div>
      </header>

      <div className="layout-inner" style={{ flex: 1, display: "flex", overflow: "hidden" }}>

        {/* ── Left Sidebar (desktop only) ── */}
        <aside className="layout-sidebar" style={{ width: 280, flexShrink: 0, display: "flex", flexDirection: "column", background: "linear-gradient(180deg, rgba(255,255,255,0.02) 0%, transparent 60%), var(--surface)", boxShadow: "inset -1px 0 0 var(--border)", overflow: "hidden" }}>
          <div />
          <div className="layout-sidebar__scroll" style={{ flex: 1, overflowY: "auto", padding: "18px 14px", display: "flex", flexDirection: "column", gap: 12 }}>

            {/* Prompt */}
            <div className="prompt-area sidebar-section" style={sidebarSectionStyle}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <SideLabel icon="ri-pencil-line">提示词</SideLabel>
                <span style={{ fontSize: 11, fontFamily: "var(--font-space)", color: prompt.length >= 4000 ? "var(--error, #f87171)" : prompt.length > 3500 ? "#f59e0b" : "var(--text-muted)" }}>
                  {prompt.length > 3500 ? `${prompt.length}/4000` : prompt.length}
                </span>
              </div>
              <div style={sidebarSectionBodyStyle}>
                <div style={{ position: "relative" }}>
                  <textarea
                    className="ck-textarea"
                    ref={promptRef}
                    value={prompt}
                    onChange={e => setPrompt(e.target.value)}
                    onKeyDown={e => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") handleGenerate(); }}
                    onFocus={() => { if (recentPrompts.length > 0) setShowPromptHistory(true); }}
                    onBlur={() => {
                      // dropdown 内的 mousedown 已 preventDefault 阻止失焦；此处只在点击外部时关闭
                      setShowPromptHistory(false);
                    }}
                    placeholder="描述你想生成的图像..."
                    rows={6}
                    style={{ width: "100%", resize: "none", borderRadius: 10, padding: "12px 12px", fontSize: 13, lineHeight: 1.65, outline: "none", background: "rgba(0,0,0,0.12)", border: "1px solid var(--border)", color: "var(--text-primary)", fontFamily: "var(--font-cn), system-ui", transition: "border-color 0.15s" }}
                  />

                  {/* Prompt history dropdown — 流式布局，撑开 sidebar-section，
                      sidebar 整体接管溢出 scroll，避免浮层盖住下方 sections */}
                  {showPromptHistory && recentPrompts.length > 0 && (
                    <div style={{
                      marginTop: 8,
                      borderRadius: 10,
                      border: "1px solid var(--border-soft)",
                      background: "var(--surface)",
                      boxShadow: "var(--mosaic-menu-shadow)",
                      overflow: "hidden",
                      maxHeight: 180,
                      overflowY: "auto",
                    }}>
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
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, position: "relative", zIndex: 25 }}>
                  <Button
                    variant="secondary"
                    onClick={() => { setShowPromptHistory(false); enhancePrompt(); }}
                    loading={enhancing}
                    style={{ justifyContent: "center", padding: "8px 10px" }}
                  >
                    {enhancing
                      ? <><Spinner size={14} /> 增强中</>
                      : <><i className="ri-magic-line" style={{ fontSize: 14, lineHeight: 1 }} /> 增强</>
                    }
                  </Button>
                  <Button
                    variant="secondary"
                    onClick={() => { setShowPromptHistory(false); referenceInputRef.current?.click(); }}
                    style={{ justifyContent: "center", padding: "8px 10px" }}
                  >
                    <i className="ri-image-add-line" style={{ fontSize: 14, lineHeight: 1 }} /> 参考图
                  </Button>
                  <input
                    ref={referenceInputRef}
                    type="file"
                    accept="image/*"
                    multiple
                    onChange={e => handleReferenceUpload(e.target.files ?? undefined)}
                    style={{ display: "none" }}
                  />
                </div>
              </div>
            </div>

            {/* Reference images (多张参考图) */}
            {referenceImages.length > 0 && (
              <div className="sidebar-section" style={sidebarSectionStyle}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                  <SideLabel icon="ri-image-circle-line">创作参考</SideLabel>
                  <span style={{ fontSize: 10, color: "var(--text-muted)", fontFamily: "var(--font-space)" }}>
                    {referenceImages.length} / {MAX_REFERENCE_IMAGES}
                  </span>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 6 }}>
                  {referenceImages.map((ref, idx) => (
                    <div
                      key={`${ref.name}-${idx}`}
                      style={{
                        position: "relative",
                        aspectRatio: "1 / 1",
                        borderRadius: 7,
                        overflow: "hidden",
                        border: "1px solid var(--border)",
                        background: "var(--surface-2)",
                      }}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={ref.thumbnail}
                        alt={ref.name}
                        title={`${ref.name} · ${formatFileSize(ref.size)}`}
                        loading="lazy"
                        decoding="async"
                        style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                      />
                      <button
                        type="button"
                        onClick={() => removeReferenceImage(idx)}
                        aria-label="移除"
                        title="移除该参考图"
                        style={{
                          position: "absolute",
                          top: 3,
                          right: 3,
                          width: 18,
                          height: 18,
                          borderRadius: "50%",
                          border: "none",
                          background: "rgba(0,0,0,0.65)",
                          color: "#fff",
                          cursor: "pointer",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                        }}
                      >
                        <i className="ri-close-line" style={{ fontSize: 12, lineHeight: 1 }} />
                      </button>
                    </div>
                  ))}
                  {referenceImages.length < MAX_REFERENCE_IMAGES && (
                    <button
                      type="button"
                      onClick={() => referenceInputRef.current?.click()}
                      title="添加更多参考图"
                      style={{
                        aspectRatio: "1 / 1",
                        borderRadius: 7,
                        border: "1.5px dashed var(--border)",
                        background: "transparent",
                        color: "var(--text-muted)",
                        cursor: "pointer",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        transition: "all 0.15s",
                      }}
                      onMouseEnter={e => {
                        e.currentTarget.style.borderColor = "var(--accent)";
                        e.currentTarget.style.color = "var(--accent)";
                      }}
                      onMouseLeave={e => {
                        e.currentTarget.style.borderColor = "var(--border)";
                        e.currentTarget.style.color = "var(--text-muted)";
                      }}
                    >
                      <i className="ri-add-line" style={{ fontSize: 20, lineHeight: 1 }} />
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* Aspect Ratio */}
            <div className="sidebar-section" style={sidebarSectionStyle}>
              <SideLabel icon="ri-aspect-ratio-line">画面比例</SideLabel>
              <div style={sidebarSectionBodyStyle}>
                {aiEngine === "gemini" ? (
                  <GeminiAspectGrid value={geminiAspect} onChange={setGeminiAspect} />
                ) : (
                  <>
                    {showSmartInference && smartInference && (
                      <span style={{ fontSize: 10, color: "var(--text-muted)", fontFamily: "var(--font-space)", letterSpacing: "0.03em" }}>
                        → {smartInference.label}
                      </span>
                    )}
                    <div className="ck-option-grid" style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 6 }}>
                      {ASPECT_OPTIONS.map(opt => {
                        const active = aspect === opt.value;
                        return (
                          <button
                            key={opt.value}
                            onClick={() => { setAspect(opt.value); clearImages(); }}
                            className="ck-option-card"
                            data-active={active}
                            style={{
                              display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
                              gap: 5, padding: "10px 4px", minHeight: 64, borderRadius: 10, border: "none",
                              color: active ? "var(--btn-text)" : "var(--text-muted)",
                              cursor: "pointer", transition: "background 0.15s, box-shadow 0.15s, color 0.15s", fontSize: 11,
                            }}
                          >
                            <i className={opt.icon} style={{ fontSize: 16, lineHeight: 1, transform: opt.rotate ? `rotate(${opt.rotate}deg)` : undefined, display: "inline-block" }} />
                            {opt.label}
                          </button>
                        );
                      })}
                    </div>
                  </>
                )}
              </div>
            </div>

            {/* Quality */}
            <div className="sidebar-section" style={sidebarSectionStyle}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                <SideLabel icon="ri-hd-line">{aiEngine === "gemini" ? "分辨率" : "画质"}</SideLabel>
                <span style={{ fontSize: 10, color: "var(--text-muted)", fontFamily: "var(--font-space)", letterSpacing: "0.02em" }}>
                  预计 {(aiEngine === "gemini" ? GEMINI_QUALITY_OPTIONS : QUALITY_OPTIONS)
                    .find(o => o.value === (aiEngine === "gemini" ? geminiQuality : quality))?.eta}
                </span>
              </div>
              <div className="ck-segmented" style={{ display: "flex", borderRadius: 10, overflow: "hidden", boxShadow: "var(--mosaic-button-shadow)" }}>
                {(aiEngine === "gemini" ? GEMINI_QUALITY_OPTIONS : QUALITY_OPTIONS).map((opt, i) => (
                  (() => {
                    const active = aiEngine === "gemini" ? geminiQuality === opt.value : quality === opt.value;
                    return (
                      <button
                        key={opt.value}
                        data-active={active}
                        title={`${opt.label} · 预计 ${opt.eta}`}
                        onClick={() => aiEngine === "gemini" ? setGeminiQuality(opt.value as Quality) : setQuality(opt.value as Quality)}
                        style={{ ...segBtn(active), borderLeft: i === 0 ? "none" : "1px solid var(--border-soft)", display: "flex", alignItems: "center", justifyContent: "center", gap: 3, padding: "7px 4px" }}
                      >
                        <i className={opt.icon} style={{ fontSize: 13, lineHeight: 1, color: active ? "#fff" : "currentColor" }} />
                        <span style={{ color: active ? "#fff" : "currentColor", fontSize: 12 }}>{opt.label}</span>
                      </button>
                    );
                  })()
                ))}
              </div>
            </div>

            {/* Count */}
            <div className="sidebar-section" style={sidebarSectionStyle}>
              <SideLabel icon="ri-apps-line">生成数量</SideLabel>
              <div className="ck-segmented" style={{ display: "flex", borderRadius: 10, overflow: "hidden", boxShadow: "var(--mosaic-button-shadow)" }}>
                {COUNT_OPTIONS.map((opt, i) => (
                  <button key={opt.n} data-active={count === opt.n} onClick={() => setCount(opt.n)} style={{ ...segBtn(count === opt.n), borderLeft: i === 0 ? "none" : "1px solid var(--border-soft)", display: "flex", alignItems: "center", justifyContent: "center", gap: 4 }}>
                    <i className={opt.icon} style={{ fontSize: 14, lineHeight: 1, color: count === opt.n ? "#fff" : "currentColor" }} />
                    <span style={{ color: count === opt.n ? "#fff" : "currentColor" }}>{opt.n}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* 历史已迁移到顶部历史按钮 → 右侧抽屉，sidebar 不再放历史 */}
          </div>

          {/* Generate Button */}
          <div className="layout-sidebar__footer" style={{ padding: "14px", borderTop: "1px solid var(--border)", flexShrink: 0 }}>
            {/* 线路稳定性指示器 */}
            {aiEngine === "openai" && (() => {
              const stab = PROVIDER_STABILITY[provider];
              const color = stabilityColor(stab.score);
              return (
                <div style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "7px 10px",
                  marginBottom: 8,
                  borderRadius: 8,
                  border: `1px solid ${color}44`,
                  background: `${color}11`,
                }}>
                  <span style={{ fontSize: 11, color: "var(--text-secondary)", display: "flex", alignItems: "center", gap: 5 }}>
                    <i className="ri-pulse-line" style={{ fontSize: 13, color, lineHeight: 1 }} />
                    {PROVIDER_LABELS[provider].name}稳定性
                  </span>
                  <StabilityBars score={stab.score} color={color} />
                </div>
              );
            })()}

            {/* 安抚提示 */}
            <div style={{
              display: "flex",
              alignItems: "flex-start",
              gap: 6,
              padding: "8px 10px",
              marginBottom: 10,
              borderRadius: 8,
              border: "1px solid rgba(251,146,60,0.22)",
              background: "rgba(251,146,60,0.05)",
              fontSize: 11,
              lineHeight: 1.55,
              color: "var(--text-muted)",
            }}>
              <i className="ri-information-line" style={{ fontSize: 13, color: "#fb923c", lineHeight: 1.55, flexShrink: 0 }} />
              <span>
                生图依赖官方服务器稳定性，偶有不稳定 ·
                <strong style={{ color: "var(--text-secondary)", margin: "0 2px" }}>失败积分自动返还</strong>
                · 排队请勿刷新
                {provider === "tuzi" && (
                  <>
                    <br />
                    <span style={{ color: "#f87171" }}>· 当前线路稳定性较低，建议切换线路二</span>
                  </>
                )}
              </span>
            </div>

            <Button
              variant="primary"
              className="generate-btn"
              onClick={handleGenerate}
              disabled={!prompt.trim() || loading}
            >
              {loading ? (
                <>
                  <Spinner size={16} />
                  {`生成中${elapsed !== null ? ` · ${elapsed}s` : ""}`}
                </>
              ) : (
                <>
                  <i className="ri-image-ai-line" style={{ fontSize: 16, lineHeight: 1, position: "relative", zIndex: 1 }} />
                  生成图像
                  <span
                    className="gen-btn-hint"
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
            </Button>
            <p style={{ marginTop: 10, textAlign: "center", fontSize: 11, color: "var(--text-muted)", letterSpacing: "0.08em", fontFamily: "var(--font-space)" }}>
              © QY.Studio · Design by QiaoYa
            </p>
          </div>
        </aside>

        {/* ── Main Preview Area ── */}
        <main
          className="layout-main"
          style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 32, overflow: "auto", gap: 22, position: "relative" }}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          {dragOver && (
            <div style={{ position: "absolute", inset: 0, zIndex: 20, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12, background: "var(--accent-dim)", border: "2px dashed var(--accent)", borderRadius: 0, pointerEvents: "none" }}>
              <i className="ri-image-add-line" style={{ fontSize: 40, lineHeight: 1, color: "var(--accent)" }} />
              <p style={{ fontSize: 14, fontWeight: 500, color: "var(--accent)" }}>松手添加参考图</p>
            </div>
          )}

          {/* Loading skeleton */}
          {loading && (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 20, width: "100%" }}>
              <div className="img-grid-loading" style={{ display: "grid", gridTemplateColumns: count > 1 ? "repeat(2, 1fr)" : "1fr", gap: 14, width: "100%", maxWidth: count > 1 ? "min(620px, 100%)" : "min(400px, 100%)" }}>
                {Array.from({ length: count }).map((_, i) => (
                  <GeneratingCard
                    key={i}
                    aspect={displayAspect}
                    index={i}
                    elapsed={elapsed}
                    dark={dark}
                  />
                ))}
              </div>
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
                <p style={{ fontSize: 13, color: "var(--text-secondary)" }}>
                  {`正在生成${elapsed !== null ? ` · ${elapsed}s` : ""}`}
                </p>
                <p style={{ fontSize: 11, color: "var(--text-muted)", letterSpacing: "0.02em" }}>
                  {generationParamsDesc} · 预计 ~{generationEta}s
                </p>
                {elapsed !== null && elapsed >= generationEta && elapsed < generationEta + 60 && (
                  <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 14px", borderRadius: 8, border: "1px solid rgba(255,180,0,0.22)", background: "rgba(255,180,0,0.05)", fontSize: 12, color: "#ffb400" }}>
                    <i className="ri-time-line" style={{ fontSize: 14, lineHeight: 1 }} /> 已超出平均时间，请耐心等待
                  </div>
                )}
                {elapsed !== null && elapsed >= generationEta + 60 && (
                  <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 14px", borderRadius: 8, border: "1px solid rgba(255,120,0,0.28)", background: "rgba(255,120,0,0.07)", fontSize: 12, color: "#ff8800" }}>
                    <i className="ri-alert-line" style={{ fontSize: 14, lineHeight: 1 }} /> 等待时间偏长，完成后可尝试重新生成
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Error */}
          {error && !loading && (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12, padding: "28px 32px", borderRadius: 12, border: "1px solid var(--border-focus)", background: "var(--surface)", maxWidth: 360, textAlign: "center" }}>
              <i className="ri-error-warning-line" style={{ fontSize: 22, lineHeight: 1, color: "var(--text-secondary)" }} />
              <p style={{ fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.65 }}>{error}</p>
              <Button variant="secondary" onClick={handleGenerate} style={{ padding: "6px 16px" }}>
                <i className="ri-refresh-line" style={{ fontSize: 14, lineHeight: 1 }} /> 重试
              </Button>
            </div>
          )}

          {/* Results */}
          {images.length > 0 && !loading && (
            <>
              <div
                className="img-grid"
                style={{ display: "grid", gridTemplateColumns: images.length > 1 ? "repeat(2, 1fr)" : "1fr", gap: 14, width: "100%", maxWidth: images.length > 1 ? "min(620px, 100%)" : "min(400px, 100%)" }}
              >
                {images.map((img, i) => {
                  const src = imageSrc(img);
                  return (
                  <div
                    key={img.url ?? (img.b64 ? `b64-${i}-${img.b64.length}` : String(i))}
                    className="img-card"
                    style={{ position: "relative", borderRadius: 12, overflow: "hidden", border: "1px solid var(--border)", background: "var(--surface-2)", aspectRatio: displayAspect, cursor: "zoom-in", animation: `fadeUp 0.3s ease ${i * 0.06}s both` }}
                    onClick={() => setLightboxIdx(i)}
                  >
                    {src ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={src} alt={`${prompt} ${i + 1}`} style={{ width: "100%", height: "100%", objectFit: "contain", display: "block" }} />
                    ) : (
                      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 8, color: "var(--text-muted)" }}>
                        <i className="ri-image-2-line" style={{ fontSize: 28, lineHeight: 1 }} />
                        <span style={{ fontSize: 12 }}>图片数据异常</span>
                      </div>
                    )}
                    <div
                      className="img-overlay"
                      style={{ position: "absolute", inset: 0, display: "flex", alignItems: "flex-end", justifyContent: "flex-end", gap: 5, padding: 10, background: "linear-gradient(to top, rgba(0,0,0,0.55) 0%, transparent 50%)" }}
                    >
                      <Button variant="overlay" onClick={e => { e.stopPropagation(); copyImageToClipboard(img, i); }} title="复制">
                        {copyingIdx === i
                          ? <Spinner size={14} />
                          : <i className="ri-file-copy-line" style={{ fontSize: 14, lineHeight: 1 }} />
                        }
                      </Button>
                      <Button variant="overlay" onClick={e => { e.stopPropagation(); handleDownload(img, i); }} title="下载">
                        <i className="ri-download-2-line" style={{ fontSize: 14, lineHeight: 1 }} />
                      </Button>
                      <Button variant="overlay" onClick={e => { e.stopPropagation(); setLightboxIdx(i); }} title="放大">
                        <i className="ri-zoom-in-line" style={{ fontSize: 14, lineHeight: 1 }} />
                      </Button>
                    </div>
                  </div>
                  );
                })}
              </div>

              {/* Action bar */}
              <div className="img-actions" style={{ display: "flex", alignItems: "center", gap: 8 }}>
                {images.length > 1 && (
                  <Button variant="secondary" onClick={downloadAll}>
                    <i className="ri-download-2-line" style={{ fontSize: 14, lineHeight: 1 }} /> 下载全部
                  </Button>
                )}
                {images.length === 1 && (
                  <Button variant="secondary" onClick={() => handleDownload(images[0], 0)}>
                    <i className="ri-download-2-line" style={{ fontSize: 14, lineHeight: 1 }} /> 下载 JPEG
                  </Button>
                )}
                {images.length === 1 && (
                  <Button variant="secondary" onClick={() => copyImageToClipboard(images[0], 0)}>
                    {copyingIdx === 0
                      ? <Spinner size={14} />
                      : <i className="ri-file-copy-line" style={{ fontSize: 14, lineHeight: 1 }} />
                    }
                    复制图片
                  </Button>
                )}
                <Button variant="secondary" onClick={handleGenerate}>
                  <i className="ri-refresh-line" style={{ fontSize: 14, lineHeight: 1 }} /> 重新生成
                </Button>
              </div>

              {versions.length > 0 && (
                <section style={{ width: "100%", maxWidth: 620, display: "flex", flexDirection: "column", gap: 8 }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <SideLabel icon="ri-stack-line">版本</SideLabel>
                    <span style={{ fontSize: 11, color: "var(--text-muted)", fontFamily: "var(--font-space)" }}>{versions.length}/{MAX_HISTORY}</span>
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
                            borderRadius: 8,
                            border: "1px solid",
                            borderColor: active ? "var(--accent)" : "var(--border)",
                            background: active ? "var(--accent-dim)" : "var(--surface-2)",
                            color: active ? "var(--accent)" : "var(--text-secondary)",
                            cursor: "pointer",
                            textAlign: "left",
                          }}
                        >
                          {version.thumbnail ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={version.thumbnail} alt="" loading="lazy" decoding="async" style={{ width: 34, height: 34, objectFit: "cover", borderRadius: 6, flexShrink: 0 }} />
                          ) : (
                            <div style={{ width: 34, height: 34, borderRadius: 6, flexShrink: 0, background: "var(--surface)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                              <i className="ri-image-line" style={{ fontSize: 16, lineHeight: 1, color: "var(--text-muted)" }} />
                            </div>
                          )}
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
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", flex: 1, gap: 16, userSelect: "none", animation: "fadeIn 0.4s ease" }}>
              <div style={{ width: 60, height: 60, borderRadius: 12, background: "var(--surface-2)", border: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <i className="ri-image-ai-line" style={{ fontSize: 28, lineHeight: 1, color: "var(--text-muted)" }} />
              </div>
              <div style={{ textAlign: "center", display: "flex", flexDirection: "column", gap: 5 }}>
                <p style={{ fontSize: 14, color: "var(--text-secondary)" }}>输入提示词，开始生成图像</p>
                <p style={{ fontSize: 12, color: "var(--text-muted)", display: "flex", alignItems: "center", justifyContent: "center", gap: 6, flexWrap: "wrap" }}>
                  <span>支持中英文描述</span>
                  <span>·</span>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                    <kbd style={{ fontFamily: "var(--font-space)", fontSize: 11, padding: "1px 5px", borderRadius: 4, border: "1px solid var(--border)", background: "var(--surface-2)", color: "var(--text-muted)" }}>⌘</kbd>
                    <span>+</span>
                    <kbd style={{ fontFamily: "var(--font-space)", fontSize: 11, padding: "1px 5px", borderRadius: 4, border: "1px solid var(--border)", background: "var(--surface-2)", color: "var(--text-muted)" }}>Enter</kbd>
                    <span>快速生成</span>
                  </span>
                </p>
                <div style={{
                  marginTop: 14,
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 8,
                  alignSelf: "center",
                  padding: "8px 14px",
                  borderRadius: 999,
                  border: "1px solid rgba(251,146,60,0.22)",
                  background: "rgba(251,146,60,0.05)",
                  fontSize: 11,
                  color: "var(--text-muted)",
                }}>
                  <i className="ri-shield-check-line" style={{ fontSize: 13, color: "#fb923c" }} />
                  <span>
                    线路偶有不稳定，<strong style={{ color: "var(--text-secondary)" }}>失败积分自动返还</strong>，请放心使用
                  </span>
                </div>
              </div>
            </div>
          )}
        </main>

        {/* ── 右侧历史栏（可折叠的第三栏，桌面端常驻） ── */}
        <HistorySidebar
          history={history}
          open={showHistory}
          onClose={() => setShowHistory(false)}
          onRestore={restoreHistory}
          onDelete={deleteHistoryEntry}
          onClear={clearAllHistory}
        />
      </div>
    </div>{/* layout-root closes here — fixed overlays below are outside overflow:hidden */}

      {/* ── Mobile Input Bar ── */}
      <div className="mobile-input-bar" style={{ backdropFilter: "blur(24px) saturate(160%)", WebkitBackdropFilter: "blur(24px) saturate(160%)" }}>
        {/* Textarea — 透明融入卡片 */}
        <textarea
          value={prompt}
          onChange={e => setPrompt(e.target.value)}
          onKeyDown={e => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") handleGenerate(); }}
          placeholder="描述你想生成的图像..."
          rows={3}
          maxLength={4000}
          style={{
            width: "100%",
            resize: "none",
            padding: "2px 6px",
            fontSize: 15,
            lineHeight: 1.55,
            outline: "none",
            background: "transparent",
            border: "none",
            color: "var(--text-primary)",
            fontFamily: "var(--font-cn), system-ui",
          }}
        />
        {/* Toolbar：左侧图标组 | 弹簧 | 右侧发送按钮 */}
        <div style={{
          display: "flex",
          alignItems: "center",
          marginTop: 6,
          paddingTop: 8,
          borderTop: "1px solid var(--glass-border)",
          gap: 2,
        }}>
          {/* 增强 */}
          <button
            className="mob-icon-btn"
            onClick={enhancePrompt}
            disabled={enhancing}
            title="AI 增强提示词"
          >
            {enhancing
              ? <Spinner size={18} />
              : <i className="ri-magic-line" style={{ fontSize: 18, lineHeight: 1 }} />
            }
          </button>
          {/* 参考图 */}
          <button
            className="mob-icon-btn"
            onClick={() => referenceInputRef.current?.click()}
            title="上传参考图"
          >
            <i className="ri-image-add-line" style={{ fontSize: 18, lineHeight: 1 }} />
            {referenceImages.length > 0 && (
              <span style={{ position: "absolute", top: 3, right: 3, minWidth: 14, height: 14, padding: "0 4px", borderRadius: 999, background: "var(--accent)", color: "var(--btn-text)", fontSize: 9, fontFamily: "var(--font-space)", fontWeight: 600, lineHeight: "14px", textAlign: "center", border: "1.5px solid var(--glass-bg, #121212)" }}>
                {referenceImages.length}
              </span>
            )}
          </button>
          {/* 设置 */}
          <button
            className="mob-icon-btn"
            onClick={() => setMobileSettingsOpen(o => !o)}
            title="生成设置"
            style={{ color: mobileSettingsOpen ? "var(--accent)" : undefined }}
          >
            <i className="ri-equalizer-line" style={{ fontSize: 18, lineHeight: 1 }} />
          </button>
          {/* 弹簧 */}
          <span style={{ flex: 1 }} />
          {/* 发送按钮 */}
          <Button
            variant="primary"
            className="generate-btn--mobile"
            onClick={handleGenerate}
            disabled={!prompt.trim() || loading}
          >
            {loading ? (
              <>
                <Spinner size={15} />
                {elapsed !== null && <span style={{ fontFamily: "var(--font-space)", fontSize: 12 }}>{elapsed}s</span>}
              </>
            ) : (
              <>
                <i className="ri-arrow-up-line" style={{ fontSize: 16, lineHeight: 1 }} />
                生成
              </>
            )}
          </Button>
        </div>
      </div>

      {/* ── Mobile Settings Sheet ── */}
      <div
        ref={settingsSheetRef}
        className={`mobile-settings-sheet${mobileSettingsOpen ? " mobile-open" : ""}`}
        style={{
          backdropFilter: dark ? "blur(8px) saturate(140%)" : "blur(8px) saturate(120%)",
          WebkitBackdropFilter: dark ? "blur(8px) saturate(140%)" : "blur(8px) saturate(120%)",
        }}
        role="dialog"
        aria-modal={mobileSettingsOpen}
        aria-labelledby="mobile-settings-title"
        aria-hidden={!mobileSettingsOpen}
      >
        <div className="mobile-settings-panel">
        <div className="mobile-settings-header">
          <span id="mobile-settings-title" style={{ fontSize: 13, fontWeight: 500, color: "var(--text-primary)", display: "flex", alignItems: "center", gap: 6 }}>
            <i className="ri-equalizer-line" style={{ fontSize: 15, lineHeight: 1, color: "var(--text-muted)" }} />
            生成设置
          </span>
          <button
            type="button"
            onClick={() => setMobileSettingsOpen(false)}
            className="mobile-settings-close"
            aria-label="关闭生成设置"
          >
            <i className="ri-close-line" style={{ fontSize: 16, lineHeight: 1 }} />
          </button>
        </div>
        <div className="mobile-settings-body">

          {/* Reference images display (mobile settings) */}
          {referenceImages.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                <SideLabel icon="ri-image-circle-line">创作参考</SideLabel>
                <span style={{ fontSize: 10, color: "var(--text-muted)", fontFamily: "var(--font-space)" }}>
                  {referenceImages.length} / {MAX_REFERENCE_IMAGES}
                </span>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 6 }}>
                {referenceImages.map((ref, idx) => (
                  <div key={`${ref.name}-${idx}`} style={{ position: "relative", aspectRatio: "1 / 1", borderRadius: 7, overflow: "hidden", border: "1px solid var(--border)", background: "var(--surface-2)" }}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={ref.thumbnail} alt={ref.name} loading="lazy" decoding="async" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
                    <button type="button" onClick={() => removeReferenceImage(idx)} aria-label="移除"
                      style={{ position: "absolute", top: 3, right: 3, width: 18, height: 18, borderRadius: "50%", border: "none", background: "rgba(0,0,0,0.65)", color: "#fff", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
                      <i className="ri-close-line" style={{ fontSize: 12, lineHeight: 1 }} />
                    </button>
                  </div>
                ))}
                {referenceImages.length < MAX_REFERENCE_IMAGES && (
                  <button type="button" onClick={() => referenceInputRef.current?.click()} title="添加更多"
                    style={{ aspectRatio: "1 / 1", borderRadius: 7, border: "1.5px dashed var(--border)", background: "transparent", color: "var(--text-muted)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <i className="ri-add-line" style={{ fontSize: 20, lineHeight: 1 }} />
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Aspect Ratio */}
          <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
            <SideLabel icon="ri-aspect-ratio-line">画面比例</SideLabel>
            {aiEngine === "gemini" ? (
              <GeminiAspectGrid value={geminiAspect} onChange={setGeminiAspect} />
            ) : (
              <>
                {showSmartInference && smartInference && (
                  <span style={{ fontSize: 10, color: "var(--text-muted)", fontFamily: "var(--font-space)" }}>
                    → {smartInference.label}
                  </span>
                )}
                <div className="ck-option-grid" style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 5 }}>
                  {ASPECT_OPTIONS.map(opt => {
                    const active = aspect === opt.value;
                    return (
                      <button
                        key={opt.value}
                        onClick={() => { setAspect(opt.value); clearImages(); }}
                        className="ck-option-card"
                        data-active={active}
                        style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 6, padding: "10px 4px", borderRadius: 6, border: "none", color: active ? "var(--btn-text)" : "var(--text-muted)", cursor: "pointer", transition: "background 0.15s, box-shadow 0.15s, color 0.15s", fontSize: 11 }}
                      >
                        <i className={opt.icon} style={{ fontSize: 17, lineHeight: 1, transform: opt.rotate ? `rotate(${opt.rotate}deg)` : undefined, display: "inline-block" }} />
                        {opt.label}
                      </button>
                    );
                  })}
                </div>
              </>
            )}
          </div>

          {/* 线路切换（仅 OpenAI 模式） */}
          {aiEngine === "openai" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
              <SideLabel icon="ri-route-line">线路</SideLabel>
              <div className="ck-segmented" style={{ display: "flex", borderRadius: 8, overflow: "hidden", border: "1px solid var(--border)" }}>
                {(["tuzi", "yunwu"] as const).map((p, i) => {
                  const active = provider === p;
                  return (
                    <button key={p} data-active={active} onClick={() => setProvider(p)} title={`${PROVIDER_LABELS[p].name}${PROVIDER_LABELS[p].recommended ? "（推荐）" : ""} · ${PROVIDER_STABILITY[p].hint}`} style={{ ...segBtn(active), borderLeft: i === 0 ? "none" : "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "center", gap: 4 }}>
                      <span style={{ color: active ? "#fff" : "currentColor" }}>{PROVIDER_LABELS[p].name}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Quality */}
          <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
              <SideLabel icon="ri-hd-line">{aiEngine === "gemini" ? "分辨率" : "画质"}</SideLabel>
              <span style={{ fontSize: 10, color: "var(--text-muted)", fontFamily: "var(--font-space)" }}>
                预计 {(aiEngine === "gemini" ? GEMINI_QUALITY_OPTIONS : QUALITY_OPTIONS)
                  .find(o => o.value === (aiEngine === "gemini" ? geminiQuality : quality))?.eta}
              </span>
            </div>
            <div className="ck-segmented" style={{ display: "flex", borderRadius: 8, overflow: "hidden", border: "1px solid var(--border)" }}>
              {(aiEngine === "gemini" ? GEMINI_QUALITY_OPTIONS : QUALITY_OPTIONS).map((opt, i) => (
                (() => {
                  const active = aiEngine === "gemini" ? geminiQuality === opt.value : quality === opt.value;
                  return (
                    <button
                      key={opt.value}
                      data-active={active}
                      title={`${opt.label} · 预计 ${opt.eta}`}
                      onClick={() => aiEngine === "gemini" ? setGeminiQuality(opt.value as Quality) : setQuality(opt.value as Quality)}
                      style={{ ...segBtn(active), borderLeft: i === 0 ? "none" : "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "center", gap: 3, padding: "7px 4px" }}
                    >
                      <i className={opt.icon} style={{ fontSize: 13, lineHeight: 1, color: active ? "#fff" : "currentColor" }} />
                      <span style={{ color: active ? "#fff" : "currentColor", fontSize: 12 }}>{opt.label}</span>
                    </button>
                  );
                })()
              ))}
            </div>
          </div>

          {/* Count */}
          <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
            <SideLabel icon="ri-apps-line">生成数量</SideLabel>
            <div className="ck-segmented" style={{ display: "flex", borderRadius: 8, overflow: "hidden", border: "1px solid var(--border)" }}>
              {COUNT_OPTIONS.map((opt, i) => (
                <button key={opt.n} data-active={count === opt.n} onClick={() => setCount(opt.n)} style={{ ...segBtn(count === opt.n), borderLeft: i === 0 ? "none" : "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "center", gap: 4 }}>
                  <i className={opt.icon} style={{ fontSize: 14, lineHeight: 1, color: count === opt.n ? "#fff" : "currentColor" }} />
                  <span style={{ color: count === opt.n ? "#fff" : "currentColor" }}>{opt.n}</span>
                </button>
              ))}
            </div>
          </div>

          {/* 历史已迁移到顶部历史按钮 → 右侧抽屉，mobile 设置面板不再放 */}
        </div>
        </div>{/* end inner wrapper */}
      </div>

      {/* ── Lightbox ── */}
      {lightboxIdx !== null && images[lightboxIdx] && (
        <Lightbox
          images={images}
          index={lightboxIdx}
          copyingIdx={copyingIdx}
          onClose={() => setLightboxIdx(null)}
          onNavigate={setLightboxIdx}
          onCopy={copyImageToClipboard}
          onDownload={handleDownload}
        />
      )}

      {/* ── Toast ── */}
      {toast && (
        <div
          key={toast.id}
          style={{ position: "fixed", bottom: 24, left: "50%", transform: "translateX(-50%)", zIndex: 100, padding: "9px 16px", borderRadius: 8, background: dark ? "rgba(32,32,32,0.96)" : "rgba(255,255,255,0.96)", border: "1px solid var(--border-focus)", color: "var(--text-primary)", fontSize: 13, display: "flex", alignItems: "center", gap: 8, boxShadow: "0 8px 32px rgba(0,0,0,0.2)", backdropFilter: "blur(12px)", animation: "fadeUp 0.2s ease", whiteSpace: "nowrap" }}
        >
          <i className={toast.type === "error" ? "ri-error-warning-line" : toast.type === "warning" ? "ri-alert-line" : "ri-check-line"} style={{ fontSize: 16, lineHeight: 1 }} /> {toast.msg}
        </div>
      )}
    </>
  );
}

/* ── Gemini aspect ratio grid ── */
function GeminiAspectGrid({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const common  = GEMINI_ASPECT_OPTIONS.filter(o => o.group === "common");
  const extreme = GEMINI_ASPECT_OPTIONS.filter(o => o.group === "extreme");

  const btn = (opt: { value: string }) => {
    const active = value === opt.value;
    const box = ratioBox(opt.value);
    return (
      <button
        key={opt.value}
        onClick={() => onChange(opt.value)}
        title={opt.value}
        className="ck-option-card"
        data-active={active}
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 5,
          minHeight: 46,
          padding: "7px 3px",
          borderRadius: 6,
          border: "none",
          color: active ? "var(--btn-text)" : "var(--text-muted)",
          cursor: "pointer",
          transition: "background 0.15s, box-shadow 0.15s, color 0.15s",
          fontSize: 10,
          fontFamily: "var(--font-space)",
          lineHeight: 1,
        }}
      >
        <div style={{
          width: box.w,
          height: box.h,
          border: "1.5px solid currentColor",
          borderRadius: 1.5,
          flexShrink: 0,
        }} />
        {opt.value}
      </button>
    );
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 4 }}>
        {common.map(btn)}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <div style={{ flex: 1, height: 1, background: "var(--border)" }} />
        <span style={{ fontSize: 9, color: "var(--text-muted)", fontFamily: "var(--font-space)", letterSpacing: "0.06em", flexShrink: 0 }}>3.1 Flash 独有</span>
        <div style={{ flex: 1, height: 1, background: "var(--border)" }} />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 4 }}>
        {extreme.map(btn)}
      </div>
    </div>
  );
}

/* ── Sidebar label helper ── */
// 5 格稳定性指示器，支持半格（score 1-5，0.5 step）
function StabilityBars({ score, color }: { score: number; color: string }) {
  return (
    <div style={{ display: "flex", gap: 3 }} aria-label={`稳定性 ${score}/5`}>
      {[1, 2, 3, 4, 5].map(i => {
        const full = score >= i;
        const half = !full && score >= i - 0.5;
        const bg = full ? color : "transparent";
        return (
          <div
            key={i}
            style={{
              width: 10,
              height: 14,
              borderRadius: 2,
              border: `1px solid ${full || half ? color : "var(--border)"}`,
              background: bg,
              position: "relative",
              overflow: "hidden",
            }}
          >
            {half && (
              <div style={{
                position: "absolute",
                left: 0,
                top: 0,
                bottom: 0,
                width: "50%",
                background: color,
              }} />
            )}
          </div>
        );
      })}
    </div>
  );
}

function SideLabel({ children, icon }: { children: React.ReactNode; icon?: string }) {
  return (
    <span style={{ fontSize: 12, fontWeight: 500, color: "var(--text-secondary)", letterSpacing: "0.04em", textTransform: "uppercase", display: "flex", alignItems: "center", gap: 6 }}>
      {icon && <i className={icon} style={{ fontSize: 16, lineHeight: 1, fontWeight: 400, color: "var(--text-secondary)" }} />}
      {children}
    </span>
  );
}
