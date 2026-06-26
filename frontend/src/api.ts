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

// ── Project types ────────────────────────────────────────────────────────
export interface Project {
  id: string;
  name: string;
  preparedFor: string;
  clientMatter: string;
  projectManager: string;
  projectNumber: string;
  evidenceCount?: number;
  evidence?: Evidence[];
  createdAt: string;
  updatedAt: string;
}

export interface Evidence {
  id: string;
  fileName: string;
  pageCount: number;
  resultType: "Records Found" | "No Records";
  included: boolean;
  order: number;
  debtor: string;
  searchType: string;
  jurisdiction: string;
  thruDate: string;
  recordCount: number;
  hasListing: boolean;
  hasMeta: boolean;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export const api = {
  // ── Existing job-level endpoints ────────────────────────────────────
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

  async previewPdf(jobId: string, meta: Record<string, string>, records: Record<string, string>[]): Promise<string> {
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
    return URL.createObjectURL(blob);
  },

  log(jobId: string, action: string, detail: Record<string, unknown> = {}) {
    fetch(`${BASE}/log/${jobId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, detail }),
    }).catch(() => {});
  },

  getJob(jobId: string) {
    return request<{ jobId: string; fileName: string; pageCount: number; resultType: string; projectId: string | null }>(`/job/${jobId}`);
  },

  evidenceUrl(jobId: string) {
    return `${BASE}/evidence/${jobId}`;
  },

  evidenceViewUrl(jobId: string) {
    return `${BASE}/evidence/${jobId}/view`;
  },

  // ── Projects ────────────────────────────────────────────────────────
  createProject(data: { name: string; preparedFor?: string; clientMatter?: string; projectManager?: string; projectNumber?: string }) {
    return request<Project>("/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
  },

  listProjects() {
    return request<Project[]>("/projects");
  },

  getProject(projectId: string) {
    return request<Project & { evidence: Evidence[] }>(`/projects/${projectId}`);
  },

  updateProject(projectId: string, data: Partial<Pick<Project, "name" | "preparedFor" | "clientMatter" | "projectManager" | "projectNumber">>) {
    return request<{ ok: boolean }>(`/projects/${projectId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
  },

  // ── Evidence management ─────────────────────────────────────────────
  uploadToProject(projectId: string, file: File, resultType: string) {
    const form = new FormData();
    form.append("evidence", file);
    return request<{ jobId: string; fileName: string; pageCount: number; resultType: string }>(
      `/projects/${projectId}/upload?result_type=${encodeURIComponent(resultType)}`,
      { method: "POST", body: form },
    );
  },

  saveNoRecordsMeta(projectId: string, jobId: string, meta: { debtor: string; searchType: string; jurisdiction?: string; thruDate?: string; yearsSearched?: string }) {
    return request<{ ok: boolean }>(`/projects/${projectId}/evidence/${jobId}/no-records-meta`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(meta),
    });
  },

  deleteEvidence(projectId: string, jobId: string) {
    return request<{ ok: boolean }>(`/projects/${projectId}/evidence/${jobId}`, {
      method: "DELETE",
    });
  },

  restoreEvidence(projectId: string, jobId: string) {
    return request<{ ok: boolean }>(`/projects/${projectId}/evidence/${jobId}/restore`, {
      method: "POST",
    });
  },

  reorderEvidence(projectId: string, jobIds: string[]) {
    return request<{ ok: boolean }>(`/projects/${projectId}/evidence/reorder`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jobIds }),
    });
  },

  toggleInclude(projectId: string, jobId: string, included: boolean) {
    return request<{ ok: boolean }>(`/projects/${projectId}/evidence/${jobId}/include?included=${included}`, {
      method: "PUT",
    });
  },

  getTrash(projectId: string) {
    return request<Evidence[]>(`/projects/${projectId}/trash`);
  },

  async compileReport(projectId: string, projectName: string) {
    const res = await fetch(`${BASE}/projects/${projectId}/compile`, { method: "POST" });
    if (!res.ok) {
      const body = await res.json().catch(() => ({ error: { message: res.statusText } }));
      throw new Error(body.error?.message || "Compilation failed");
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${projectName || "report"}.pdf`;
    a.click();
    URL.revokeObjectURL(url);
  },
};
