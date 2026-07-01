import { useState, useEffect, useRef } from "react";
import { api } from "./api";
import type { Evidence, Project } from "./api";
import { PdfModal } from "./PdfModal";

interface Props {
  projectId: string;
  onReview: (jobId: string, fileName: string, pageCount: number) => void;
}

interface DebtorGroup {
  debtor: string;
  items: Evidence[];
}

function groupByDebtor(evidence: Evidence[]): DebtorGroup[] {
  const map = new Map<string, Evidence[]>();
  for (const e of evidence) {
    const key = e.debtor || "";
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(e);
  }
  const groups: DebtorGroup[] = [];
  for (const [debtor, items] of map) {
    if (debtor) groups.push({ debtor, items });
  }
  const unknown = map.get("");
  if (unknown) groups.push({ debtor: "", items: unknown });
  return groups;
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
  const inputRef = useRef<HTMLInputElement>(null);

  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [pdfModal, setPdfModal] = useState<{ url: string; title: string; downloadName: string } | null>(null);

  const [dragDebtor, setDragDebtor] = useState<string | null>(null);
  const [dragLocalIdx, setDragLocalIdx] = useState<number | null>(null);
  const [dragOverLocalIdx, setDragOverLocalIdx] = useState<number | null>(null);

  // Per-row evidence upload for Records Found placeholders
  const [pendingUploadJobId, setPendingUploadJobId] = useState<string | null>(null);
  const [rowUploading, setRowUploading] = useState<string | null>(null);
  const evidenceInputRef = useRef<HTMLInputElement>(null);

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

  function handleRowUploadClick(jobId: string) {
    setPendingUploadJobId(jobId);
    if (evidenceInputRef.current) {
      evidenceInputRef.current.value = "";
      evidenceInputRef.current.click();
    }
  }

  async function handleRowFileSelect(file: File | null) {
    if (!file || !pendingUploadJobId) return;
    setRowUploading(pendingUploadJobId);
    setError(null);
    try {
      const res = await api.uploadEvidencePdf(projectId, pendingUploadJobId, file);
      onReview(res.jobId, res.fileName, res.pageCount);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setRowUploading(null);
      setPendingUploadJobId(null);
    }
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

  function handleViewPdf(e: Evidence) {
    if (!e.hasPdf) {
      setPdfModal({
        url: "about:blank",
        title: `${e.searchType || "No Records"} — ${e.debtor || "Unknown"}`,
        downloadName: "",
      });
      return;
    }
    const needsReview = e.resultType === "Records Found" && !e.hasListing;
    if (needsReview) {
      onReview(e.id, e.fileName, e.pageCount);
    } else {
      setPdfModal({
        url: api.evidenceViewUrl(e.id),
        title: e.debtor || e.fileName,
        downloadName: e.fileName,
      });
    }
  }

  function toggleCollapse(debtor: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(debtor)) next.delete(debtor);
      else next.add(debtor);
      return next;
    });
  }

  function handleDragStart(debtor: string, localIdx: number) {
    setDragDebtor(debtor);
    setDragLocalIdx(localIdx);
  }

  function handleDragOver(ev: React.DragEvent, debtor: string, localIdx: number) {
    ev.preventDefault();
    if (debtor === dragDebtor) setDragOverLocalIdx(localIdx);
  }

  async function handleDrop(debtor: string, localIdx: number) {
    if (dragLocalIdx === null || dragDebtor !== debtor || !project) return;

    const groups = groupByDebtor(project.evidence);
    const group = groups.find((g) => g.debtor === debtor);
    if (!group) return;

    const reordered = [...group.items];
    const [moved] = reordered.splice(dragLocalIdx, 1);
    reordered.splice(localIdx, 0, moved);

    const newFlat: Evidence[] = [];
    for (const g of groups) {
      newFlat.push(...(g.debtor === debtor ? reordered : g.items));
    }

    setProject({ ...project, evidence: newFlat });
    setDragLocalIdx(null);
    setDragOverLocalIdx(null);
    setDragDebtor(null);

    try {
      await api.reorderEvidence(projectId, newFlat.map((e) => e.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Reorder failed");
      await reload();
    }
  }

  function handleDragEnd() {
    setDragLocalIdx(null);
    setDragOverLocalIdx(null);
    setDragDebtor(null);
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
  const hasIncludedNeedsReview = evidence.some((e) => e.included && e.resultType === "Records Found" && !e.hasListing);
  const hasIncludedNeedsPdf = evidence.some((e) => e.included && e.resultType === "Records Found" && !e.hasPdf);
  const canCompile = !compiling && includedCount > 0 && !hasIncludedNeedsReview && !hasIncludedNeedsPdf;
  const groups = groupByDebtor(evidence);

  const recordsFoundCount = evidence.filter((e) => e.resultType === "Records Found").length;
  const recordsFoundUploaded = evidence.filter((e) => e.resultType === "Records Found" && e.hasPdf).length;
  const recordsFoundReviewed = evidence.filter((e) => e.resultType === "Records Found" && e.hasListing).length;

  return (
    <div>
      {/* Hidden file input for per-row evidence uploads */}
      <input ref={evidenceInputRef} type="file" accept=".pdf" style={{ display: "none" }}
        onChange={(e) => { handleRowFileSelect(e.target.files?.[0] || null); e.target.value = ""; }} />

      <div style={{ marginBottom: 24 }}>
        <div style={{ fontSize: 25, fontWeight: 800, color: "var(--text)", letterSpacing: "-0.02em" }}>{project.name}</div>
        <div style={{ marginTop: 6, fontSize: 13.5, color: "var(--text-secondary)" }}>
          {project.preparedFor && <>{project.preparedFor.split("\n")[0]} &nbsp;&middot;&nbsp; </>}
          {project.clientMatter && <>Matter <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 12.5 }}>#{project.clientMatter}</span> &nbsp;&middot;&nbsp; </>}
          {evidence.length} evidence item{evidence.length !== 1 ? "s" : ""}
          {recordsFoundCount > 0 && (
            <> &nbsp;&middot;&nbsp; <span style={{ color: recordsFoundReviewed === recordsFoundCount ? "var(--success)" : "var(--text-secondary)" }}>
              {recordsFoundReviewed}/{recordsFoundCount} records reviewed
            </span></>
          )}
        </div>
      </div>

      {error && (
        <div style={{ padding: "10px 14px", background: "var(--danger-bg)", color: "var(--danger)", borderRadius: 8, fontSize: 13, marginBottom: 14, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          {error}
          <button onClick={() => setError(null)} style={{ background: "none", border: "none", color: "var(--danger)", fontSize: 16, padding: "0 4px", cursor: "pointer" }}>x</button>
        </div>
      )}

      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: showUpload ? 18 : 24 }}>
        <button
          onClick={() => { setShowUpload(!showUpload); setResultType(""); setUploadFile(null); }}
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
        <div style={{ position: "relative" }}>
          <button
            onClick={canCompile ? handleCompile : undefined}
            disabled={!canCompile}
            title={hasIncludedNeedsPdf ? "Upload evidence for all Records Found items" : hasIncludedNeedsReview ? "Review all included evidence before compiling" : undefined}
            style={{
              background: canCompile ? "var(--success)" : "var(--border)", color: "#fff",
              fontWeight: 700, fontSize: 14, padding: "11px 18px", border: "none", borderRadius: 10,
              display: "flex", alignItems: "center", gap: 8,
              boxShadow: canCompile ? "0 4px 12px rgba(21,128,61,0.20)" : "none",
              opacity: canCompile ? 1 : 0.6,
              cursor: canCompile ? "pointer" : "not-allowed",
            }}
          >
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12l4 4L19 6"/></svg>
            {compiling ? "Compiling..." : `Compile Report (${includedCount})`}
          </button>
        </div>
        {(hasIncludedNeedsReview || hasIncludedNeedsPdf) && (
          <span style={{ fontSize: 12, color: "var(--danger)", fontWeight: 600 }}>
            {hasIncludedNeedsPdf ? "Some items need evidence uploaded" : "Some included items need review"}
          </span>
        )}
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
              <input ref={inputRef} type="file" accept=".pdf" onChange={(e) => setUploadFile(e.target.files?.[0] || null)} style={{ display: "none" }} />
              <button
                onClick={() => inputRef.current?.click()}
                style={{
                  width: "100%", height: 46, padding: "0 16px",
                  border: uploadFile ? "1.5px solid var(--primary)" : "1.5px dashed var(--border-light)",
                  borderRadius: 10, background: uploadFile ? "var(--primary-bg)" : "#FAFAF9",
                  fontSize: 14, fontWeight: 500, color: uploadFile ? "var(--text)" : "var(--muted)",
                  display: "flex", alignItems: "center", gap: 10, textAlign: "left", cursor: "pointer",
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
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {groups.map((group) => {
            const groupKey = group.debtor || "__unknown__";
            const isCollapsed = collapsed.has(groupKey);
            const groupIncluded = group.items.filter((e) => e.included).length;
            const groupNeedsAction = group.items.some((e) => e.resultType === "Records Found" && (!e.hasPdf || !e.hasListing));

            return (
              <div key={groupKey}>
                <div
                  onClick={() => toggleCollapse(groupKey)}
                  style={{
                    display: "flex", alignItems: "center", gap: 10, padding: "8px 12px",
                    background: group.debtor ? "#fff" : "var(--warning-bg)",
                    border: `1px solid ${group.debtor ? "var(--border)" : "#D4C9A8"}`,
                    borderRadius: isCollapsed ? 10 : "10px 10px 0 0",
                    cursor: "pointer", userSelect: "none",
                  }}
                >
                  <svg
                    width="14" height="14" viewBox="0 0 24 24" fill="none"
                    stroke="var(--muted)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"
                    style={{ transform: isCollapsed ? "rotate(-90deg)" : "rotate(0deg)", transition: "transform 0.15s", flexShrink: 0 }}
                  >
                    <path d="M6 9l6 6 6-6" />
                  </svg>

                  <span style={{ fontWeight: 700, fontSize: 14, color: "var(--text)", flex: 1 }}>
                    {group.debtor || "Debtor Unknown"}
                  </span>

                  <span style={{ fontSize: 12, color: "var(--muted)", fontWeight: 600 }}>
                    {group.items.length} item{group.items.length !== 1 ? "s" : ""}
                  </span>

                  {groupNeedsAction && (
                    <span style={{
                      background: "var(--danger-bg)", color: "var(--danger)", fontSize: 10.5, fontWeight: 700,
                      padding: "2px 7px", borderRadius: 5, display: "flex", alignItems: "center", gap: 3,
                    }}>
                      <span style={{ width: 5, height: 5, borderRadius: "50%", background: "var(--danger)" }} />
                      Needs Action
                    </span>
                  )}

                  <span style={{ fontSize: 11, color: "var(--muted-light)" }}>
                    {groupIncluded}/{group.items.length} included
                  </span>
                </div>

                {!isCollapsed && (
                  <div style={{
                    border: `1px solid ${group.debtor ? "var(--border)" : "#D4C9A8"}`,
                    borderTop: "none",
                    borderRadius: "0 0 10px 10px",
                    overflow: "hidden",
                  }}>
                    {group.items.map((e, localIdx) => {
                      const isRecords = e.resultType === "Records Found";
                      const needsPdf = isRecords && !e.hasPdf;
                      const needsReview = isRecords && e.hasPdf && !e.hasListing;
                      const isDragging = dragDebtor === group.debtor && dragLocalIdx === localIdx;
                      const isDragOver = dragDebtor === group.debtor && dragOverLocalIdx === localIdx;
                      const isRowUploading = rowUploading === e.id;

                      return (
                        <div
                          key={e.id}
                          draggable
                          onDragStart={() => handleDragStart(group.debtor, localIdx)}
                          onDragOver={(ev) => handleDragOver(ev, group.debtor, localIdx)}
                          onDrop={() => handleDrop(group.debtor, localIdx)}
                          onDragEnd={handleDragEnd}
                          style={{
                            display: "flex", alignItems: "center", gap: 14,
                            padding: "13px 16px 13px 14px",
                            background: isDragOver ? "var(--primary-bg)" : needsPdf ? "#FFFBF5" : "#fff",
                            borderTop: localIdx > 0 ? "1px solid var(--border)" : "none",
                            opacity: isDragging ? 0.5 : 1,
                            transition: "background 0.1s, opacity 0.1s",
                          }}
                        >
                          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#CBC5BD" strokeWidth="2" strokeLinecap="round" style={{ cursor: "grab", flexShrink: 0 }}>
                            <path d="M5 8h14M5 12h14M5 16h14"/>
                          </svg>

                          <div
                            style={{ flex: 1, minWidth: 0, cursor: needsPdf ? "default" : "pointer" }}
                            onClick={() => { if (!needsPdf) handleViewPdf(e); }}
                          >
                            <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
                              <span style={{ fontWeight: 600, fontSize: 14, color: "var(--text)" }}>
                                {e.searchType || e.fileName}
                              </span>
                              {isRecords ? (
                                needsPdf ? (
                                  <span style={{ background: "#FEF3C7", color: "#92400E", fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 6 }}>
                                    Awaiting Upload
                                  </span>
                                ) : needsReview ? (
                                  <span style={{
                                    background: "var(--danger-bg)", color: "var(--danger)", fontSize: 11, fontWeight: 700,
                                    padding: "2px 8px", borderRadius: 6, display: "flex", alignItems: "center", gap: 4,
                                  }}>
                                    <span style={{ width: 5, height: 5, borderRadius: "50%", background: "var(--danger)" }} />
                                    Needs Review
                                  </span>
                                ) : (
                                  <span style={{ background: "var(--success-bg)", color: "var(--success)", fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 6 }}>
                                    {e.recordCount} record{e.recordCount !== 1 ? "s" : ""}
                                  </span>
                                )
                              ) : (
                                <span style={{ background: "#EFEEEC", color: "#7A756F", fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 6 }}>
                                  No Records
                                </span>
                              )}
                            </div>
                            <div style={{ marginTop: 3, fontSize: 12, color: "var(--muted)" }}>
                              {e.jurisdiction && <>{e.jurisdiction} &middot; </>}
                              {e.thruDate && <>Thru {e.thruDate}</>}
                            </div>
                          </div>

                          {needsPdf ? (
                            <button
                              onClick={() => handleRowUploadClick(e.id)}
                              disabled={isRowUploading}
                              style={{
                                background: "#9B1C1C", color: "#fff", fontWeight: 700, fontSize: 12.5,
                                padding: "7px 14px", border: "none", borderRadius: 8,
                                display: "flex", alignItems: "center", gap: 5, flexShrink: 0,
                                opacity: isRowUploading ? 0.6 : 1,
                              }}
                            >
                              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M12 16V5M7 10l5-5 5 5"/><path d="M5 19h14"/></svg>
                              {isRowUploading ? "Uploading..." : "Upload"}
                            </button>
                          ) : needsReview ? (
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
                              onClick={() => handleViewPdf(e)}
                              style={{
                                background: "#fff", color: "var(--text-secondary)", fontWeight: 600, fontSize: 12.5,
                                padding: "7px 12px", border: "1px solid var(--border)", borderRadius: 8,
                                display: "flex", alignItems: "center", gap: 6, flexShrink: 0,
                              }}
                            >
                              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#9A948D" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>
                              </svg>
                              View
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

      {pdfModal && (
        <PdfModal
          url={pdfModal.url}
          title={pdfModal.title}
          downloadName={pdfModal.downloadName}
          onClose={() => setPdfModal(null)}
        />
      )}
    </div>
  );
}
