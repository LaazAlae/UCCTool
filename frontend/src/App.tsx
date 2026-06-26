import { useState, useEffect } from "react";
import { ProjectsPage } from "./ProjectsPage";
import { ProjectDetailPage } from "./ProjectDetailPage";
import { ReviewPage } from "./ReviewPage";

type Route =
  | { page: "projects" }
  | { page: "project"; projectId: string }
  | { page: "review"; projectId: string; jobId: string; fileName: string; pageCount: number };

function parseHash(): Route {
  const hash = window.location.hash.slice(1) || "/";
  const parts = hash.split("/").filter(Boolean);

  if (parts[0] === "project" && parts[1] && parts[2] === "review" && parts[3]) {
    return { page: "review", projectId: parts[1], jobId: parts[3], fileName: "", pageCount: 0 };
  }
  if (parts[0] === "project" && parts[1]) {
    return { page: "project", projectId: parts[1] };
  }
  return { page: "projects" };
}

export function App() {
  const [route, setRoute] = useState<Route>(parseHash);

  useEffect(() => {
    const onHash = () => setRoute(parseHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  function navigate(hash: string) {
    window.location.hash = hash;
  }

  return (
    <div style={{ maxWidth: 1400, margin: "0 auto", padding: "20px 24px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
        <h1
          onClick={() => navigate("#/")}
          style={{ fontSize: 18, fontWeight: 700, cursor: "pointer" }}
        >
          UCC Reporting Tool
        </h1>
        {route.page !== "projects" && (
          <button
            onClick={() => {
              if (route.page === "review") navigate(`#/project/${route.projectId}`);
              else navigate("#/");
            }}
            style={{
              fontSize: 13, color: "var(--muted)", background: "none",
              border: "1px solid var(--border)", borderRadius: 6, padding: "4px 12px",
            }}
          >
            {route.page === "review" ? "Back to Project" : "All Projects"}
          </button>
        )}
      </div>

      {route.page === "projects" && (
        <ProjectsPage onOpenProject={(id) => navigate(`#/project/${id}`)} />
      )}

      {route.page === "project" && (
        <ProjectDetailPage
          projectId={route.projectId}
          onReview={(jobId, fileName, pageCount) => {
            navigate(`#/project/${route.projectId}/review/${jobId}`);
            setRoute({ page: "review", projectId: route.projectId, jobId, fileName, pageCount });
          }}
        />
      )}

      {route.page === "review" && (
        <ReviewPage
          jobId={route.jobId}
          fileName={route.fileName}
          pageCount={route.pageCount}
          projectId={route.projectId}
          onDone={() => navigate(`#/project/${route.projectId}`)}
        />
      )}
    </div>
  );
}
