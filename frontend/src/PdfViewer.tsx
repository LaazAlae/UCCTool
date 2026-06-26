import { useState, useEffect, useRef, useCallback } from "react";
import * as pdfjsLib from "pdfjs-dist";
import workerSrc from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { api } from "./api";

pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrc;

export interface Highlight {
  fieldKey: string;
  label: string;
  boundingBox: { page: number; x: number; y: number; width: number; height: number };
  confirmed: boolean;
}

interface RenderedPage {
  pageIndex: number;
  canvas: HTMLCanvasElement;
  width: number;
  height: number;
  pdfWidth: number;
  pdfHeight: number;
}

interface Props {
  jobId: string;
  pageCount: number;
  highlights: Highlight[];
  onHighlightClick: (fieldKey: string) => void;
  activeField: string | null;
}

const PAD = 0.008;

interface LabelPos { top: number; left: number }

function resolveLabels(hl: Highlight[], dw: number, dh: number): Map<string, LabelPos> {
  const LH = 16, CW = 5.5, GAP = 2;
  interface R { fk: string; x: number; y: number; w: number; h: number; by: number; bh: number }
  const rs: R[] = hl.map((h) => {
    const bx = Math.max(0, h.boundingBox.x - PAD) * dw;
    const by = Math.max(0, h.boundingBox.y - PAD) * dh;
    const bh = (h.boundingBox.height + PAD * 2) * dh;
    return { fk: h.fieldKey, x: bx, y: by - LH, w: h.label.length * CW + 12, h: LH, by, bh };
  });
  rs.sort((a, b) => a.by - b.by);
  const placed: R[] = [];
  for (const r of rs) {
    let tries = 0;
    while (tries < 8) {
      const hit = placed.find(p => r.x < p.x + p.w && r.x + r.w > p.x && r.y < p.y + p.h && r.y + r.h > p.y);
      if (!hit) break;
      r.y = hit.y - LH - GAP;
      tries++;
    }
    if (r.y < 0) r.y = r.by + r.bh + GAP;
    placed.push(r);
  }
  const m = new Map<string, LabelPos>();
  for (const r of rs) m.set(r.fk, { top: r.y - r.by, left: 0 });
  return m;
}

export function PdfViewer({ jobId, pageCount, highlights, onHighlightClick, activeField }: Props) {
  const [pages, setPages] = useState<RenderedPage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const highlightRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  // Scroll to the exact source box when an input receives focus.
  useEffect(() => {
    if (!activeField) return;
    for (const [key, el] of highlightRefs.current) {
      if (key === activeField || key.split(",").includes(activeField)) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        break;
      }
    }
  }, [activeField]);

  // Load + render PDF
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    pdfjsLib.getDocument(api.evidenceUrl(jobId)).promise.then(async (doc) => {
      const rendered: RenderedPage[] = [];
      for (let i = 0; i < doc.numPages; i++) {
        if (cancelled) return;
        const page = await doc.getPage(i + 1);
        const scale = 1.5;
        const vp = page.getViewport({ scale });
        const uvp = page.getViewport({ scale: 1 });
        const canvas = document.createElement("canvas");
        canvas.width = vp.width;
        canvas.height = vp.height;
        await page.render({ canvasContext: canvas.getContext("2d")!, viewport: vp }).promise;
        rendered.push({ pageIndex: i, canvas, width: vp.width, height: vp.height, pdfWidth: uvp.width, pdfHeight: uvp.height });
        if (!cancelled) {
          setPages([...rendered]);
          if (i === 0) setLoading(false);
        }
      }
      if (!cancelled) setLoading(false);
    }).catch((err) => {
      if (!cancelled) { setError(err.message); setLoading(false); }
    });

    return () => { cancelled = true; };
  }, [jobId]);

  const mountCanvas = useCallback((pageIndex: number, el: HTMLDivElement | null) => {
    if (!el) return;
    const p = pages.find((pg) => pg.pageIndex === pageIndex);
    if (!p || el.firstChild === p.canvas) return;
    el.innerHTML = "";
    el.appendChild(p.canvas);
    p.canvas.style.display = "block";
    p.canvas.style.width = "100%";
    p.canvas.style.height = "auto";
  }, [pages]);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <div style={{
        padding: "8px 12px", background: "#f1f5f9", borderBottom: "1px solid var(--border)",
        borderRadius: "var(--radius) var(--radius) 0 0", fontSize: 13, display: "flex",
        justifyContent: "space-between", color: "var(--muted)",
      }}>
        <span>Evidence PDF</span>
        <span>{pageCount} page{pageCount !== 1 ? "s" : ""}</span>
      </div>

      <div ref={containerRef} style={{ flex: 1, overflow: "auto", background: "#e2e8f0", padding: 16 }}>
        {loading && (
          <div style={{ display: "flex", justifyContent: "center", alignItems: "center", height: 200, flexDirection: "column", gap: 12 }}>
            {error ? (
              <span style={{ color: "var(--danger)", fontSize: 13 }}>{error}</span>
            ) : (
              <>
                <div style={{ width: 32, height: 32, border: "3px solid var(--border)", borderTopColor: "var(--primary)", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
                <span style={{ color: "var(--muted)", fontSize: 13 }}>Rendering PDF...</span>
              </>
            )}
          </div>
        )}

        {pages.map((pg) => {
          const pageHL = highlights.filter((h) => h.boundingBox.page === pg.pageIndex);
          return (
            <div key={pg.pageIndex} style={{ position: "relative", marginBottom: 12, boxShadow: "0 2px 8px rgba(0,0,0,0.15)", borderRadius: 2, overflow: "hidden" }}>
              <div style={{ position: "absolute", top: 6, right: 8, fontSize: 10, color: "#94a3b8", background: "rgba(255,255,255,0.85)", padding: "1px 6px", borderRadius: 3, zIndex: 5 }}>
                {pg.pageIndex + 1}
              </div>
              <div ref={(el) => mountCanvas(pg.pageIndex, el)} style={{ position: "relative" }} />

              {(() => {
                const dw = containerRef.current ? containerRef.current.clientWidth - 32 : pg.width;
                const dh = dw * (pg.pdfHeight / pg.pdfWidth);
                const lps = resolveLabels(pageHL, dw, dh);
                return pageHL.map((h) => {
                  const isActive = activeField ? h.fieldKey.split(",").includes(activeField) : false;
                  const color = h.confirmed ? "rgba(22,163,74," : "rgba(220,38,38,";
                  const lp = lps.get(h.fieldKey) || { top: -16, left: 0 };
                  const below = lp.top > 0;
                  return (
                    <div
                      key={h.fieldKey}
                      ref={(el) => { if (el) highlightRefs.current.set(h.fieldKey, el); }}
                      onClick={() => onHighlightClick(h.fieldKey)}
                      title={h.label}
                      style={{
                        position: "absolute",
                        left: `${Math.max(0, h.boundingBox.x - PAD) * dw}px`,
                        top: `${Math.max(0, h.boundingBox.y - PAD) * dh}px`,
                        width: `${(h.boundingBox.width + PAD * 2) * dw}px`,
                        height: `${(h.boundingBox.height + PAD * 2) * dh}px`,
                        background: `${color}${h.confirmed ? "0.08" : "0.06"})`,
                        borderRadius: 3,
                        cursor: "pointer",
                        transition: "all 0.15s",
                        outline: isActive ? `2px solid ${color}0.6)` : "none",
                        outlineOffset: 2,
                        zIndex: isActive ? 10 : 1,
                      }}
                    >
                      <span style={{
                        position: "absolute", top: lp.top, left: lp.left, fontSize: 9, fontWeight: 600,
                        color: "white", background: `${color}0.7)`, padding: "1px 5px",
                        borderRadius: below ? "0 0 3px 3px" : "3px 3px 0 0", whiteSpace: "nowrap",
                      }}>
                        {h.label}
                      </span>
                    </div>
                  );
                });
              })()}
            </div>
          );
        })}
      </div>
    </div>
  );
}
