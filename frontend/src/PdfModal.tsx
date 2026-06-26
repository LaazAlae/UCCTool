import { useEffect, useCallback } from "react";

interface Props {
  url: string;
  title: string;
  downloadName?: string;
  onClose: () => void;
}

export function PdfModal({ url, title, downloadName, onClose }: Props) {
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === "Escape") onClose();
  }, [onClose]);

  useEffect(() => {
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = "";
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [handleKeyDown]);

  function handleDownload() {
    const a = document.createElement("a");
    a.href = url;
    a.download = downloadName || "document.pdf";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  return (
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 9999,
        background: "rgba(0,0,0,0.55)", backdropFilter: "blur(2px)",
        display: "flex", alignItems: "center", justifyContent: "center",
      }}
      onClick={onClose}
    >
      <div
        style={{
          width: "calc(100vw - 60px)", maxWidth: 1100,
          height: "calc(100vh - 40px)",
          background: "#fff", borderRadius: 14, overflow: "hidden",
          display: "flex", flexDirection: "column",
          boxShadow: "0 25px 80px rgba(0,0,0,0.35)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{
          padding: "10px 16px", background: "#f8f8f7",
          borderBottom: "1px solid var(--border)",
          display: "flex", alignItems: "center", gap: 12,
          flexShrink: 0,
        }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--primary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><polyline points="14 2 14 8 20 8" />
          </svg>
          <span style={{ flex: 1, fontWeight: 600, fontSize: 14, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {title}
          </span>

          <button
            onClick={handleDownload}
            style={{
              display: "flex", alignItems: "center", gap: 6,
              padding: "6px 14px", background: "#fff",
              border: "1px solid var(--border-light)", borderRadius: 8,
              fontSize: 13, fontWeight: 600, color: "var(--text-secondary)",
              cursor: "pointer",
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 5v10M7 12l5 5 5-5" /><path d="M5 19h14" />
            </svg>
            Download
          </button>

          <button
            onClick={onClose}
            style={{
              width: 32, height: 32, display: "flex", alignItems: "center", justifyContent: "center",
              background: "none", border: "1px solid var(--border-light)", borderRadius: 8,
              cursor: "pointer", color: "var(--muted)", fontSize: 18,
            }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        <iframe
          src={url}
          style={{ flex: 1, border: "none", background: "#525659" }}
          title={title}
        />
      </div>
    </div>
  );
}
