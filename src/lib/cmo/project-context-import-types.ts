export const PROJECT_CONTEXT_IMPORT_REQUEST_SCHEMA_VERSION = "project_context_import.request.v1" as const;
export const PROJECT_CONTEXT_IMPORT_RECEIPT_SCHEMA_VERSION = "project_context_import.receipt.v1" as const;

export const PROJECT_CONTEXT_DOC_TYPES = [
  "audience",
  "positioning",
  "product-truth",
  "campaign-rules",
  "content-pillars",
] as const;

export type ProjectContextDocType = (typeof PROJECT_CONTEXT_DOC_TYPES)[number];

export type ProjectContextImportMode = "preview" | "confirm";
export type ProjectContextDetectionConfidence = "high" | "low";
export type ProjectContextChangeStatus = "preview_only";

export interface ProjectContextImportConfirmation {
  accepted_project_context: boolean;
  confirmed_by_user: boolean;
  overwrite_changed: boolean;
}

export interface ProjectContextImportFile {
  client_file_id: string;
  original_filename: string;
  mime_type?: string;
  content: string;
  size_bytes?: number;
  doc_type?: ProjectContextDocType;
}

export interface ProjectContextImportRequestV1 {
  schema_version: typeof PROJECT_CONTEXT_IMPORT_REQUEST_SCHEMA_VERSION;
  mode: ProjectContextImportMode;
  tenant_id: string;
  workspace_id: string;
  app_id: string;
  project_name?: string;
  confirmation: ProjectContextImportConfirmation;
  files: ProjectContextImportFile[];
}

export interface ProjectContextPreviewDetectedFile {
  client_file_id: string;
  original_filename: string;
  doc_type: ProjectContextDocType;
  confidence: ProjectContextDetectionConfidence;
  source_path: string;
  accepted_path: string;
  change_status: ProjectContextChangeStatus;
  will_update_accepted: false;
}

export interface ProjectContextPreviewUnmappedFile {
  client_file_id: string;
  original_filename: string;
  reason: "unknown_doc_type" | "unsupported_file_type" | "invalid_file";
}

export interface ProjectContextPreviewConflict {
  doc_type: ProjectContextDocType;
  original_filenames: string[];
  reason: "duplicate_doc_type";
  blocks_confirm: true;
}

export interface ProjectContextImportSideEffects {
  vault_write: false;
  source_write: false;
  accepted_context_write: false;
  gbrain_called: false;
  promotion_performed: false;
  supabase_mutation: false;
  runtime_write: false;
}

export interface ProjectContextImportReceiptV1 {
  schema_version: typeof PROJECT_CONTEXT_IMPORT_RECEIPT_SCHEMA_VERSION;
  status: "preview";
  write_performed: false;
  workspace_id: string;
  project_name?: string;
  detected: ProjectContextPreviewDetectedFile[];
  unmapped_files: ProjectContextPreviewUnmappedFile[];
  conflicts: ProjectContextPreviewConflict[];
  warnings: string[];
  errors: string[];
  side_effects: ProjectContextImportSideEffects;
}
