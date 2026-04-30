"use client";

import { formatTime } from "@/lib/format";
import type { HistoryEntry } from "@/lib/types";
import Button from "@/components/ui/Button";

interface Props {
  history: HistoryEntry[];
  showHistory: boolean;
  onToggle: () => void;
  onRestore: (entry: HistoryEntry) => void;
  onDelete: (id: string) => void;
  onClear: () => void;
  sidebarSectionStyle: React.CSSProperties;
}

export default function HistoryPanel({
  history,
  showHistory,
  onToggle,
  onRestore,
  onDelete,
  onClear,
  sidebarSectionStyle,
}: Props) {
  if (history.length === 0) return null;

  return (
    <div className="sidebar-section" style={sidebarSectionStyle}>
      <button
        onClick={onToggle}
        style={{ display: "flex", alignItems: "center", justifyContent: "space-between", background: "none", border: "none", cursor: "pointer", padding: 0 }}
      >
        <span style={{ fontSize: 12, fontWeight: 500, color: "var(--text-secondary)", letterSpacing: "0.04em", textTransform: "uppercase", display: "flex", alignItems: "center", gap: 6 }}>
          <i className="ri-history-line" style={{ fontSize: 16, lineHeight: 1, fontWeight: 400, color: "var(--text-secondary)" }} /> 历史 ({history.length})
        </span>
        <i className={showHistory ? "ri-arrow-up-s-line" : "ri-arrow-down-s-line"} style={{ fontSize: 16, lineHeight: 1, color: "var(--text-muted)" }} />
      </button>

      {showHistory && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {history.slice(0, 10).map(entry => (
            <div
              key={entry.id}
              className="history-item ck-data-row"
              style={{ display: "flex", alignItems: "center", gap: 9, padding: "7px 9px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--surface-2)", cursor: "pointer", transition: "border-color 0.15s", position: "relative" }}
              onClick={() => onRestore(entry)}
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
                onClick={e => { e.stopPropagation(); onDelete(entry.id); }}
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
          <Button variant="ghost" onClick={onClear}>
            <i className="ri-delete-bin-6-line" style={{ fontSize: 14, lineHeight: 1 }} /> 清空历史
          </Button>
        </div>
      )}
    </div>
  );
}
