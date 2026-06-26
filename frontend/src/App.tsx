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

  const backLabel = route.page === "review" ? "Back to Project" : "All Projects";
  const backTarget = route.page === "review" && "projectId" in route
    ? `#/project/${route.projectId}`
    : "#/";

  return (
    <div style={{ height: "100vh", display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <div style={{
        height: 60, flexShrink: 0, background: "#9B1C1C", display: "flex", alignItems: "center",
        justifyContent: "space-between", padding: "0 28px",
      }}>
        <div
          onClick={() => navigate("#/")}
          style={{ display: "flex", alignItems: "center", gap: 13, cursor: "pointer" }}
        >
          <img src="/ucs-logo.png" alt="UCS" style={{ height: 34, width: 34, objectFit: "contain" }} />
          <div style={{ display: "flex", flexDirection: "column", lineHeight: 1 }}>
            <div style={{ color: "#fff", fontWeight: 800, fontSize: 18, letterSpacing: "-0.01em" }}>
              UCC Reporting Tool
            </div>
            <div style={{
              color: "#F0B9B9", fontWeight: 600, fontSize: 10.5,
              letterSpacing: "0.16em", marginTop: 5,
            }}>
              UCC MADE FASTER
            </div>
          </div>
        </div>

        {route.page !== "projects" && (
          <button
            onClick={() => navigate(backTarget)}
            style={{
              background: "rgba(255,255,255,0.10)", border: "1px solid rgba(255,255,255,0.34)",
              color: "#fff", fontWeight: 600, fontSize: 13, padding: "8px 15px 8px 12px",
              borderRadius: 9, display: "flex", alignItems: "center", gap: 7,
            }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 6l-6 6 6 6"/></svg>
            {backLabel}
          </button>
        )}
      </div>

      <div style={{
        background: "var(--bg)",
        padding: route.page === "review" ? 0 : "34px 0 46px",
        flex: 1,
        minHeight: 0,
        overflow: route.page === "review" ? "hidden" : "auto",
        display: route.page === "review" ? "flex" : undefined,
      }}>
        <div style={{
          maxWidth: route.page === "review" ? 1500 : 1160,
          margin: route.page === "review" ? "auto" : "0 auto",
          padding: route.page === "review" ? 0 : "0 48px",
          width: "100%",
          height: route.page === "review" ? "100%" : undefined,
        }}>
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
      </div>
    </div>
  );
}
