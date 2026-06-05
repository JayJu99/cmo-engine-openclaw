import {
  PROJECT_CONTEXT_DOC_TYPES,
  PROJECT_CONTEXT_IMPORT_REQUEST_SCHEMA_VERSION,
  type ProjectContextDocType,
  type ProjectContextImportFile,
  type ProjectContextImportRequestV1,
} from "@/lib/cmo/project-context-import-types";

export interface ProjectContextImportValidationResult {
  ok: boolean;
  errors: string[];
  request?: ProjectContextImportRequestV1;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringField(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function boolField(record: Record<string, unknown>, key: string): boolean | undefined {
  const value = record[key];
  return typeof value === "boolean" ? value : undefined;
}

function isAllowedDocType(value: unknown): value is ProjectContextDocType {
  return typeof value === "string" && PROJECT_CONTEXT_DOC_TYPES.includes(value as ProjectContextDocType);
}

function looksLikeMarkdown(value: string): boolean {
  const trimmed = value.trim();
  return Boolean(trimmed) && !/<html\b|<body\b|<script\b/i.test(trimmed);
}

function normalizeFile(value: unknown, errors: string[], seenDocTypes: Set<string>): ProjectContextImportFile | null {
  if (!isRecord(value)) {
    errors.push("file_invalid");
    return null;
  }

  const docType = value.doc_type;
  const content = stringField(value, "content");
  const clientFileId = stringField(value, "client_file_id");
  const originalFilename = stringField(value, "original_filename");

  if (!isAllowedDocType(docType)) {
    errors.push("file_doc_type_invalid");
    return null;
  }

  if (!clientFileId) {
    errors.push(`file_client_file_id_missing:${docType}`);
    return null;
  }

  if (!originalFilename) {
    errors.push(`file_original_filename_missing:${docType}`);
    return null;
  }

  if (seenDocTypes.has(docType)) {
    errors.push(`duplicate_doc_type:${docType}`);
    return null;
  }
  seenDocTypes.add(docType);

  if (!content || !looksLikeMarkdown(content)) {
    errors.push(`file_content_invalid:${docType}`);
    return null;
  }

  if (!originalFilename.toLowerCase().endsWith(".md")) {
    errors.push(`file_not_markdown:${docType}`);
    return null;
  }

  const sizeBytes = typeof value.size_bytes === "number" && Number.isFinite(value.size_bytes) && value.size_bytes >= 0
    ? Math.floor(value.size_bytes)
    : undefined;

  return {
    client_file_id: clientFileId,
    original_filename: originalFilename,
    doc_type: docType,
    content,
    ...(stringField(value, "mime_type") ? { mime_type: stringField(value, "mime_type") } : {}),
    ...(typeof sizeBytes === "number" ? { size_bytes: sizeBytes } : {}),
  };
}

export function validateProjectContextImportConfirmRequest(
  value: unknown,
  expected: { appId: string; workspaceId: string; tenantId: string },
): ProjectContextImportValidationResult {
  const errors: string[] = [];

  if (!isRecord(value)) {
    return { ok: false, errors: ["request_invalid"] };
  }

  if (value.schema_version !== PROJECT_CONTEXT_IMPORT_REQUEST_SCHEMA_VERSION) {
    errors.push("schema_version_invalid");
  }

  if (value.mode !== "confirm") {
    errors.push("mode_invalid");
  }

  const workspaceId = stringField(value, "workspace_id");
  const appId = stringField(value, "app_id");
  const tenantId = stringField(value, "tenant_id");

  if (tenantId !== expected.tenantId) {
    errors.push("tenant_id_mismatch");
  }

  if (workspaceId !== expected.workspaceId) {
    errors.push("workspace_id_mismatch");
  }

  if (appId !== expected.appId) {
    errors.push("app_id_mismatch");
  }

  const confirmation = isRecord(value.confirmation) ? value.confirmation : null;

  if (!confirmation) {
    errors.push("confirmation_missing");
  } else {
    if (boolField(confirmation, "accepted_project_context") !== true) {
      errors.push("confirmation_accepted_project_context_required");
    }
    if (boolField(confirmation, "confirmed_by_user") !== true) {
      errors.push("confirmation_confirmed_by_user_required");
    }
  }

  const rawFiles = Array.isArray(value.files) ? value.files : null;

  if (!rawFiles?.length) {
    errors.push("files_missing");
  }

  const seenDocTypes = new Set<string>();
  const files = rawFiles
    ? rawFiles.map((file) => normalizeFile(file, errors, seenDocTypes)).filter((file): file is ProjectContextImportFile => Boolean(file))
    : [];

  if (errors.length) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    errors: [],
    request: {
      schema_version: PROJECT_CONTEXT_IMPORT_REQUEST_SCHEMA_VERSION,
      mode: "confirm",
      tenant_id: tenantId as string,
      workspace_id: workspaceId as string,
      app_id: appId as string,
      ...(stringField(value, "project_name") ? { project_name: stringField(value, "project_name") } : {}),
      confirmation: {
        accepted_project_context: true,
        confirmed_by_user: true,
        overwrite_changed: boolField(confirmation as Record<string, unknown>, "overwrite_changed") === true,
      },
      files,
    },
  };
}
