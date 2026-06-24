const BASE = "/api";

async function request<T>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, opts);
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.detail || body.error || `Request failed: ${res.status}`);
  }
  return res.json();
}

// ── Types ───────────────────────────────────────────────────────────

export interface BoundingBox {
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ExtractionField {
  value: string;
  confidence: number;
  boundingBox: BoundingBox | null;
}

export interface ExtractionResult {
  fileType: ExtractionField;
  entityName: ExtractionField;
  entityType: ExtractionField;
  fileNumber: ExtractionField;
  fileDate: ExtractionField;
  securedParty: ExtractionField;
}

export interface ListingEntry {
  id: string;
  fileType: string;
  entityName: string;
  entityType: string;
  fileNumber: string;
  fileDate: string;
  securedParty: string;
  confirmed: boolean;
}

// ── API ─────────────────────────────────────────────────────────────

export const api = {
  upload(file: File) {
    const form = new FormData();
    form.append("evidence", file);
    return request<{ jobId: string; fileName: string; pageCount: number }>("/upload", {
      method: "POST",
      body: form,
    });
  },

  extract(jobId: string) {
    return request<{ jobId: string; extractions: ExtractionResult[] }>(`/extract/${jobId}`, {
      method: "POST",
    });
  },

  save(jobId: string, entries: ListingEntry[]) {
    return request<{ jobId: string }>(`/save/${jobId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ entries }),
    });
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
