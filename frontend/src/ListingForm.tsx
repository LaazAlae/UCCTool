import { useEffect } from "react";
import type { FieldKey, ListingEntry, ListingMeta } from "./api";

const RECORD_FIELDS: FieldKey[] = ["fileDate", "fileNumber", "fileType", "securedParty"];
const PARTY_LABELS = ["Secured Party", "Reverse Party", "Plaintiff"];

interface Props {
  meta: ListingMeta;
  onMetaChange: (key: keyof ListingMeta, value: string) => void;
  debtor: string;
  debtorConfidence: number;
  debtorConfirmed: boolean;
  onDebtorChange: (value: string) => void;
  onDebtorConfirm: () => void;
  onDebtorFocus: () => void;
  partyLabel: string;
  onPartyLabelChange: (value: string) => void;
  entries: ListingEntry[];
  onFieldChange: (index: number, field: FieldKey, value: string) => void;
  onRowConfirm: (index: number) => void;
  onDeleteEntry: (index: number) => void;
  onAddEntry: () => void;
  deleted: { entry: ListingEntry; index: number } | null;
  onUndoDelete: () => void;
  onDismissDeleted: () => void;
  onFieldFocus: (recordIndex: number, fieldKey: FieldKey) => void;
  onSave: () => void;
  onDownloadPdf: () => void;
  saving: boolean;
}

const cell: React.CSSProperties = {
  padding: "3px 4px", border: "1px solid var(--border)",
  borderRadius: 3, fontSize: 12, background: "white",
  width: "100%", boxSizing: "border-box",
};

export function ListingForm({
  meta, onMetaChange, debtor, debtorConfidence, debtorConfirmed,
  onDebtorChange, onDebtorConfirm, onDebtorFocus, partyLabel, onPartyLabelChange,
  entries, onFieldChange, onRowConfirm, onDeleteEntry, onAddEntry, deleted, onUndoDelete, onDismissDeleted, onFieldFocus,
  onSave, onDownloadPdf, saving,
}: Props) {
  useEffect(() => {
    if (!deleted) return;
    const t = setTimeout(onDismissDeleted, 8000);
    return () => clearTimeout(t);
  }, [deleted]);

  const confirmedRows = entries.filter(e => RECORD_FIELDS.every(k => e[k].confirmed)).length;
  const totalItems = 1 + entries.length;
  const confirmedItems = (debtorConfirmed ? 1 : 0) + confirmedRows;
  const allConfirmed = totalItems > 0 && confirmedItems === totalItems;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: "var(--surface)", borderRadius: "var(--radius)", border: "1px solid var(--border)" }}>
      <div style={{ padding: "10px 14px", borderBottom: "1px solid var(--border)", background: "#f1f5f9", borderRadius: "var(--radius) var(--radius) 0 0" }}>
        <h3 style={{ fontSize: 14, fontWeight: 600 }}>Listing Page</h3>
      </div>

      <div style={{ flex: 1, overflow: "auto", padding: "10px 14px" }}>
        <Section title="Project Info">
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 5 }}>
            <MetaField label="Prepared For" value={meta.preparedFor} onChange={v => onMetaChange("preparedFor", v)} />
            <MetaField label="Client Matter #" value={meta.clientMatter} onChange={v => onMetaChange("clientMatter", v)} />
            <MetaField label="Project #" value={meta.projectNumber} onChange={v => onMetaChange("projectNumber", v)} />
            <MetaField label="Project Mgr" value={meta.projectMgr} onChange={v => onMetaChange("projectMgr", v)} />
          </div>
        </Section>

        <Section title="Search Info">
          <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 5 }}>
            <div>
              <FieldLabel text="Debtor" conf={debtorConfidence} confirmed={debtorConfirmed} />
              <div style={{ display: "flex", gap: 4 }}>
                <input value={debtor} onChange={e => onDebtorChange(e.target.value)} onFocus={onDebtorFocus} style={{ ...cell, borderColor: debtorConfirmed ? "var(--success)" : "var(--border)", fontWeight: 500 }} />
                <Btn confirmed={debtorConfirmed} onClick={onDebtorConfirm} />
              </div>
            </div>
            <MetaField label="Jurisdiction" value={meta.jurisdiction} onChange={v => onMetaChange("jurisdiction", v)} />
            <div style={{ display: "grid", gridTemplateColumns: "1fr 90px 60px", gap: 5 }}>
              <MetaField label="Summary" value={meta.summary} onChange={v => onMetaChange("summary", v)} />
              <MetaField label="Thru Date" value={meta.thruDate} onChange={v => onMetaChange("thruDate", v)} />
              <MetaField label="Years" value={meta.yearsSearched} onChange={v => onMetaChange("yearsSearched", v)} />
            </div>
          </div>
        </Section>

        {deleted && (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "6px 10px", marginBottom: 6, background: "#fef3c7", border: "1px solid #f59e0b", borderRadius: 6, fontSize: 12 }}>
            <span>Record #{deleted.index + 1} deleted</span>
            <button onClick={onUndoDelete} style={{ padding: "2px 10px", background: "white", border: "1px solid #f59e0b", borderRadius: 4, fontSize: 12, fontWeight: 600, cursor: "pointer" }}>Undo</button>
          </div>
        )}

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <SectionTitle>Records ({entries.length})</SectionTitle>
            <button onClick={onAddEntry} title="Add record" style={{ width: 20, height: 20, border: "1px solid var(--border)", borderRadius: 3, background: "white", color: "var(--primary)", fontSize: 14, fontWeight: 600, cursor: "pointer", lineHeight: "18px", padding: 0 }}>+</button>
          </div>
          <select value={partyLabel} onChange={e => onPartyLabelChange(e.target.value)} style={{ fontSize: 11, padding: "2px 4px", border: "1px solid var(--border)", borderRadius: 3, background: "white" }}>
            {PARTY_LABELS.map(l => <option key={l} value={l}>{l}</option>)}
          </select>
        </div>

        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, tableLayout: "fixed" }}>
          <thead>
            <tr style={{ borderBottom: "2px solid var(--border)" }}>
              <th style={{ width: 20, ...th }}>#</th>
              <th style={{ width: "18%", ...th }}>File Date</th>
              <th style={{ width: "22%", ...th }}>File Number</th>
              <th style={{ width: "14%", ...th }}>File Type</th>
              <th style={{ ...th }}>{partyLabel}</th>
              <th style={{ width: 50, ...th }}></th>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry, i) => {
              const rowDone = RECORD_FIELDS.every(k => entry[k].confirmed);
              return (
                <tr key={entry.id} style={{ borderBottom: "1px solid var(--border)" }}>
                  <td style={{ ...td, fontSize: 11, color: "var(--muted)", fontWeight: 600 }}>{i + 1}</td>
                  {RECORD_FIELDS.map(key => (
                    <td key={key} style={td}>
                      <input
                        value={entry[key].value}
                        onChange={e => onFieldChange(i, key, e.target.value)}
                        onFocus={() => onFieldFocus(i, key)}
                        style={{ ...cell, borderColor: entry[key].confirmed ? "var(--success)" : "var(--border)" }}
                      />
                    </td>
                  ))}
                  <td style={{ ...td, whiteSpace: "nowrap" }}>
                    <Btn confirmed={rowDone} onClick={() => onRowConfirm(i)} />
                    <button onClick={() => onDeleteEntry(i)} title="Delete" style={{ width: 22, height: 22, border: "1px solid var(--border)", borderRadius: 3, background: "white", color: "var(--muted)", fontSize: 12, cursor: "pointer", marginLeft: 2, verticalAlign: "middle" }}>&times;</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {entries.length === 0 && <div style={{ textAlign: "center", padding: 20, color: "var(--muted)", fontSize: 13 }}>No records extracted</div>}
      </div>

      <div style={{ padding: "10px 14px", borderTop: "1px solid var(--border)", display: "flex", flexDirection: "column", gap: 6 }}>
        <div style={{ fontSize: 12, textAlign: "center", color: allConfirmed ? "var(--success)" : "var(--muted)" }}>
          {confirmedItems} / {totalItems} confirmed (debtor + {entries.length} records)
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button
            onClick={onSave} disabled={saving || !allConfirmed}
            title={allConfirmed ? undefined : "Confirm debtor and every record row"}
            style={{ flex: 1, padding: 9, background: "var(--primary)", color: "white", border: "none", borderRadius: 6, fontWeight: 500, opacity: saving || !allConfirmed ? 0.5 : 1, cursor: saving || !allConfirmed ? "default" : "pointer" }}
          >{saving ? "Saving..." : "Save Listing"}</button>
          <button
            onClick={onDownloadPdf}
            style={{ padding: "9px 14px", background: "white", color: "var(--primary)", border: "1px solid var(--primary)", borderRadius: 6, fontWeight: 500, cursor: "pointer" }}
          >PDF</button>
        </div>
      </div>
    </div>
  );
}

const th: React.CSSProperties = { textAlign: "left", padding: "4px 3px", fontSize: 11, color: "var(--muted)", fontWeight: 600 };
const td: React.CSSProperties = { padding: "2px 2px", verticalAlign: "middle" };

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.5, color: "var(--muted)" }}>{children}</div>;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ padding: "8px 10px", marginBottom: 10, border: "1px solid var(--border)", borderRadius: 6, background: "#f8fafc" }}>
      <SectionTitle>{title}</SectionTitle>
      <div style={{ marginTop: 6 }}>{children}</div>
    </div>
  );
}

function FieldLabel({ text, conf, confirmed }: { text: string; conf?: number; confirmed: boolean }) {
  const color = confirmed ? "var(--success)" : !conf ? "var(--muted)" : conf > 0.9 ? "var(--success)" : conf > 0.7 ? "var(--warning)" : "var(--danger)";
  return (
    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 2 }}>
      <label style={{ fontSize: 11, color: "var(--muted)" }}>{text}</label>
      <span style={{ fontSize: 10, color }}>{confirmed ? "confirmed" : conf !== undefined ? `${Math.round(conf * 100)}%` : ""}</span>
    </div>
  );
}

function MetaField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <label style={{ fontSize: 11, color: "var(--muted)", display: "block", marginBottom: 2 }}>{label}</label>
      <input value={value} onChange={e => onChange(e.target.value)} style={{ ...cell, fontSize: 12 }} />
    </div>
  );
}

function Btn({ confirmed, onClick }: { confirmed: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} title={confirmed ? "Unconfirm" : "Confirm"} style={{
      width: 22, height: 22, border: `1px solid ${confirmed ? "var(--success)" : "var(--border)"}`,
      borderRadius: 3, background: confirmed ? "var(--success)" : "white",
      color: confirmed ? "white" : "var(--muted)", fontSize: 13, cursor: "pointer", verticalAlign: "middle",
    }}>{confirmed ? "✓" : ""}</button>
  );
}
