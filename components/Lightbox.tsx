"use client";

import { useEffect, useRef } from "react";
import Button from "@/components/ui/Button";
import Spinner from "@/components/ui/Spinner";

type ImageResult = { b64?: string; url?: string; mediaType: string };

function imageSrc(img: ImageResult): string | undefined {
  if (img.b64) return `data:${img.mediaType};base64,${img.b64}`;
  if (img.url) return img.url;
  return undefined;
}

interface Props {
  images: ImageResult[];
  index: number;
  copyingIdx: number | null;
  onClose: () => void;
  onNavigate: (idx: number) => void;
  onCopy: (img: ImageResult, idx: number) => void;
  onDownload: (img: ImageResult, idx: number) => void;
}

export default function Lightbox({
  images,
  index,
  copyingIdx,
  onClose,
  onNavigate,
  onCopy,
  onDownload,
}: Props) {
  const img = images[index];
  const src = img ? imageSrc(img) : undefined;
  const bgRef = useRef<HTMLDivElement>(null);
  const downOnBg = useRef(false);

  // 键盘：ESC 关闭 / 左右切图。组件内置，避免父组件全局监听
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      } else if (e.key === "ArrowLeft" && index > 0) {
        onNavigate(index - 1);
      } else if (e.key === "ArrowRight" && index < images.length - 1) {
        onNavigate(index + 1);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [index, images.length, onClose, onNavigate]);

  // 锁背景滚动，避免移动端 lightbox 打开后页面跟着滑
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, []);

  // 触屏拖拽时常常 pointerdown 在图上、pointerup 在背板，原本直接 onClick 误关闭。
  // 改成 down 和 up 必须都在背板上才算"点背板关闭"
  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    downOnBg.current = e.target === bgRef.current;
  };
  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (downOnBg.current && e.target === bgRef.current) onClose();
    downOnBg.current = false;
  };

  return (
    <div
      ref={bgRef}
      role="dialog"
      aria-modal="true"
      aria-label="大图预览"
      style={{ position: "fixed", inset: 0, zIndex: 50, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,0.92)", backdropFilter: "blur(14px)", animation: "fadeIn 0.15s ease" }}
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
    >
      {src && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt="大图预览"
          style={{ maxWidth: "84vw", maxHeight: "88vh", objectFit: "contain", borderRadius: 12, boxShadow: "0 32px 80px rgba(0,0,0,0.7)", animation: "fadeUp 0.2s ease" }}
          onPointerDown={e => e.stopPropagation()}
          onPointerUp={e => e.stopPropagation()}
        />
      )}

      {/* Prev / Next */}
      {images.length > 1 && (
        <>
          <Button
            variant="lightbox-nav"
            onClick={e => { e.stopPropagation(); onNavigate(Math.max(0, index - 1)); }}
            disabled={index === 0}
            style={{ left: 20, opacity: index === 0 ? 0.25 : 1 }}
          >
            <i className="ri-arrow-left-s-line" style={{ fontSize: 24, lineHeight: 1 }} />
          </Button>
          <Button
            variant="lightbox-nav"
            onClick={e => { e.stopPropagation(); onNavigate(Math.min(images.length - 1, index + 1)); }}
            disabled={index === images.length - 1}
            style={{ right: 20, opacity: index === images.length - 1 ? 0.25 : 1 }}
          >
            <i className="ri-arrow-right-s-line" style={{ fontSize: 24, lineHeight: 1 }} />
          </Button>
          <div style={{ position: "absolute", bottom: 22, left: "50%", transform: "translateX(-50%)", fontSize: 13, color: "rgba(255,255,255,0.45)", fontFamily: "var(--font-space)", letterSpacing: "0.05em" }}>
            {index + 1} / {images.length}
          </div>
        </>
      )}

      {/* Top-right actions */}
      <div style={{ position: "absolute", top: 18, right: 18, display: "flex", gap: 7 }}>
        <Button variant="lightbox" onClick={e => { e.stopPropagation(); onCopy(img, index); }} title="复制">
          {copyingIdx === index
            ? <Spinner size={16} />
            : <i className="ri-file-copy-line" style={{ fontSize: 16, lineHeight: 1 }} />
          }
        </Button>
        <Button variant="lightbox" onClick={e => { e.stopPropagation(); onDownload(img, index); }} title="下载">
          <i className="ri-download-2-line" style={{ fontSize: 16, lineHeight: 1 }} />
        </Button>
        <Button variant="lightbox" onClick={onClose} title="关闭 (ESC)">
          <i className="ri-close-line" style={{ fontSize: 16, lineHeight: 1 }} />
        </Button>
      </div>
    </div>
  );
}
