import type { ExtractionResult, ListingEntry } from "./api";

interface Props {
  extractions: ExtractionResult[];
  entries: ListingEntry[];
  onEntryChange: (index: number, field: string, value: string) => void;
  onEntryConfirm: (index: number) => void;
  onEntityNameChange: (value: string) => void;
  onEntityTypeChange: (value: string) => void;
  onDeleteEntry: (index: number) => void;
  onFieldFocus: (recordIndex: number, fieldKey: string) => void;
  onSave: () => void;
  saving: boolean;
}

const ENTITY_TYPES = ["Individual", "Corporation", "LLC", "Partnership", "Trust", "Other"];

const input: React.CSSProperties = {
  width: "100%", padding: "5px 7px", border: "1px solid var(--border)",
  borderRadius: 4, fontSize: 13, background: "white", boxSizing: "border-box",
};

export function ListingForm({
  extractions, entries, onEntryChange, onEntryConfirm,
  onEntityNameChange, onEntityTypeChange, onDeleteEntry,
  onFieldFocus, onSave, saving,
}: Props) {
  const entityName = entries[0]?.entityName || "";
  const entityType = entries[0]?.entityType || "";
  const confirmed = entries.filter((e) => e.confirmed).length;
  const allConfirmed = entries.length > 0 && confirmed === entries.length;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: "var(--surface)", borderRadius: "var(--radius)", border: "1px solid var(--border)" }}>
      {/* Header */}
      <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--border)", background: "#f1f5f9", borderRadius: "var(--radius) var(--radius) 0 0" }}>
        <h3 style={{ fontSize: 14, fontWeight: 600, margin: 0 }}>Listing Fields</h3>
        <p style={{ fontSize: 12, color: "var(--muted)", marginTop: 4 }}>
          {entries.length} record{entries.length !== 1 ? "s" : ""} extracted. Review and confirm each.
        </p>
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflow: "auto", padding: "12px 16px" }}>
        {/* Shared debtor info */}
        <div style={{ padding: "10px 12px", marginBottom: 12, border: "1px solid var(--border)", borderRadius: 6, background: "#f8fafc" }}>
          <div style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.5, color: "var(--muted)", marginBottom: 8 }}>
            Debtor Info (applies to all records)
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 140px", gap: 8 }}>
            <div>
              <Label text="Entity Name" conf={extractions[0]?.entityName.confidence} />
              <input value={entityName} onChange={(e) => onEntityNameChange(e.target.value)} onFocus={() => onFieldFocus(0, "entityName")} style={input} />
            </div>
            <div>
              <Label text="Entity Type" conf={extractions[0]?.entityType.confidence} />
              <select value={entityType} onChange={(e) => onEntityTypeChange(e.target.value)} onFocus={() => onFieldFocus(0, "entityType")} style={{ ...input, cursor: "pointer" }}>
                {ENTITY_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
          </div>
        </div>

        {/* Records */}
        <div style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.5, color: "var(--muted)", marginBottom: 8 }}>
          Records ({entries.length})
        </div>

        {entries.map((entry, i) => {
          const ext = extractions[i];
          return (
            <div key={entry.id} style={{
              padding: "10px 12px", marginBottom: 8,
              border: `1px solid ${entry.confirmed ? "var(--success)" : "var(--border)"}`,
              borderRadius: 6, background: entry.confirmed ? "rgba(22,163,74,0.03)" : "white",
              transition: "all 0.15s",
            }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: "var(--muted)" }}>#{i + 1}</span>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <button onClick={() => onDeleteEntry(i)} title="Remove" style={{
                    width: 24, height: 24, border: "1px solid var(--border)", borderRadius: 4,
                    background: "white", color: "var(--muted)", fontSize: 14,
                    display: "flex", alignItems: "center", justifyContent: "center",
                  }}>&times;</button>
                  <button onClick={() => onEntryConfirm(i)} title={entry.confirmed ? "Confirmed" : "Click to confirm"} style={{
                    width: 26, height: 26,
                    border: `2px solid ${entry.confirmed ? "var(--success)" : "var(--border)"}`,
                    borderRadius: "50%",
                    background: entry.confirmed ? "var(--success)" : "white",
                    color: entry.confirmed ? "white" : "var(--muted)",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 14, transition: "all 0.15s",
                  }}>{entry.confirmed ? "✓" : ""}</button>
                </div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
                <Field label="File Date" value={entry.fileDate} conf={ext?.fileDate.confidence} onChange={(v) => onEntryChange(i, "fileDate", v)} onFocus={() => onFieldFocus(i, "fileDate")} />
                <Field label="File/Case #" value={entry.fileNumber} conf={ext?.fileNumber.confidence} onChange={(v) => onEntryChange(i, "fileNumber", v)} onFocus={() => onFieldFocus(i, "fileNumber")} />
                <Field label="File Type" value={entry.fileType} conf={ext?.fileType.confidence} onChange={(v) => onEntryChange(i, "fileType", v)} onFocus={() => onFieldFocus(i, "fileType")} />
                <Field label="Secured Party" value={entry.securedParty} conf={ext?.securedParty.confidence} onChange={(v) => onEntryChange(i, "securedParty", v)} onFocus={() => onFieldFocus(i, "securedParty")} />
              </div>
            </div>
          );
        })}

        {entries.length === 0 && (
          <div style={{ textAlign: "center", padding: 24, color: "var(--muted)", fontSize: 13 }}>No records extracted</div>
        )}
      </div>

      {/* Footer */}
      <div style={{ padding: "12px 16px", borderTop: "1px solid var(--border)", display: "flex", flexDirection: "column", gap: 8 }}>
        <div style={{ fontSize: 12, textAlign: "center", color: allConfirmed ? "var(--success)" : "var(--muted)" }}>
          {allConfirmed ? "All records confirmed" : `${confirmed} / ${entries.length} confirmed`}
        </div>
        <button
          onClick={onSave}
          disabled={saving || !allConfirmed}
          title={allConfirmed ? undefined : "Confirm all records before saving"}
          style={{
            padding: 10, background: "var(--primary)", color: "white", border: "none",
            borderRadius: 6, fontWeight: 500, opacity: saving || !allConfirmed ? 0.5 : 1,
            cursor: saving || !allConfirmed ? "default" : "pointer",
          }}
        >
          {saving ? "Saving..." : "Save Listing"}
        </button>
      </div>
    </div>
  );
}

function Label({ text, conf }: { text: string; conf?: number }) {
  const color = !conf ? "var(--muted)" : conf > 0.9 ? "var(--success)" : conf > 0.7 ? "var(--warning)" : "var(--danger)";
  return (
    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 2 }}>
      <label style={{ fontSize: 11, color: "var(--muted)" }}>{text}</label>
      {conf !== undefined && <span style={{ fontSize: 10, color }}>{Math.round(conf * 100)}%</span>}
    </div>
  );
}

function Field({ label, value, conf, onChange, onFocus }: {
  label: string; value: string; conf?: number;
  onChange: (v: string) => void; onFocus: () => void;
}) {
  return (
    <div>
      <Label text={label} conf={conf} />
      <input value={value} onChange={(e) => onChange(e.target.value)} onFocus={onFocus}
        style={{ width: "100%", padding: "5px 7px", border: "1px solid var(--border)", borderRadius: 4, fontSize: 13, background: "white", boxSizing: "border-box" }} />
    </div>
  );
}
