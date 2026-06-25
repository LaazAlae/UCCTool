const BASE = "/api";

async function request<T>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, opts);
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: { message: res.statusText } }));
    const err = body.error || {};
    throw new Error(err.message || body.detail || body.error || `Request failed: ${res.status}`);
  }
  return res.json();
}

export type FieldKey = "fileType" | "entityName" | "entityType" | "fileNumber" | "fileDate" | "securedParty";
export const FIELD_KEYS: FieldKey[] = ["fileType", "entityName", "entityType", "fileNumber", "fileDate", "securedParty"];

export interface BoundingBox {
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ListingField {
  value: string;
  confidence: number;
  boundingBox: BoundingBox | null;
  confirmed: boolean;
}

export type ExtractionResult = Record<FieldKey, ListingField>;

export interface ListingEntry extends ExtractionResult {
  id: string;
}

export interface ListingMeta {
  preparedFor: string;
  clientMatter: string;
  projectNumber: string;
  projectMgr: string;
  jurisdiction: string;
  summary: string;
  thruDate: string;
  yearsSearched: string;
}

export const RECORD_FIELDS: FieldKey[] = ["fileDate", "fileNumber", "fileType", "securedParty"];

export interface CostPart {
  provider: string;
  estimatedCostUsd: number;
  pages?: number;
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
}

export interface CostSummary {
  ocr?: CostPart;
  ai?: CostPart;
  totalEstimatedCostUsd?: number;
  maxJobCostUsd?: number;
  maxDailyCostUsd?: number;
}

export const api = {
  upload(file: File) {
    const form = new FormData();
    form.append("evidence", file);
    return request<{ jobId: string; fileName: string; pageCount: number }>("/upload", {
      method: "POST",
      body: form,
    });
  },

  ocr(jobId: string) {
    return request<{ jobId: string; blocks: number; cached: boolean }>(`/ocr/${jobId}`, {
      method: "POST",
    });
  },

  extract(jobId: string) {
    return request<{ jobId: string; extractions: ExtractionResult[]; cost: CostSummary }>(`/extract/${jobId}`, {
      method: "POST",
    });
  },

  save(jobId: string, entries: ListingEntry[], meta?: ListingMeta & { debtor?: string; partyLabel?: string }) {
    return request<{ jobId: string }>(`/save/${jobId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ entries, meta }),
    });
  },

  async downloadPdf(jobId: string, meta: Record<string, string>, records: Record<string, string>[]) {
    const res = await fetch(`${BASE}/pdf/${jobId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ meta, records }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({ error: { message: res.statusText } }));
      throw new Error(body.error?.message || "PDF generation failed");
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "listing_page.pdf";
    a.click();
    URL.revokeObjectURL(url);
  },

  log(jobId: string, action: string, detail: Record<string, unknown> = {}) {
    fetch(`${BASE}/log/${jobId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, detail }),
    }).catch(() => {});
  },

  evidenceUrl(jobId: string) {
    return `${BASE}/evidence/${jobId}`;
  },
};
