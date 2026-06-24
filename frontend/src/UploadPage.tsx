import { useState, useRef } from "react";
import { api } from "./api";

interface Props {
  onUploaded: (job: { jobId: string; fileName: string; pageCount: number }) => void;
}

export function UploadPage({ onUploaded }: Props) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleFile(file: File) {
    if (!file.name.toLowerCase().endsWith(".pdf")) {
      setError("Only PDF files are accepted");
      return;
    }
    setUploading(true);
    setError(null);
    try {
      const result = await api.upload(file);
      onUploaded(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        const file = e.dataTransfer.files[0];
        if (file) handleFile(file);
      }}
      onClick={() => inputRef.current?.click()}
      style={{
        maxWidth: 500,
        margin: "80px auto",
        padding: 48,
        border: `2px dashed ${dragOver ? "var(--primary)" : "var(--border)"}`,
        borderRadius: 12,
        textAlign: "center",
        cursor: "pointer",
        background: dragOver ? "rgba(37, 99, 235, 0.04)" : "var(--surface)",
        transition: "all 0.15s",
      }}
    >
      <input
        ref={inputRef}
        type="file"
        accept=".pdf"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleFile(file);
        }}
      />

      {uploading ? (
        <>
          <div style={{
            width: 36, height: 36, margin: "0 auto 12px",
            border: "3px solid var(--border)", borderTopColor: "var(--primary)",
            borderRadius: "50%", animation: "spin 0.8s linear infinite",
          }} />
          <p style={{ color: "var(--muted)" }}>Uploading...</p>
        </>
      ) : (
        <>
          <p style={{ fontSize: 16, fontWeight: 500, marginBottom: 8 }}>
            Drop evidence PDF here
          </p>
          <p style={{ fontSize: 13, color: "var(--muted)" }}>or click to browse</p>
        </>
      )}

      {error && (
        <p style={{ color: "var(--danger)", fontSize: 13, marginTop: 12 }}>{error}</p>
      )}
    </div>
  );
}
