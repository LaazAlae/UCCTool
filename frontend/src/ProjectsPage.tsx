import { useState, useEffect, useRef } from "react";
import { api } from "./api";
import type { Project } from "./api";

interface Props {
  onOpenProject: (id: string) => void;
}

type UploadStage = "idle" | "selected" | "processing";

export function ProjectsPage({ onOpenProject }: Props) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);

  const [uploadStage, setUploadStage] = useState<UploadStage>("idle");
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [processingMsg, setProcessingMsg] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    (async () => {
      try {
        setProjects(await api.listProjects());
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load projects");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const q = query.trim().toLowerCase();
  const filtered = q ? projects.filter((p) => p.name.toLowerCase().includes(q)) : projects;

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && filtered.length === 1) {
      onOpenProject(filtered[0].id);
    }
  }

  function handleFileSelect(file: File | null) {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".pdf")) {
      setError("Only PDF files are accepted.");
      return;
    }
    setUploadFile(file);
    setUploadStage("selected");
    setError(null);
  }

  async function handleCreateFromSummary() {
    if (!uploadFile) return;
    setUploadStage("processing");
    setProcessingMsg("Scanning summary page...");
    setError(null);
    try {
      const timer = setTimeout(() => setProcessingMsg("Extracting project info with AI..."), 3000);
      const project = await api.createProjectFromSummary(uploadFile);
      clearTimeout(timer);
      onOpenProject(project.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create project");
      setUploadStage("selected");
    }
  }

  function handleCancelUpload() {
    setUploadFile(null);
    setUploadStage("idle");
    setError(null);
  }

  const subtitle = q
    ? filtered.length === 0
      ? "No projects match"
      : `${filtered.length} match${filtered.length !== 1 ? "es" : ""}${filtered.length === 1 ? " · press Enter to open" : ""}`
    : `Newest first · ${projects.length} active project${projects.length !== 1 ? "s" : ""}`;

  if (loading) {
    return (
      <div style={{ display: "flex", justifyContent: "center", alignItems: "center", height: 300, flexDirection: "column", gap: 12 }}>
        <div style={{ width: 36, height: 36, border: "3px solid var(--border)", borderTopColor: "var(--primary)", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
        <p style={{ color: "var(--muted)" }}>Loading projects...</p>
      </div>
    );
  }

  if (uploadStage === "processing") {
    return (
      <div style={{ display: "flex", justifyContent: "center", alignItems: "center", height: 400, flexDirection: "column", gap: 16 }}>
        <div style={{ width: 44, height: 44, border: "3px solid var(--border)", borderTopColor: "var(--primary)", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
        <p style={{ fontWeight: 600, fontSize: 16, color: "var(--text)" }}>Creating project...</p>
        <p style={{ fontSize: 13, color: "var(--muted)" }}>{processingMsg}</p>
        <p style={{ fontSize: 12, color: "var(--muted)" }}>{uploadFile?.name}</p>
      </div>
    );
  }

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 22 }}>
        <div>
          <div style={{ fontSize: 26, fontWeight: 800, color: "var(--text)", letterSpacing: "-0.02em" }}>Projects</div>
          <div style={{ fontSize: 13.5, color: "var(--text-secondary)", marginTop: 3 }}>{subtitle}</div>
        </div>
        <div>
          <input ref={inputRef} type="file" accept=".pdf" style={{ display: "none" }} onChange={(e) => { handleFileSelect(e.target.files?.[0] || null); e.target.value = ""; }} />
          <button
            onClick={() => inputRef.current?.click()}
            style={{
              background: "#9B1C1C", color: "#fff", fontWeight: 700, fontSize: 14,
              padding: "11px 20px", border: "none", borderRadius: 10,
              display: "flex", alignItems: "center", gap: 8,
              boxShadow: "0 6px 16px rgba(155,28,28,0.22)", cursor: "pointer",
            }}
          >
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round"><path d="M12 5v14M5 12h14"/></svg>
            New Project
          </button>
        </div>
      </div>

      {error && (
        <div style={{ padding: "8px 12px", background: "var(--danger-bg)", color: "var(--danger)", borderRadius: 8, fontSize: 13, marginBottom: 12, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          {error}
          <button onClick={() => setError(null)} style={{ background: "none", border: "none", color: "var(--danger)", fontSize: 16, padding: "0 4px", cursor: "pointer" }}>x</button>
        </div>
      )}

      {uploadStage === "selected" && uploadFile && (
        <div style={{ background: "#fff", border: "1.5px solid var(--primary)", borderRadius: 14, padding: 24, marginBottom: 22, boxShadow: "0 4px 14px rgba(155,28,28,0.10)" }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: "var(--text)", marginBottom: 14 }}>Upload Summary Page</div>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#9B1C1C" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/>
            </svg>
            <span style={{ fontWeight: 600, fontSize: 14, color: "var(--text)", flex: 1 }}>{uploadFile.name}</span>
            <span style={{ fontSize: 12, color: "var(--muted)" }}>{(uploadFile.size / 1024).toFixed(0)} KB</span>
          </div>
          <p style={{ fontSize: 12, color: "var(--muted)", marginTop: 10 }}>
            The summary page will be scanned and all project info + evidence lines will be extracted automatically.
          </p>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 16, paddingTop: 16, borderTop: "1px solid var(--border)" }}>
            <button onClick={handleCancelUpload} style={{ padding: "10px 18px", background: "#fff", color: "var(--text-secondary)", fontWeight: 600, fontSize: 14, border: "1px solid var(--border)", borderRadius: 10, cursor: "pointer" }}>Cancel</button>
            <button onClick={handleCreateFromSummary} style={{
              padding: "10px 24px", background: "#9B1C1C", color: "#fff", fontWeight: 700, fontSize: 14,
              border: "none", borderRadius: 10, boxShadow: "0 6px 16px rgba(155,28,28,0.22)",
              display: "flex", alignItems: "center", gap: 8, cursor: "pointer",
            }}>
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 16V5M7 10l5-5 5 5"/><path d="M5 19h14"/></svg>
              Create Project
            </button>
          </div>
        </div>
      )}

      <div style={{ position: "relative", marginBottom: 26 }}>
        <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke={q ? "#9B1C1C" : "#A39E97"} strokeWidth="2.2" strokeLinecap="round" style={{ position: "absolute", left: 18, top: "50%", transform: "translateY(-50%)", pointerEvents: "none" }}>
          <circle cx="11" cy="11" r="7"/><path d="M21 21l-4.2-4.2"/>
        </svg>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Search projects..."
          autoFocus
          style={{
            width: "100%", height: 54, padding: "0 18px 0 48px", fontSize: 15,
            fontFamily: "inherit", color: "var(--text)",
            border: q ? "1.5px solid #9B1C1C" : "1.5px solid var(--border-light)",
            borderRadius: 12, background: "#fff",
            boxShadow: q ? "0 0 0 3px rgba(155,28,28,0.12)" : "var(--shadow-sm)",
            outline: "none", transition: "border-color 0.15s, box-shadow 0.15s",
          }}
        />
      </div>

      {filtered.length === 0 ? (
        <div style={{ border: "1.5px dashed var(--border-light)", borderRadius: 12, padding: 30, textAlign: "center" }}>
          <div style={{ fontSize: 13.5, color: "var(--muted)" }}>
            {q ? "No projects match your search." : "No projects yet. Click \"New Project\" to upload a summary page."}
          </div>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {filtered.map((p) => {
            const isMatch = q && filtered.length === 1;
            return (
              <div
                key={p.id}
                onClick={() => onOpenProject(p.id)}
                style={{
                  display: "flex", alignItems: "center", gap: 16, padding: "17px 20px",
                  background: "#fff", border: isMatch ? "1.5px solid #9B1C1C" : "1px solid var(--border)",
                  borderRadius: 12, cursor: "pointer", transition: "border-color 0.15s, box-shadow 0.15s",
                  boxShadow: isMatch ? "0 4px 14px rgba(155,28,28,0.10)" : "var(--shadow-sm)",
                }}
                onMouseEnter={(e) => { if (!isMatch) e.currentTarget.style.borderColor = "#9B1C1C"; }}
                onMouseLeave={(e) => { if (!isMatch) e.currentTarget.style.borderColor = "var(--border)"; }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <span style={{ fontWeight: 700, fontSize: 16, color: "var(--text)" }}>{p.name}</span>
                    {(p.evidenceCount ?? 0) > 0 && (
                      <span style={{
                        background: isMatch ? "#FBECEC" : "#F1EFEC",
                        color: isMatch ? "#9B1C1C" : "var(--text-secondary)",
                        fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 20,
                        letterSpacing: "0.02em",
                      }}>
                        {p.evidenceCount} evidence
                      </span>
                    )}
                  </div>
                  <div style={{ marginTop: 5, fontSize: 13, color: "var(--text-secondary)" }}>
                    {p.preparedFor && <>{p.preparedFor.split("\n")[0]} &nbsp;&middot;&nbsp; </>}
                    {p.clientMatter && <><span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 12 }}>#{p.clientMatter}</span> &nbsp;&middot;&nbsp; </>}
                    {p.createdAt && <>Created {new Date(p.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</>}
                  </div>
                </div>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={isMatch ? "#9B1C1C" : "#C2BCB4"} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 6l6 6-6 6"/></svg>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
