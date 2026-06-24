import { useState, useEffect } from "react";
import { api } from "./api";
import type { ExtractionResult, ListingEntry } from "./api";
import { PdfViewer } from "./PdfViewer";
import type { Highlight } from "./PdfViewer";
import { ListingForm } from "./ListingForm";

const FIELD_LABELS: Record<string, string> = {
  fileType: "File Type",
  entityName: "Entity Name",
  entityType: "Entity Type",
  fileNumber: "File/Case #",
  fileDate: "File Date",
  securedParty: "Secured Party",
};

interface Props {
  jobId: string;
  fileName: string;
  pageCount: number;
}

type Stage = "extracting" | "reviewing" | "error";

export function ReviewPage({ jobId, fileName, pageCount }: Props) {
  const [stage, setStage] = useState<Stage>("extracting");
  const [error, setError] = useState<string | null>(null);
  const [extractions, setExtractions] = useState<ExtractionResult[]>([]);
  const [entries, setEntries] = useState<ListingEntry[]>([]);
  const [saving, setSaving] = useState(false);
  const [activeField, setActiveField] = useState<string | null>(null);

  useEffect(() => { runExtraction(); }, [jobId]);

  async function runExtraction() {
    try {
      setStage("extracting");
      const res = await api.extract(jobId);
      setExtractions(res.extractions);
      setEntries(res.extractions.map((ext) => ({
        id: crypto.randomUUID(),
        fileType: ext.fileType.value,
        entityName: ext.entityName.value,
        entityType: ext.entityType.value,
        fileNumber: ext.fileNumber.value,
        fileDate: ext.fileDate.value,
        securedParty: ext.securedParty.value,
        confirmed: false,
      })));
      setStage("reviewing");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Extraction failed");
      setStage("error");
    }
  }

  function handleEntryChange(index: number, field: string, value: string) {
    const prev = entries[index]?.[field as keyof ListingEntry] as string;
    api.log(jobId, "field_edit", { record: index, field, from: prev, to: value });
    setEntries((e) => e.map((r, i) => i === index ? { ...r, [field]: value } : r));
  }

  function handleEntryConfirm(index: number) {
    const next = !entries[index]?.confirmed;
    api.log(jobId, next ? "record_confirm" : "record_unconfirm", { record: index });
    setEntries((e) => e.map((r, i) => i === index ? { ...r, confirmed: !r.confirmed } : r));
  }

  function handleEntityNameChange(value: string) {
    api.log(jobId, "entity_name_change", { value });
    setEntries((e) => e.map((r) => ({ ...r, entityName: value })));
  }

  function handleEntityTypeChange(value: string) {
    api.log(jobId, "entity_type_change", { value });
    setEntries((e) => e.map((r) => ({ ...r, entityType: value })));
  }

  function handleDeleteEntry(index: number) {
    api.log(jobId, "record_delete", { record: index });
    setEntries((e) => e.filter((_, i) => i !== index));
    setExtractions((e) => e.filter((_, i) => i !== index));
  }

  function handleFieldFocus(recordIndex: number, fieldKey: string) {
    setActiveField(`${recordIndex}-${fieldKey}`);
  }

  function handleHighlightClick(fieldKey: string) {
    const idx = parseInt(fieldKey.split("-")[0], 10);
    if (!isNaN(idx)) handleEntryConfirm(idx);
  }

  async function handleSave() {
    setSaving(true);
    try {
      await api.save(jobId, entries);
      api.log(jobId, "save_complete", { entries: entries.length });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  // Build highlights from extractions
  const highlights: Highlight[] = extractions.flatMap((ext, ri) =>
    (Object.keys(FIELD_LABELS) as (keyof ExtractionResult)[])
      .filter((key) => ext[key]?.boundingBox)
      .map((key) => ({
        fieldKey: `${ri}-${key}`,
        label: `#${ri + 1} ${FIELD_LABELS[key]}`,
        boundingBox: ext[key].boundingBox!,
        confirmed: entries[ri]?.confirmed || false,
      }))
  );

  if (stage === "extracting") {
    return (
      <div style={{ display: "flex", justifyContent: "center", alignItems: "center", height: 400, flexDirection: "column", gap: 16 }}>
        <div style={{ width: 40, height: 40, border: "3px solid var(--border)", borderTopColor: "var(--primary)", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
        <p style={{ color: "var(--muted)" }}>Analyzing evidence document...</p>
        <p style={{ fontSize: 13, color: "var(--muted)" }}>{fileName}</p>
      </div>
    );
  }

  if (stage === "error") {
    return (
      <div style={{ display: "flex", justifyContent: "center", alignItems: "center", height: 400, flexDirection: "column", gap: 12 }}>
        <p style={{ color: "var(--danger)", fontWeight: 500 }}>{error || "Something went wrong"}</p>
        <button onClick={runExtraction} style={{ padding: "8px 20px", background: "var(--primary)", color: "white", border: "none", borderRadius: 6 }}>
          Retry
        </button>
      </div>
    );
  }

  return (
    <div>
      <div style={{ marginBottom: 16, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <h2 style={{ fontSize: 16, fontWeight: 600 }}>{fileName}</h2>
          <p style={{ fontSize: 13, color: "var(--muted)" }}>
            {pageCount} page{pageCount !== 1 ? "s" : ""} &middot; {entries.length} record{entries.length !== 1 ? "s" : ""} found
          </p>
        </div>
      </div>

      {error && (
        <div style={{ padding: "8px 12px", background: "rgba(220,38,38,0.08)", color: "var(--danger)", borderRadius: 6, fontSize: 13, marginBottom: 12 }}>
          {error}
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 480px", gap: 16, height: "calc(100vh - 180px)" }}>
        <div style={{ background: "var(--surface)", borderRadius: "var(--radius)", border: "1px solid var(--border)", overflow: "hidden", display: "flex", flexDirection: "column" }}>
          <PdfViewer
            jobId={jobId}
            pageCount={pageCount}
            highlights={highlights}
            onHighlightClick={handleHighlightClick}
            activeField={activeField}
          />
        </div>

        <ListingForm
          extractions={extractions}
          entries={entries}
          onEntryChange={handleEntryChange}
          onEntryConfirm={handleEntryConfirm}
          onEntityNameChange={handleEntityNameChange}
          onEntityTypeChange={handleEntityTypeChange}
          onDeleteEntry={handleDeleteEntry}
          onFieldFocus={handleFieldFocus}
          onSave={handleSave}
          saving={saving}
        />
      </div>
    </div>
  );
}
