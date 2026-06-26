import { useState, useEffect } from "react";
import { api } from "./api";
import type { Project } from "./api";

interface Props {
  onOpenProject: (id: string) => void;
}

export function ProjectsPage({ onOpenProject }: Props) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
  const exactMatch = projects.some((p) => p.name.toLowerCase() === q);

  async function handleCreate() {
    if (!query.trim() || exactMatch) return;
    setCreating(true);
    setError(null);
    try {
      const project = await api.createProject({ name: query.trim() });
      onOpenProject(project.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create project");
    } finally {
      setCreating(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key !== "Enter") return;
    if (filtered.length === 1) {
      onOpenProject(filtered[0].id);
    } else if (!exactMatch && query.trim()) {
      handleCreate();
    }
  }

  const subtitle = q
    ? filtered.length === 0
      ? "No projects match this name"
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

  return (
    <div>
      <div style={{ marginBottom: 22 }}>
        <div style={{ fontSize: 26, fontWeight: 800, color: "var(--text)", letterSpacing: "-0.02em" }}>Projects</div>
        <div style={{ fontSize: 13.5, color: "var(--text-secondary)", marginTop: 3 }}>{subtitle}</div>
      </div>

      <div style={{ position: "relative", marginBottom: q && !exactMatch && query.trim() ? 12 : 26 }}>
        <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke={q ? "#9B1C1C" : "#A39E97"} strokeWidth="2.2" strokeLinecap="round" style={{ position: "absolute", left: 18, top: "50%", transform: "translateY(-50%)", pointerEvents: "none" }}>
          <circle cx="11" cy="11" r="7"/><path d="M21 21l-4.2-4.2"/>
        </svg>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Search or create a project…"
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

      {error && (
        <div style={{ padding: "8px 12px", background: "var(--danger-bg)", color: "var(--danger)", borderRadius: 8, fontSize: 13, marginBottom: 12 }}>
          {error}
        </div>
      )}

      {query.trim() && !exactMatch && (
        <button
          onClick={handleCreate}
          disabled={creating}
          style={{
            width: "100%", height: 54, background: "#9B1C1C", color: "#fff",
            fontWeight: 700, fontSize: 15, border: "none", borderRadius: 12,
            display: "flex", alignItems: "center", justifyContent: "center", gap: 9,
            boxShadow: "0 6px 16px rgba(155,28,28,0.22)", letterSpacing: "0.01em",
            opacity: creating ? 0.7 : 1, marginBottom: 22,
          }}
        >
          {creating ? "Creating..." : (
            <>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round"><path d="M12 5v14M5 12h14"/></svg>
              Create &ldquo;{query.trim()}&rdquo;
            </>
          )}
        </button>
      )}

      {filtered.length === 0 && !query.trim() ? (
        <div style={{ border: "1.5px dashed var(--border-light)", borderRadius: 12, padding: 30, textAlign: "center" }}>
          <div style={{ fontSize: 13.5, color: "var(--muted)" }}>
            No projects yet. Type a name above to create one.
          </div>
        </div>
      ) : filtered.length === 0 && query.trim() ? (
        <div style={{ border: "1.5px dashed var(--border-light)", borderRadius: 12, padding: 30, textAlign: "center" }}>
          <div style={{ fontSize: 13.5, color: "var(--muted)" }}>
            No existing projects match. Press <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 12, background: "#EFEEEC", padding: "1px 6px", borderRadius: 5, color: "var(--text-secondary)" }}>Enter</span> or click <span style={{ color: "#9B1C1C", fontWeight: 600 }}>Create</span> to start a new one.
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
