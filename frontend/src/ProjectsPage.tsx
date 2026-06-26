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

  if (loading) {
    return (
      <div style={{ display: "flex", justifyContent: "center", alignItems: "center", height: 300, flexDirection: "column", gap: 12 }}>
        <div style={{ width: 36, height: 36, border: "3px solid var(--border)", borderTopColor: "var(--primary)", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
        <p style={{ color: "var(--muted)" }}>Loading projects...</p>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 700, margin: "0 auto" }}>
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Search or create project..."
        autoFocus
        style={{
          width: "100%", padding: "12px 16px", fontSize: 15, border: "1px solid var(--border)",
          borderRadius: 8, boxSizing: "border-box", marginBottom: 12, outline: "none",
        }}
        onFocus={(e) => (e.currentTarget.style.borderColor = "var(--primary)")}
        onBlur={(e) => (e.currentTarget.style.borderColor = "var(--border)")}
      />

      {error && (
        <div style={{ padding: "8px 12px", background: "rgba(220,38,38,0.08)", color: "var(--danger)", borderRadius: 6, fontSize: 13, marginBottom: 12 }}>
          {error}
        </div>
      )}

      {query.trim() && !exactMatch && (
        <button
          onClick={handleCreate}
          disabled={creating}
          style={{
            width: "100%", padding: "10px 16px", marginBottom: 12, background: "var(--primary)",
            color: "white", border: "none", borderRadius: 8, fontSize: 14, fontWeight: 500,
            cursor: creating ? "default" : "pointer", opacity: creating ? 0.6 : 1,
          }}
        >
          {creating ? "Creating..." : `Create "${query.trim()}"`}
        </button>
      )}

      {filtered.length === 0 && !query.trim() ? (
        <div style={{ textAlign: "center", padding: 60, color: "var(--muted)" }}>
          <p style={{ fontSize: 15, marginBottom: 8 }}>No projects yet</p>
          <p style={{ fontSize: 13 }}>Type a project name above to create one</p>
        </div>
      ) : filtered.length === 0 && query.trim() ? (
        <div style={{ textAlign: "center", padding: 40, color: "var(--muted)", fontSize: 13 }}>
          No matching projects
        </div>
      ) : (
        <div style={{ display: "grid", gap: 8 }}>
          {filtered.map((p) => (
            <div
              key={p.id}
              onClick={() => onOpenProject(p.id)}
              style={{
                padding: "14px 18px", border: "1px solid var(--border)", borderRadius: 8,
                background: "var(--surface)", cursor: "pointer", transition: "border-color 0.15s",
              }}
              onMouseEnter={(e) => (e.currentTarget.style.borderColor = "var(--primary)")}
              onMouseLeave={(e) => (e.currentTarget.style.borderColor = "var(--border)")}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 14 }}>{p.name}</div>
                  <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>
                    {p.preparedFor && <span>{p.preparedFor.split("\n")[0]} · </span>}
                    {p.evidenceCount ?? 0} evidence
                    {p.createdAt && <span> · Created {new Date(p.createdAt).toLocaleDateString()}</span>}
                  </div>
                </div>
                <span style={{ color: "var(--muted)", fontSize: 18 }}>›</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
