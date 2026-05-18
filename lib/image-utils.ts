// 客户端图像/IDB 工具：从 app/page.tsx 抽出，全部纯函数，零 React 依赖。
// 命名风格保持与原代码一致以减少重命名带来的 diff 噪音。

import type { ImageResult, VersionEntry, AspectRatio, ReferenceImage } from "@/lib/types";

/* ── ImageResult → src ── */
export function imageSrc(img: ImageResult): string | undefined {
  if (img.b64) return `data:${img.mediaType};base64,${img.b64}`;
  if (img.url) return img.url;
  return undefined;
}

/* ── Blob 下载 ── */
export function saveBlob(blob: Blob, filename: string) {
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

export function imageElementFromSrc(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error("图片加载失败"));
    el.crossOrigin = "anonymous";
    el.src = src;
  });
}

export function canvasToJpegBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("图片导出失败"));
    }, "image/jpeg", 0.95);
  });
}

/* ── 主入口：下载单张图 ──
   url 走 /api/download 服务端代理（防止 CORS / 防开放代理由后端白名单管控）；
   b64 在客户端 canvas 转 JPEG（QuickLook 兼容） */
export async function downloadImage(img: ImageResult, index: number) {
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

/* ── 缩略图 ── */
export function createThumbnail(src: string, maxW = 200): Promise<string> {
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

export async function createHistoryThumbnail(img: ImageResult) {
  const src = imageSrc(img);
  return src ? createThumbnail(src) : "";
}

/* ── 上传辅助 ── */
export function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("参考图读取失败"));
    reader.readAsDataURL(file);
  });
}

export function getImageDimensions(src: string): Promise<{ width: number; height: number }> {
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => resolve({ width: 0, height: 0 });
    img.src = src;
  });
}

export function formatFileSize(size: number) {
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

export function dataUrlToBase64(dataUrl: string) {
  const idx = dataUrl.indexOf(",");
  return idx !== -1 ? dataUrl.slice(idx + 1) : dataUrl;
}

/* ── 压缩 ── */
export function scaleImageToCanvas(img: HTMLImageElement, maxDim: number): HTMLCanvasElement {
  const scale = Math.min(1, maxDim / Math.max(img.naturalWidth, img.naturalHeight));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(img.naturalWidth * scale);
  canvas.height = Math.round(img.naturalHeight * scale);
  canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas;
}

export async function compressForStorage(
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

export async function compressReferenceForApi(referenceImage: ReferenceImage): Promise<{ data: string; mediaType: string }> {
  try {
    const img = await imageElementFromSrc(referenceImage.dataUrl);
    const canvas = scaleImageToCanvas(img, 1536);
    return { data: dataUrlToBase64(canvas.toDataURL("image/jpeg", 0.85)), mediaType: "image/jpeg" };
  } catch {
    return { data: dataUrlToBase64(referenceImage.dataUrl), mediaType: referenceImage.mediaType };
  }
}

/* ── 画幅 ── */
export function toDisplayAspect(ratio: string): string {
  if (!ratio || ratio === "auto") return "1 / 1";
  return ratio.replace(":", " / ");
}

// Returns w/h pixel sizes for a mini visual ratio box (max 14px on larger side)
export function ratioBox(ratio: string): { w: number; h: number } {
  const [ws, hs] = ratio.split(":");
  const w = Number(ws) || 1;
  const h = Number(hs) || 1;
  const max = 14;
  if (w >= h) return { w: max, h: Math.max(2, Math.round(max * h / w)) };
  return { w: Math.max(2, Math.round(max * w / h)), h: max };
}

/* ── IndexedDB ── 存版本全量图像数据，跨 session 持久化 */
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

export async function idbSaveVersion(entry: VersionEntry, maxKeep: number): Promise<void> {
  try {
    const db = await openIDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("versions", "readwrite");
      const store = tx.objectStore("versions");
      store.put(entry);

      // 顺手清理超过 maxKeep 条的最旧版本，避免 IDB 无限增长 → 移动端配额耗尽
      const items: { id: string; ts: number }[] = [];
      const cursorReq = store.openCursor();
      cursorReq.onsuccess = () => {
        const cursor = cursorReq.result;
        if (cursor) {
          const v = cursor.value as VersionEntry;
          items.push({ id: v.id, ts: v.timestamp });
          cursor.continue();
        } else if (items.length > maxKeep) {
          items.sort((a, b) => a.ts - b.ts);
          for (const { id } of items.slice(0, items.length - maxKeep)) {
            store.delete(id);
          }
        }
      };
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror    = () => { db.close(); reject(tx.error); };
    });
  } catch { /* storage full or unavailable */ }
}

export async function idbLoadVersions(maxKeep: number): Promise<VersionEntry[]> {
  try {
    const db = await openIDB();
    return await new Promise<VersionEntry[]>((resolve, reject) => {
      const tx  = db.transaction("versions", "readonly");
      const req = tx.objectStore("versions").getAll();
      req.onsuccess = () => {
        db.close();
        resolve((req.result as VersionEntry[]).sort((a, b) => b.timestamp - a.timestamp).slice(0, maxKeep));
      };
      req.onerror = () => { db.close(); reject(req.error); };
    });
  } catch { return []; }
}

export async function idbDeleteVersion(id: string): Promise<void> {
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

export async function idbClearVersions(): Promise<void> {
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

/* ── 智能 aspect 推断 ── */
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

export type SmartInference = { size: string; aspect: AspectRatio; label: string };

export function inferSmartAspect(prompt: string, referenceImage: ReferenceImage | null): SmartInference {
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
