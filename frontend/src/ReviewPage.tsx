import { useState, useEffect } from "react";
import { api, RECORD_FIELDS, FIELD_KEYS } from "./api";
import type { FieldKey, ListingEntry, ListingMeta } from "./api";
import { PdfViewer } from "./PdfViewer";
import type { Highlight } from "./PdfViewer";
import { ListingForm } from "./ListingForm";
import { PdfModal } from "./PdfModal";

const FIELD_LABELS: Record<FieldKey, string> = {
  fileType: "File Type",
  entityName: "Debtor",
  entityType: "Entity Type",
  fileNumber: "File/Case #",
  fileDate: "File Date",
  securedParty: "Secured Party",
};

const DEFAULT_META: ListingMeta = {
  preparedFor: "", clientMatter: "", projectNumber: "", projectMgr: "",
  jurisdiction: "", summary: "", thruDate: "", yearsSearched: "",
};

interface Props {
  jobId: string;
  fileName: string;
  pageCount: number;
  projectId?: string;
  onDone?: () => void;
}

type Stage = "ocr" | "extracting" | "reviewing" | "error";

export function ReviewPage({ jobId, fileName: initFileName, pageCount: initPageCount, projectId, onDone }: Props) {
  const [stage, setStage] = useState<Stage>("ocr");
  const [error, setError] = useState<string | null>(null);
  const [ocrBlocks, setOcrBlocks] = useState(0);
  const [entries, setEntries] = useState<ListingEntry[]>([]);
  const [saving, setSaving] = useState(false);
  const [activeField, setActiveField] = useState<string | null>(null);
  const [deleted, setDeleted] = useState<{ entry: ListingEntry; index: number } | null>(null);
  const [pageCount, setPageCount] = useState(initPageCount);
  const [fileName, setFileName] = useState(initFileName);

  const [meta, setMeta] = useState<ListingMeta>({ ...DEFAULT_META });
  const [debtor, setDebtor] = useState("");
  const [debtorConfidence, setDebtorConfidence] = useState(0);
  const [debtorConfirmed, setDebtorConfirmed] = useState(false);
  const [partyLabel, setPartyLabel] = useState("Secured Party");

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        setStage("ocr");
        setError(null);

        if (!initPageCount || !initFileName) {
          const jobInfo = await api.getJob(jobId);
          if (cancelled) return;
          setPageCount(jobInfo.pageCount);
          setFileName(jobInfo.fileName);
        }

        const ocrRes = await api.ocr(jobId);
        if (cancelled) return;
        setOcrBlocks(ocrRes.blocks);

        setStage("extracting");
        const res = await api.extract(jobId);
        if (cancelled) return;
        const ext = res.extractions;
        setEntries(ext.map((e) => ({ id: crypto.randomUUID(), ...e })));

        // Pick debtor from the most common entityName
        const counts = new Map<string, number>();
        ext.forEach((e) => {
          const n = e.entityName.value;
          if (n) counts.set(n, (counts.get(n) || 0) + 1);
        });
        let best = ext[0]?.entityName.value || "";
        let bestCount = 0;
        counts.forEach((c, n) => { if (c > bestCount) { best = n; bestCount = c; } });
        setDebtor(best);
        setDebtorConfidence(ext[0]?.entityName.confidence || 0);

        // Auto-detect party label from file types
        const isSuits = ext.some((e) => {
          const t = e.fileType.value.toLowerCase();
          return t.includes("suit") || t.includes("judgment");
        });
        setPartyLabel(isSuits ? "Reverse Party" : "Secured Party");

        setStage("reviewing");
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Something went wrong");
        setStage("error");
      }
    })();

    return () => { cancelled = true; };
  }, [jobId]);

  function updateField(index: number, key: FieldKey, patch: Partial<ListingEntry[FieldKey]>) {
    setEntries((prev) => prev.map((entry, i) => i === index ? { ...entry, [key]: { ...entry[key], ...patch } } : entry));
  }

  function handleFieldChange(index: number, key: FieldKey, value: string) {
    api.log(jobId, "field_edit", { record: index, field: key, to: value });
    updateField(index, key, { value, confirmed: false });
  }

  function handleFieldConfirm(index: number, key: FieldKey) {
    const next = !entries[index]?.[key].confirmed;
    api.log(jobId, next ? "field_confirm" : "field_unconfirm", { record: index, field: key });
    updateField(index, key, { confirmed: next });
  }

  function handleMetaChange(key: keyof ListingMeta, value: string) {
    setMeta((prev) => ({ ...prev, [key]: value }));
  }

  function handleDebtorChange(value: string) {
    setDebtor(value);
    setDebtorConfirmed(false);
    setEntries((prev) => prev.map((entry) => ({
      ...entry,
      entityName: { ...entry.entityName, value, confirmed: false },
    })));
  }

  function handleDebtorConfirm() {
    const next = !debtorConfirmed;
    setDebtorConfirmed(next);
    api.log(jobId, next ? "debtor_confirm" : "debtor_unconfirm", { debtor });
    setEntries((prev) => prev.map((entry) => ({
      ...entry,
      entityName: { ...entry.entityName, value: debtor, confirmed: next },
      entityType: { ...entry.entityType, confirmed: next },
    })));
  }

  function handleRowConfirm(index: number) {
    const allDone = RECORD_FIELDS.every((key) => entries[index]?.[key].confirmed);
    const next = !allDone;
    api.log(jobId, next ? "row_confirm" : "row_unconfirm", { record: index });
    setEntries((prev) => prev.map((entry, i) => {
      if (i !== index) return entry;
      const updated = { ...entry };
      for (const key of RECORD_FIELDS) {
        (updated as Record<string, unknown>)[key] = { ...entry[key], confirmed: next };
      }
      return updated as ListingEntry;
    }));
  }

  function handleDeleteEntry(index: number) {
    api.log(jobId, "record_delete", { record: index });
    const entry = entries[index];
    setDeleted({ entry, index });
    setEntries((prev) => prev.filter((_, i) => i !== index));
  }

  function handleUndoDelete() {
    if (!deleted) return;
    api.log(jobId, "record_restore", { record: deleted.index });
    setEntries((prev) => {
      const next = [...prev];
      next.splice(deleted.index, 0, deleted.entry);
      return next;
    });
    setDeleted(null);
  }

  function handleDismissDeleted() {
    setDeleted(null);
  }

  function handleAddEntry() {
    const blank: ListingEntry = {
      id: crypto.randomUUID(),
      fileType: { value: "", confidence: 0, boundingBox: null, confirmed: false },
      entityName: { value: debtor, confidence: 0, boundingBox: null, confirmed: debtorConfirmed },
      entityType: { value: "", confidence: 0, boundingBox: null, confirmed: debtorConfirmed },
      fileNumber: { value: "", confidence: 0, boundingBox: null, confirmed: false },
      fileDate: { value: "", confidence: 0, boundingBox: null, confirmed: false },
      securedParty: { value: "", confidence: 0, boundingBox: null, confirmed: false },
    };
    api.log(jobId, "record_add", { record: entries.length });
    setEntries((prev) => [...prev, blank]);
  }

  function handleFieldFocus(recordIndex: number, key: FieldKey) {
    setActiveField(`${recordIndex}-${key}`);
  }

  function handleDebtorFocus() {
    setActiveField("debtor");
  }

  function handleHighlightClick(fieldKey: string) {
    for (const fk of fieldKey.split(",")) {
      if (fk === "debtor") {
        handleDebtorConfirm();
      } else {
        const [rawIndex, rawKey] = fk.split("-");
        const index = Number(rawIndex);
        const key = rawKey as FieldKey;
        if (!Number.isNaN(index) && RECORD_FIELDS.includes(key)) handleFieldConfirm(index, key);
      }
    }
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      const saveMeta = { ...meta, debtor, partyLabel, status: "" };
      await api.save(jobId, entries, saveMeta);
      api.log(jobId, "save_complete", { entries: entries.length });
      if (onDone) onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
      api.log(jobId, "save_failed", { message: err instanceof Error ? err.message : "Save failed" });
    } finally {
      setSaving(false);
    }
  }

  const [pdfPreviewUrl, setPdfPreviewUrl] = useState<string | null>(null);

  async function handlePreviewPdf() {
    try {
      const pdfMeta = { ...meta, debtor, partyLabel, status: "" };
      const pdfRecords = entries.map((e) => ({
        fileDate: e.fileDate.value,
        fileNumber: e.fileNumber.value,
        fileType: e.fileType.value,
        securedParty: e.securedParty.value,
      }));
      const url = await api.previewPdf(jobId, pdfMeta, pdfRecords);
      setPdfPreviewUrl(url);
      api.log(jobId, "pdf_previewed", { records: entries.length });
    } catch (err) {
      setError(err instanceof Error ? err.message : "PDF generation failed");
    }
  }

  // Build highlights: debtor (from first record) + per-record table fields only
  const highlightMap = new Map<string, { fields: string[]; label: string; boundingBox: Highlight["boundingBox"]; confirmed: boolean }>();

  entries.forEach((entry, ri) => {
    FIELD_KEYS.forEach((key) => {
      if (!entry[key].boundingBox) return;
      const bb = entry[key].boundingBox!;
      const boxKey = `${bb.page}:${bb.x}:${bb.y}`;
      const fieldId = key === "entityName" ? "debtor" : `${ri}-${key}`;
      const isConfirmed = key === "entityName" || key === "entityType" ? debtorConfirmed : entry[key].confirmed;
      const existing = highlightMap.get(boxKey);
      if (existing) {
        if (!existing.fields.includes(fieldId)) existing.fields.push(fieldId);
        existing.confirmed = existing.confirmed && isConfirmed;
      } else {
        highlightMap.set(boxKey, {
          fields: [fieldId],
          label: `#${ri + 1} ${FIELD_LABELS[key]}`,
          boundingBox: bb,
          confirmed: isConfirmed,
        });
      }
    });
  });

  const highlights: Highlight[] = [...highlightMap.values()].map((h) => ({
    fieldKey: h.fields.join(","),
    label: h.label,
    boundingBox: h.boundingBox,
    confirmed: h.confirmed,
  }));

  if (stage === "ocr" || stage === "extracting") {
    return (
      <div style={{ display: "flex", justifyContent: "center", alignItems: "center", height: 400, flexDirection: "column", gap: 12 }}>
        <div style={{ width: 40, height: 40, border: "3px solid var(--border)", borderTopColor: "var(--primary)", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
        <p style={{ fontWeight: 500 }}>
          {stage === "ocr" ? "Scanning document..." : "Extracting records..."}
        </p>
        <p style={{ fontSize: 13, color: "var(--muted)" }}>
          {stage === "ocr"
            ? `Reading text from ${pageCount} page${pageCount !== 1 ? "s" : ""} using OCR`
            : `Analyzing ${ocrBlocks.toLocaleString()} text blocks with AI`}
        </p>
        <p style={{ fontSize: 12, color: "var(--muted)", marginTop: 4 }}>
          Step {stage === "ocr" ? "1" : "2"} of 2
        </p>
      </div>
    );
  }

  if (stage === "error") {
    return (
      <div style={{ display: "flex", justifyContent: "center", alignItems: "center", height: 400, flexDirection: "column", gap: 12 }}>
        <p style={{ color: "var(--danger)", fontWeight: 500 }}>{error || "Something went wrong"}</p>
        <button onClick={() => window.location.reload()} style={{ padding: "8px 20px", background: "var(--primary)", color: "white", border: "none", borderRadius: 6 }}>
          Retry
        </button>
      </div>
    );
  }

  return (
    <div style={{
      height: "100%",
      padding: "28px 28px 36px",
      boxSizing: "border-box",
      display: "grid",
      gridTemplateRows: "auto minmax(0, 1fr)",
      rowGap: 16,
      minHeight: 0,
    }}>
      <div>
          <h2 style={{ fontSize: 16, fontWeight: 600 }}>{fileName}</h2>
          <p style={{ fontSize: 13, color: "var(--muted)" }}>
            {pageCount} page{pageCount !== 1 ? "s" : ""} &middot; {entries.length} record{entries.length !== 1 ? "s" : ""} found
          </p>
      </div>

        {error && (
          <div style={{ padding: "8px 12px", background: "rgba(220,38,38,0.08)", color: "var(--danger)", borderRadius: 6, fontSize: 13, marginBottom: 12 }}>
            {error}
          </div>
        )}

        <div style={{ display: "grid", gridTemplateColumns: "3fr 2fr", gap: 20, height: "100%", minHeight: 0 }}>
        <div style={{ background: "var(--surface)", borderRadius: "var(--radius)", border: "1px solid var(--border)", overflow: "hidden", display: "flex", flexDirection: "column" }}>
          <PdfViewer jobId={jobId} pageCount={pageCount} highlights={highlights} onHighlightClick={handleHighlightClick} activeField={activeField} />
        </div>

        <ListingForm
          meta={meta}
          onMetaChange={handleMetaChange}
          debtor={debtor}
          debtorConfidence={debtorConfidence}
          debtorConfirmed={debtorConfirmed}
          onDebtorChange={handleDebtorChange}
          onDebtorConfirm={handleDebtorConfirm}
          onDebtorFocus={handleDebtorFocus}
          partyLabel={partyLabel}
          onPartyLabelChange={setPartyLabel}
          entries={entries}
          onFieldChange={handleFieldChange}
          onRowConfirm={handleRowConfirm}
          onDeleteEntry={handleDeleteEntry}
          onAddEntry={handleAddEntry}
          deleted={deleted}
          onUndoDelete={handleUndoDelete}
          onDismissDeleted={handleDismissDeleted}
          onFieldFocus={handleFieldFocus}
          onSave={handleSave}
          onPreviewPdf={handlePreviewPdf}
          saving={saving}
        />
        </div>

      {pdfPreviewUrl && (
        <PdfModal
          url={pdfPreviewUrl}
          title={`${fileName} — Listing + Evidence`}
          downloadName={`${fileName.replace(/\.pdf$/i, "")}_listing.pdf`}
          onClose={() => { URL.revokeObjectURL(pdfPreviewUrl); setPdfPreviewUrl(null); }}
        />
      )}
    </div>
  );
}
