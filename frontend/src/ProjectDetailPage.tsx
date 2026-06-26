import { useState, useEffect, useRef } from "react";
import * as pdfjsLib from "pdfjs-dist";
import workerSrc from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { api } from "./api";
import type { Evidence, Project } from "./api";

pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrc;

interface Props {
  projectId: string;
  onReview: (jobId: string, fileName: string, pageCount: number) => void;
}

export function ProjectDetailPage({ projectId, onReview }: Props) {
  const [project, setProject] = useState<(Project & { evidence: Evidence[] }) | null>(null);
  const [trash, setTrash] = useState<Evidence[]>([]);
  const [showTrash, setShowTrash] = useState(false);
  const [showUpload, setShowUpload] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [compiling, setCompiling] = useState(false);

  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [resultType, setResultType] = useState<"Records Found" | "No Records" | "">("");
  const [uploading, setUploading] = useState(false);
  const [uploadPageCount, setUploadPageCount] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);

  useEffect(() => { reload(); }, [projectId]);

  async function reload() {
    setLoading(true);
    setError(null);
    try {
      const p = await api.getProject(projectId);
      setProject(p);
      if (showTrash) setTrash(await api.getTrash(projectId));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load project");
    } finally {
      setLoading(false);
    }
  }

  async function handleUpload() {
    if (!uploadFile || !resultType) return;
    setUploading(true);
    setError(null);
    try {
      const res = await api.uploadToProject(projectId, uploadFile, resultType);
      setShowUpload(false);
      setUploadFile(null);
      if (resultType === "Records Found") {
        onReview(res.jobId, res.fileName, res.pageCount);
      } else {
        await reload();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  async function handleFileSelect(file: File | null) {
    setUploadFile(file);
    setUploadPageCount(0);
    if (!file) return;
    try {
      const buf = await file.arrayBuffer();
      const doc = await pdfjsLib.getDocument(new Uint8Array(buf)).promise;
      setUploadPageCount(doc.numPages);
      doc.destroy();
    } catch {}
  }

  async function handleDelete(jobId: string) {
    try {
      await api.deleteEvidence(projectId, jobId);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
    }
  }

  async function handleRestore(jobId: string) {
    try {
      await api.restoreEvidence(projectId, jobId);
      setTrash(await api.getTrash(projectId));
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Restore failed");
    }
  }

  async function handleToggleInclude(jobId: string, included: boolean) {
    try {
      await api.toggleInclude(projectId, jobId, included);
      setProject((prev) => {
        if (!prev) return prev;
        return { ...prev, evidence: prev.evidence.map((e) => e.id === jobId ? { ...e, included } : e) };
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Toggle failed");
    }
  }

  async function handleCompile() {
    if (!project) return;
    setCompiling(true);
    setError(null);
    try {
      await api.compileReport(projectId, project.projectNumber || project.name);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Compilation failed");
    } finally {
      setCompiling(false);
    }
  }

  function handleDragStart(idx: number) { setDragIdx(idx); }
  function handleDragOver(e: React.DragEvent, idx: number) { e.preventDefault(); setDragOverIdx(idx); }

  async function handleDrop(idx: number) {
    if (dragIdx === null || !project) return;
    const items = [...project.evidence];
    const [moved] = items.splice(dragIdx, 1);
    items.splice(idx, 0, moved);
    setProject({ ...project, evidence: items });
    setDragIdx(null);
    setDragOverIdx(null);
    try {
      await api.reorderEvidence(projectId, items.map((e) => e.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Reorder failed");
      await reload();
    }
  }

  async function handleShowTrash() {
    setShowTrash(!showTrash);
    if (!showTrash) {
      try { setTrash(await api.getTrash(projectId)); } catch {}
    }
  }

  if (loading || !project) {
    return (
      <div style={{ display: "flex", justifyContent: "center", alignItems: "center", height: 300, flexDirection: "column", gap: 12 }}>
        <div style={{ width: 36, height: 36, border: "3px solid var(--border)", borderTopColor: "var(--primary)", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
        <p style={{ color: "var(--muted)" }}>Loading project...</p>
      </div>
    );
  }

  const evidence = project.evidence || [];
  const includedCount = evidence.filter((e) => e.included).length;

  return (
    <div>
      <div style={{ marginBottom: 24 }}>
        <div style={{ fontSize: 25, fontWeight: 800, color: "var(--text)", letterSpacing: "-0.02em" }}>{project.name}</div>
        <div style={{ marginTop: 6, fontSize: 13.5, color: "var(--text-secondary)" }}>
          {project.preparedFor && <>{project.preparedFor.split("\n")[0]} &nbsp;&middot;&nbsp; </>}
          {project.clientMatter && <>Matter <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 12.5 }}>#{project.clientMatter}</span> &nbsp;&middot;&nbsp; </>}
          {evidence.length} evidence item{evidence.length !== 1 ? "s" : ""}
        </div>
      </div>

      {error && (
        <div style={{ padding: "10px 14px", background: "var(--danger-bg)", color: "var(--danger)", borderRadius: 8, fontSize: 13, marginBottom: 14, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          {error}
          <button onClick={() => setError(null)} style={{ background: "none", border: "none", color: "var(--danger)", fontSize: 16, padding: "0 4px" }}>x</button>
        </div>
      )}

      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: showUpload ? 18 : 24 }}>
        <button
          onClick={() => { setShowUpload(!showUpload); setResultType(""); setUploadFile(null); setUploadPageCount(0); }}
          style={{
            background: showUpload ? "var(--primary-hover)" : "var(--primary)", color: "#fff",
            fontWeight: 700, fontSize: 14, padding: "11px 18px", border: "none", borderRadius: 10,
            display: "flex", alignItems: "center", gap: 8,
            boxShadow: showUpload ? "0 0 0 3px rgba(155,28,28,0.16)" : "var(--shadow-btn)",
          }}
        >
          {showUpload ? (
            <>
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
              Close Upload
            </>
          ) : (
            <>
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 16V5M7 10l5-5 5 5"/><path d="M5 19h14"/></svg>
              Upload Evidence
            </>
          )}
        </button>
        <button
          onClick={handleCompile}
          disabled={compiling || includedCount === 0}
          style={{
            background: compiling || includedCount === 0 ? "var(--border)" : "var(--success)", color: "#fff",
            fontWeight: 700, fontSize: 14, padding: "11px 18px", border: "none", borderRadius: 10,
            display: "flex", alignItems: "center", gap: 8,
            boxShadow: compiling || includedCount === 0 ? "none" : "0 4px 12px rgba(21,128,61,0.20)",
            opacity: compiling || includedCount === 0 ? 0.6 : 1,
          }}
        >
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12l4 4L19 6"/></svg>
          {compiling ? "Compiling..." : `Compile Report (${includedCount})`}
        </button>
        <div style={{ flex: 1 }} />
        <button
          onClick={handleShowTrash}
          style={{
            background: showTrash ? "var(--primary-bg)" : "#fff",
            color: showTrash ? "var(--primary)" : "var(--text-secondary)",
            fontWeight: showTrash ? 700 : 600, fontSize: 14, padding: "11px 16px",
            border: showTrash ? "1px solid #F0CFCF" : "1px solid var(--border-light)",
            borderRadius: 10, display: "flex", alignItems: "center", gap: 8,
          }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={showTrash ? "#9B1C1C" : "#9A948D"} strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round"><path d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13"/></svg>
          {showTrash ? "Hide Trash" : "Trash"}
        </button>
      </div>

      {showUpload && (
        <div style={{ background: "#fff", border: "1px solid var(--border)", borderRadius: 14, padding: 24, marginBottom: 26, boxShadow: "0 2px 10px rgba(20,18,16,0.04)" }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: "var(--text)", marginBottom: 18 }}>Upload new evidence</div>

          <div style={{ display: "flex", gap: 22, alignItems: "flex-end" }}>
            <div style={{ flex: 1 }}>
              <label style={{ display: "block", fontSize: 11.5, fontWeight: 700, color: "var(--muted)", letterSpacing: "0.08em", marginBottom: 7 }}>PDF FILE</label>
              <input ref={inputRef} type="file" accept=".pdf" onChange={(e) => handleFileSelect(e.target.files?.[0] || null)} style={{ display: "none" }} />
              <button
                onClick={() => inputRef.current?.click()}
                style={{
                  width: "100%", height: 46, padding: "0 16px",
                  border: uploadFile ? "1.5px solid var(--primary)" : "1.5px dashed var(--border-light)",
                  borderRadius: 10, background: uploadFile ? "var(--primary-bg)" : "#FAFAF9",
                  fontSize: 14, fontWeight: 500, color: uploadFile ? "var(--text)" : "var(--muted)",
                  display: "flex", alignItems: "center", gap: 10, textAlign: "left", cursor: "pointer",
                  transition: "border-color 0.15s, background 0.15s",
                }}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={uploadFile ? "#9B1C1C" : "#9A948D"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/>
                </svg>
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {uploadFile ? uploadFile.name : "Choose PDF file..."}
                </span>
              </button>
            </div>
            <div>
              <label style={{ display: "block", fontSize: 11.5, fontWeight: 700, color: "var(--muted)", letterSpacing: "0.08em", marginBottom: 7 }}>FILE TYPE</label>
              <select value={resultType} onChange={(e) => setResultType(e.target.value as typeof resultType)}
                style={{
                  height: 46, padding: "0 14px", border: "1.5px solid var(--border-light)",
                  borderRadius: 10, background: "#fff", fontSize: 14, fontWeight: 500,
                  color: resultType ? "var(--text)" : "var(--muted)", minWidth: 200,
                }}
              >
                <option value="" disabled>Select type...</option>
                <option value="Records Found">Records Found</option>
                <option value="No Records">No Records</option>
              </select>
            </div>
          </div>

          {uploadPageCount > 0 && (
            <div style={{ marginTop: 14, fontSize: 13, color: "var(--text-secondary)", display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{
                background: "var(--primary-bg)", color: "var(--primary)", fontSize: 12, fontWeight: 700,
                padding: "3px 10px", borderRadius: 6,
              }}>
                {uploadPageCount} page{uploadPageCount !== 1 ? "s" : ""}
              </span>
              {resultType === "Records Found" && (
                <span style={{ color: "var(--muted)", fontSize: 12 }}>
                  Est. cost ~${(uploadPageCount * 0.02).toFixed(2)}
                </span>
              )}
            </div>
          )}

          <div style={{ marginTop: 22, paddingTop: 20, borderTop: "1px solid #ECEAE6", display: "flex", justifyContent: "flex-end" }}>
            <button
              onClick={handleUpload}
              disabled={uploading || !uploadFile || !resultType}
              style={{
                background: "#9B1C1C", color: "#fff", fontWeight: 700, fontSize: 14.5,
                padding: "12px 28px", border: "none", borderRadius: 10,
                display: "flex", alignItems: "center", gap: 9,
                boxShadow: "0 6px 16px rgba(155,28,28,0.22)",
                opacity: uploading || !uploadFile || !resultType ? 0.5 : 1,
              }}
            >
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 16V5M7 10l5-5 5 5"/><path d="M5 19h14"/></svg>
              {uploading ? "Uploading..." : "Upload & Process"}
            </button>
          </div>
        </div>
      )}

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 11, padding: "0 2px" }}>
        <div style={{ fontSize: 11.5, fontWeight: 700, color: "var(--muted)", letterSpacing: "0.10em" }}>EVIDENCE</div>
        <div style={{ fontSize: 12, color: "var(--muted)" }}>{includedCount} of {evidence.length} included in report</div>
      </div>

      {evidence.length === 0 ? (
        <div style={{ border: "1.5px dashed var(--border-light)", borderRadius: 12, padding: 40, textAlign: "center" }}>
          <p style={{ fontSize: 14, color: "var(--muted)", marginBottom: 4 }}>No evidence yet</p>
          <p style={{ fontSize: 12, color: "var(--muted-light)" }}>Upload evidence PDFs to get started</p>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
          {evidence.map((e, idx) => {
            const needsReview = e.resultType === "Records Found" && !e.hasListing;
            const isRecords = e.resultType === "Records Found";
            return (
              <div
                key={e.id}
                draggable
                onDragStart={() => handleDragStart(idx)}
                onDragOver={(ev) => handleDragOver(ev, idx)}
                onDrop={() => handleDrop(idx)}
                onDragEnd={() => { setDragIdx(null); setDragOverIdx(null); }}
                style={{
                  display: "flex", alignItems: "center", gap: 14,
                  padding: "15px 16px 15px 14px",
                  background: "#fff",
                  border: dragOverIdx === idx ? "1.5px solid var(--primary)" : "1px solid var(--border)",
                  borderRadius: 12, opacity: dragIdx === idx ? 0.5 : 1,
                  transition: "border-color 0.1s, opacity 0.1s",
                }}
              >
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#CBC5BD" strokeWidth="2" strokeLinecap="round" style={{ cursor: "grab", flexShrink: 0 }}><path d="M5 8h14M5 12h14M5 16h14"/></svg>

                <div
                  style={{ flex: 1, minWidth: 0, cursor: "pointer" }}
                  onClick={() => {
                    if (needsReview) onReview(e.id, e.fileName, e.pageCount);
                    else window.open(`/api/evidence/${e.id}/view`, "_blank");
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
                    <span style={{ fontWeight: 700, fontSize: 15, color: "var(--text)" }}>
                      {e.debtor || e.fileName}
                    </span>
                    {isRecords ? (
                      <span style={{ background: "var(--success-bg)", color: "var(--success)", fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 6 }}>
                        {e.recordCount} record{e.recordCount !== 1 ? "s" : ""}
                      </span>
                    ) : (
                      <span style={{ background: "#EFEEEC", color: "#7A756F", fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 6 }}>
                        No Records
                      </span>
                    )}
                    {needsReview && (
                      <span style={{
                        background: "var(--danger-bg)", color: "var(--danger)", fontSize: 11, fontWeight: 700,
                        padding: "2px 8px", borderRadius: 6, display: "flex", alignItems: "center", gap: 4,
                      }}>
                        <span style={{ width: 5, height: 5, borderRadius: "50%", background: "var(--danger)" }} />
                        Needs Review
                      </span>
                    )}
                  </div>
                  <div style={{ marginTop: 4, fontSize: 12.5, color: "var(--muted)" }}>
                    {e.searchType && <>{e.searchType} &middot; </>}
                    {e.jurisdiction && <>{e.jurisdiction} &middot; </>}
                    {e.thruDate && <>Thru {e.thruDate} &middot; </>}
                    {e.createdAt ? `Uploaded ${new Date(e.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}` : ""}
                  </div>
                </div>

                {needsReview ? (
                  <button
                    onClick={() => onReview(e.id, e.fileName, e.pageCount)}
                    style={{
                      background: "#9B1C1C", color: "#fff", fontWeight: 700, fontSize: 12.5,
                      padding: "7px 12px", border: "none", borderRadius: 8,
                      display: "flex", alignItems: "center", gap: 5, flexShrink: 0,
                    }}
                  >
                    Review
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M9 6l6 6-6 6"/></svg>
                  </button>
                ) : (
                  <button
                    onClick={() => window.open(`/api/evidence/${e.id}/view`, "_blank")}
                    style={{
                      background: "#fff", color: "var(--text-secondary)", fontWeight: 600, fontSize: 12.5,
                      padding: "7px 12px", border: "1px solid var(--border)", borderRadius: 8,
                      display: "flex", alignItems: "center", gap: 6, flexShrink: 0,
                    }}
                  >
                    Open
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#9A948D" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 5h5v5M19 5l-7 7M11 5H6a1 1 0 00-1 1v12a1 1 0 001 1h12a1 1 0 001-1v-5"/></svg>
                  </button>
                )}

                <button
                  onClick={() => handleDelete(e.id)}
                  title="Move to trash"
                  style={{
                    width: 34, height: 34, border: "1px solid var(--border)", borderRadius: 8,
                    background: "#fff", display: "flex", alignItems: "center", justifyContent: "center",
                    flexShrink: 0,
                  }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#9A948D" strokeWidth="2.2" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>
                </button>

                <div
                  onClick={() => handleToggleInclude(e.id, !e.included)}
                  style={{
                    width: 24, height: 24, borderRadius: 7, flexShrink: 0, cursor: "pointer",
                    background: e.included ? "#9B1C1C" : "#fff",
                    border: e.included ? "none" : "1.5px solid var(--border-light)",
                    display: "flex", alignItems: "center", justifyContent: "center",
                  }}
                >
                  {e.included && (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12l4 4L19 6"/></svg>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {showTrash && (
        <div style={{ marginTop: 34 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12, padding: "0 2px" }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--muted)" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round"><path d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13"/></svg>
            <div style={{ fontSize: 11.5, fontWeight: 700, color: "var(--muted)", letterSpacing: "0.10em" }}>TRASH</div>
            <span style={{ fontSize: 11, color: "var(--muted-light)" }}>&middot; deleted items are kept permanently</span>
          </div>
          {trash.length === 0 ? (
            <p style={{ fontSize: 13, color: "var(--muted)", padding: 20, textAlign: "center" }}>Trash is empty</p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
              {trash.map((e) => (
                <div key={e.id} style={{
                  display: "flex", alignItems: "center", gap: 14, padding: "14px 16px",
                  background: "#FAF9F7", border: "1px dashed #D9D5CF", borderRadius: 12,
                }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#BCB6AE" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}><path d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13"/></svg>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 14, color: "#8A857E", textDecoration: "line-through" }}>{e.debtor || e.fileName}</div>
                    <div style={{ marginTop: 3, fontSize: 12, color: "var(--muted-light)" }}>
                      Deleted {e.deletedAt ? new Date(e.deletedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : ""}
                    </div>
                  </div>
                  <button
                    onClick={() => handleRestore(e.id)}
                    style={{
                      background: "#fff", color: "#9B1C1C", fontWeight: 700, fontSize: 13,
                      padding: "8px 16px", border: "1px solid #E5DAD3", borderRadius: 9,
                      display: "flex", alignItems: "center", gap: 7,
                    }}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#9B1C1C" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 109-9 9 9 0 00-7 3.3M3 4v4h4"/></svg>
                    Restore
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
