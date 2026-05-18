"use client";

import { useEffect } from "react";
import { formatTime } from "@/lib/format";
import type { HistoryEntry } from "@/lib/types";

interface Props {
  history: HistoryEntry[];
  open: boolean;
  onClose: () => void;
  onRestore: (entry: HistoryEntry) => void;
  onDelete: (id: string) => void;
  onClear: () => void;
}

export default function HistoryDrawer({
  history,
  open,
  onClose,
  onRestore,
  onDelete,
  onClear,
}: Props) {
  // Esc 关闭
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  return (
    <>
      {/* 蒙层 */}
      <div
        onClick={onClose}
        aria-hidden={!open}
        style={{
          position: "fixed",
          inset: 0,
          background: "rgba(0,0,0,0.45)",
          backdropFilter: "blur(6px)",
          WebkitBackdropFilter: "blur(6px)",
          opacity: open ? 1 : 0,
          pointerEvents: open ? "auto" : "none",
          transition: "opacity 0.25s ease",
          zIndex: 99,
        }}
      />

      {/* 抽屉本体 */}
      <aside
        aria-hidden={!open}
        style={{
          position: "fixed",
          top: 0,
          right: 0,
          bottom: 0,
          width: "min(380px, 92vw)",
          background: "var(--surface)",
          borderLeft: "1px solid var(--border)",
          boxShadow: open ? "var(--mosaic-card-shadow, -8px 0 24px rgba(0,0,0,0.3))" : "none",
          display: "flex",
          flexDirection: "column",
          transform: open ? "translateX(0)" : "translateX(100%)",
          transition: "transform 0.28s cubic-bezier(0.32, 0.72, 0, 1)",
          zIndex: 100,
        }}
      >
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 18px", borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <i className="ri-history-line" style={{ fontSize: 18, lineHeight: 1, color: "var(--text-secondary)" }} />
            <span style={{ fontSize: 14, fontWeight: 600, color: "var(--text-primary)" }}>生成历史</span>
            {history.length > 0 && (
              <span style={{ fontSize: 11, padding: "1px 7px", borderRadius: 999, background: "var(--surface-2)", color: "var(--text-muted)", fontFamily: "var(--font-space)" }}>
                {history.length}
              </span>
            )}
          </div>
          <button
            onClick={onClose}
            aria-label="关闭"
            style={{ width: 30, height: 30, borderRadius: 6, border: "1px solid var(--border)", background: "transparent", color: "var(--text-muted)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}
          >
            <i className="ri-close-line" style={{ fontSize: 16, lineHeight: 1 }} />
          </button>
        </div>

        {/* Content */}
        <div style={{ flex: 1, overflowY: "auto", padding: 14 }}>
          {history.length === 0 ? (
            <div style={{ padding: "60px 0", textAlign: "center", color: "var(--text-muted)", fontSize: 13 }}>
              <i className="ri-archive-line" style={{ fontSize: 32, lineHeight: 1, opacity: 0.4, display: "block", marginBottom: 12 }} />
              暂无历史记录<br />
              <span style={{ fontSize: 11, color: "var(--text-muted)", opacity: 0.7 }}>生成的图片会自动保存到这里</span>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {history.map(entry => (
                <div
                  key={entry.id}
                  className="history-item ck-data-row"
                  style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", borderRadius: 10, border: "1px solid var(--border)", background: "var(--surface-2)", cursor: "pointer", transition: "border-color 0.15s" }}
                  onClick={() => { onRestore(entry); onClose(); }}
                  onMouseEnter={e => (e.currentTarget.style.borderColor = "var(--border-focus)")}
                  onMouseLeave={e => (e.currentTarget.style.borderColor = "var(--border)")}
                >
                  {entry.thumbnail && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={entry.thumbnail} alt="" style={{ width: 44, height: 44, objectFit: "cover", borderRadius: 6, flexShrink: 0, border: "1px solid var(--border)" }} />
                  )}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ fontSize: 13, color: "var(--text-primary)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", marginBottom: 3 }}>
                      {entry.prompt}
                    </p>
                    <p style={{ fontSize: 11, color: "var(--text-muted)" }}>
                      {entry.versionLabel ? `${entry.versionLabel} · ` : ""}
                      {formatTime(entry.timestamp)} · {entry.imageCount} 张
                      {entry.referenceName ? " · 参考" : ""}
                    </p>
                  </div>
                  <button
                    onClick={e => { e.stopPropagation(); onDelete(entry.id); }}
                    aria-label="删除"
                    title="删除该条历史"
                    style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", padding: 4, flexShrink: 0, borderRadius: 4 }}
                  >
                    <i className="ri-close-line" style={{ fontSize: 16, lineHeight: 1 }} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        {history.length > 0 && (
          <div style={{ padding: "12px 14px", borderTop: "1px solid var(--border)", flexShrink: 0 }}>
            <button
              onClick={onClear}
              style={{ width: "100%", padding: "9px 0", borderRadius: 8, border: "1px solid var(--border)", background: "transparent", color: "var(--text-muted)", fontSize: 12, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}
            >
              <i className="ri-delete-bin-6-line" style={{ fontSize: 14, lineHeight: 1 }} /> 清空所有历史
            </button>
          </div>
        )}
      </aside>
    </>
  );
}
