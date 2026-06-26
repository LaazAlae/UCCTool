import { useState, useEffect, useRef } from "react";
import { api } from "./api";
import type { Evidence, Project } from "./api";

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

  // Upload state
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [resultType, setResultType] = useState<"Records Found" | "No Records" | "">("");
  const [uploading, setUploading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);


  // Drag state
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
    if (!uploadFile) return;
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
        return {
          ...prev,
          evidence: prev.evidence.map((e) => e.id === jobId ? { ...e, included } : e),
        };
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

  // Drag & drop reorder
  function handleDragStart(idx: number) {
    setDragIdx(idx);
  }

  function handleDragOver(e: React.DragEvent, idx: number) {
    e.preventDefault();
    setDragOverIdx(idx);
  }

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
    <div style={{ maxWidth: 800, margin: "0 auto" }}>
      {/* Project header */}
      <div style={{ marginBottom: 20 }}>
        <h2 style={{ fontSize: 18, fontWeight: 700 }}>{project.name}</h2>
        <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>
          {project.preparedFor && <span>{project.preparedFor.split("\n")[0]} · </span>}
          {project.clientMatter && <span>Matter #{project.clientMatter} · </span>}
          {evidence.length} evidence
        </div>
      </div>

      {error && (
        <div style={{ padding: "8px 12px", background: "rgba(220,38,38,0.08)", color: "var(--danger)", borderRadius: 6, fontSize: 13, marginBottom: 12 }}>
          {error}
          <button onClick={() => setError(null)} style={{ float: "right", background: "none", border: "none", color: "var(--danger)", cursor: "pointer" }}>x</button>
        </div>
      )}

      {/* Action bar */}
      <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
        <button onClick={() => { setShowUpload(!showUpload); setResultType(""); setUploadFile(null); }} style={btnStyle}>
          {showUpload ? "Cancel Upload" : "Upload Evidence"}
        </button>
        <button
          onClick={handleCompile}
          disabled={compiling || includedCount === 0}
          style={{
            ...btnStyle,
            background: compiling || includedCount === 0 ? "var(--border)" : "var(--success)",
            color: "white", borderColor: "transparent",
            opacity: compiling || includedCount === 0 ? 0.6 : 1,
          }}
        >
          {compiling ? "Compiling..." : `Compile Report (${includedCount})`}
        </button>
        <button onClick={handleShowTrash} style={{ ...btnStyle, marginLeft: "auto" }}>
          {showTrash ? "Hide Trash" : "Trash"}
        </button>
      </div>

      {/* Upload panel */}
      {showUpload && (
        <div style={{ padding: 16, marginBottom: 16, border: "1px solid var(--border)", borderRadius: 8, background: "var(--surface)" }}>
          <div style={{ display: "flex", gap: 12, alignItems: "flex-end" }}>
            <div style={{ flex: 1 }}>
              <label style={{ fontSize: 12, color: "var(--muted)", display: "block", marginBottom: 4 }}>PDF File</label>
              <input ref={inputRef} type="file" accept=".pdf" onChange={(e) => setUploadFile(e.target.files?.[0] || null)} style={{ fontSize: 13 }} />
            </div>
            <div>
              <label style={{ fontSize: 12, color: "var(--muted)", display: "block", marginBottom: 4 }}>Result</label>
              <select value={resultType} onChange={(e) => setResultType(e.target.value as "Records Found" | "No Records" | "")} style={{ padding: "6px 10px", border: "1px solid var(--border)", borderRadius: 5, fontSize: 13 }}>
                <option value="" disabled>Select type...</option>
                <option value="Records Found">Records Found</option>
                <option value="No Records">No Records</option>
              </select>
            </div>
            <button
              onClick={handleUpload}
              disabled={uploading || !uploadFile || !resultType}
              style={{
                padding: "8px 20px", background: "var(--primary)", color: "white",
                border: "none", borderRadius: 6, fontWeight: 500,
                opacity: uploading || !uploadFile || !resultType ? 0.5 : 1,
                cursor: uploading || !uploadFile || !resultType ? "default" : "pointer",
              }}
            >
              {uploading ? "Uploading..." : "Upload"}
            </button>
          </div>
        </div>
      )}

      {/* Evidence list */}
      {evidence.length === 0 ? (
        <div style={{ textAlign: "center", padding: 50, color: "var(--muted)", border: "1px dashed var(--border)", borderRadius: 8 }}>
          <p style={{ fontSize: 14, marginBottom: 4 }}>No evidence yet</p>
          <p style={{ fontSize: 12 }}>Upload evidence PDFs to get started</p>
        </div>
      ) : (
        <div style={{ display: "grid", gap: 6 }}>
          {evidence.map((e, idx) => (
            <div
              key={e.id}
              draggable
              onDragStart={() => handleDragStart(idx)}
              onDragOver={(ev) => handleDragOver(ev, idx)}
              onDrop={() => handleDrop(idx)}
              onDragEnd={() => { setDragIdx(null); setDragOverIdx(null); }}
              style={{
                display: "flex", alignItems: "center", gap: 10,
                padding: "10px 14px",
                border: `1px solid ${dragOverIdx === idx ? "var(--primary)" : "var(--border)"}`,
                borderRadius: 8, background: "var(--surface)",
                opacity: dragIdx === idx ? 0.5 : 1,
                transition: "border-color 0.1s, opacity 0.1s",
              }}
            >
              {/* Drag handle */}
              <div style={{ cursor: "grab", color: "var(--muted)", fontSize: 16, lineHeight: 1, userSelect: "none", padding: "0 4px" }} title="Drag to reorder">
                ≡
              </div>

              {/* Info */}
              <div
                style={{ flex: 1, cursor: "pointer", minWidth: 0 }}
                onClick={() => {
                  if (e.resultType === "Records Found" && !e.hasListing) {
                    onReview(e.id, e.fileName, e.pageCount);
                  } else {
                    window.open(`/api/evidence/${e.id}/view`, "_blank");
                  }
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ fontWeight: 600, fontSize: 13 }}>
                    {e.debtor || e.fileName}
                  </span>
                  <span style={{
                    fontSize: 10, padding: "1px 6px", borderRadius: 3, fontWeight: 600,
                    background: e.resultType === "Records Found" ? "rgba(22,163,74,0.1)" : "rgba(107,114,128,0.1)",
                    color: e.resultType === "Records Found" ? "var(--success)" : "var(--muted)",
                  }}>
                    {e.resultType === "Records Found" ? `${e.recordCount} record${e.recordCount !== 1 ? "s" : ""}` : "No Records"}
                  </span>
                  {e.resultType === "Records Found" && !e.hasListing && (
                    <span style={{ fontSize: 10, padding: "1px 6px", borderRadius: 3, fontWeight: 600, background: "rgba(220,38,38,0.1)", color: "var(--danger)" }}>
                      Needs Review
                    </span>
                  )}
                </div>
                <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>
                  {e.searchType && <span>{e.searchType} · </span>}
                  {e.jurisdiction && <span>{e.jurisdiction} · </span>}
                  {e.thruDate && <span>{e.thruDate} · </span>}
                  {new Date(e.createdAt).toLocaleDateString()}
                </div>
              </div>

              {/* Delete */}
              <button
                onClick={() => handleDelete(e.id)}
                title="Move to trash"
                style={{
                  width: 28, height: 28, border: "1px solid var(--border)", borderRadius: 5,
                  background: "white", color: "var(--muted)", fontSize: 14, cursor: "pointer",
                }}
              >
                ×
              </button>

              {/* Include checkbox */}
              <label style={{ display: "flex", alignItems: "center", gap: 4, cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={e.included}
                  onChange={(ev) => handleToggleInclude(e.id, ev.target.checked)}
                  style={{ width: 18, height: 18, cursor: "pointer" }}
                />
              </label>
            </div>
          ))}
        </div>
      )}

      {/* Trash panel */}
      {showTrash && (
        <div style={{ marginTop: 20 }}>
          <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 8, color: "var(--muted)" }}>Trash</h3>
          {trash.length === 0 ? (
            <p style={{ fontSize: 13, color: "var(--muted)", padding: 16, textAlign: "center" }}>Trash is empty</p>
          ) : (
            <div style={{ display: "grid", gap: 6 }}>
              {trash.map((e) => (
                <div key={e.id} style={{
                  display: "flex", alignItems: "center", gap: 10, padding: "10px 14px",
                  border: "1px dashed var(--border)", borderRadius: 8, background: "#f9fafb", opacity: 0.7,
                }}>
                  <div style={{ flex: 1 }}>
                    <span style={{ fontSize: 13 }}>{e.debtor || e.fileName}</span>
                    <span style={{ fontSize: 11, color: "var(--muted)", marginLeft: 8 }}>
                      {e.searchType} · Deleted {e.deletedAt ? new Date(e.deletedAt).toLocaleDateString() : ""}
                    </span>
                  </div>
                  <button
                    onClick={() => handleRestore(e.id)}
                    style={{
                      padding: "4px 14px", background: "white", color: "var(--primary)",
                      border: "1px solid var(--primary)", borderRadius: 5, fontSize: 12,
                      fontWeight: 500, cursor: "pointer",
                    }}
                  >
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

const btnStyle: React.CSSProperties = {
  padding: "8px 16px", background: "white", color: "var(--text)",
  border: "1px solid var(--border)", borderRadius: 6, fontWeight: 500,
  fontSize: 13, cursor: "pointer",
};

