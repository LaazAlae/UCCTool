import { useState } from "react";
import { UploadPage } from "./UploadPage";
import { ReviewPage } from "./ReviewPage";

interface Job {
  jobId: string;
  fileName: string;
  pageCount: number;
}

export function App() {
  const [job, setJob] = useState<Job | null>(null);

  return (
    <div style={{ maxWidth: 1400, margin: "0 auto", padding: "20px 24px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
        <h1 style={{ fontSize: 18, fontWeight: 700 }}>UCC Reporting Tool</h1>
        {job && (
          <button
            onClick={() => setJob(null)}
            style={{
              fontSize: 13,
              color: "var(--muted)",
              background: "none",
              border: "1px solid var(--border)",
              borderRadius: 6,
              padding: "4px 12px",
            }}
          >
            New Upload
          </button>
        )}
      </div>

      {job ? (
        <ReviewPage jobId={job.jobId} fileName={job.fileName} pageCount={job.pageCount} />
      ) : (
        <UploadPage onUploaded={setJob} />
      )}
    </div>
  );
}
