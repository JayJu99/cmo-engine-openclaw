import {
  PROJECT_CONTEXT_DOC_TYPES,
  PROJECT_CONTEXT_IMPORT_RECEIPT_SCHEMA_VERSION,
  type ProjectContextDocType,
  type ProjectContextImportFile,
  type ProjectContextImportReceiptV1,
  type ProjectContextPreviewConflict,
  type ProjectContextPreviewDetectedFile,
  type ProjectContextPreviewUnmappedFile,
} from "./project-context-import-types";

const PROJECT_CONTEXT_DOC_TYPE_SET = new Set<string>(PROJECT_CONTEXT_DOC_TYPES);

export function isProjectContextDocType(value: unknown): value is ProjectContextDocType {
  return typeof value === "string" && PROJECT_CONTEXT_DOC_TYPE_SET.has(value);
}

export function buildProjectContextSourcePath(workspaceId: string, docType: ProjectContextDocType): string {
  return `13 Sources/Source Notes/${workspaceId}/project-context/${docType}.md`;
}

export function buildProjectContextAcceptedPath(workspaceId: string, docType: ProjectContextDocType): string {
  return `12 Knowledge/Workspace Lessons/${workspaceId}/project-${docType}.md`;
}

export function detectProjectContextDocType(originalFilename: string, explicitOverride?: unknown): ProjectContextDocType | null {
  if (isProjectContextDocType(explicitOverride)) {
    return explicitOverride;
  }

  if (!isMarkdownFilename(originalFilename)) {
    return null;
  }

  const normalized = normalizeFilenameForDetection(originalFilename);
  const compact = normalized.replace(/[^a-z0-9]/g, "");

  if (normalized.includes("audience") || compact.includes("audience")) {
    return "audience";
  }

  if (normalized.includes("positioning") || compact.includes("positioning")) {
    return "positioning";
  }

  if (hasOrderedTokens(normalized, ["product", "truth"]) || compact.includes("producttruth")) {
    return "product-truth";
  }

  if (hasOrderedTokens(normalized, ["campaign", "rules"]) || compact.includes("campaignrules")) {
    return "campaign-rules";
  }

  if (hasOrderedTokens(normalized, ["content", "pillars"]) || compact.includes("contentpillars")) {
    return "content-pillars";
  }

  return null;
}

export function buildProjectContextImportPreviewReceipt(input: {
  workspaceId: string;
  projectName?: string;
  files: Array<Partial<ProjectContextImportFile> | null | undefined>;
}): ProjectContextImportReceiptV1 {
  const detected: ProjectContextPreviewDetectedFile[] = [];
  const unmappedFiles: ProjectContextPreviewUnmappedFile[] = [];
  const warnings: string[] = [];

  for (const file of input.files) {
    if (!isValidPreviewFile(file)) {
      unmappedFiles.push({
        client_file_id: file?.client_file_id ?? "",
        original_filename: file?.original_filename ?? "",
        reason: "invalid_file",
      });
      continue;
    }

    if (!isMarkdownFilename(file.original_filename)) {
      unmappedFiles.push({
        client_file_id: file.client_file_id,
        original_filename: file.original_filename,
        reason: "unsupported_file_type",
      });
      continue;
    }

    const docType = detectProjectContextDocType(file.original_filename, file.doc_type);
    if (!docType) {
      unmappedFiles.push({
        client_file_id: file.client_file_id,
        original_filename: file.original_filename,
        reason: "unknown_doc_type",
      });
      continue;
    }

    detected.push({
      client_file_id: file.client_file_id,
      original_filename: file.original_filename,
      doc_type: docType,
      confidence: "high",
      source_path: buildProjectContextSourcePath(input.workspaceId, docType),
      accepted_path: buildProjectContextAcceptedPath(input.workspaceId, docType),
      change_status: "preview_only",
      will_update_accepted: false,
    });
  }

  const conflicts = buildDuplicateDocTypeConflicts(detected);
  if (conflicts.length > 0) {
    warnings.push("duplicate_doc_type_conflict_blocks_confirm");
  }

  return {
    schema_version: PROJECT_CONTEXT_IMPORT_RECEIPT_SCHEMA_VERSION,
    status: "preview",
    write_performed: false,
    workspace_id: input.workspaceId,
    project_name: input.projectName,
    detected,
    unmapped_files: unmappedFiles,
    conflicts,
    warnings,
    errors: [],
    side_effects: {
      vault_write: false,
      source_write: false,
      accepted_context_write: false,
      gbrain_called: false,
      promotion_performed: false,
      supabase_mutation: false,
      runtime_write: false,
    },
  };
}

function buildDuplicateDocTypeConflicts(detected: ProjectContextPreviewDetectedFile[]): ProjectContextPreviewConflict[] {
  const byType = new Map<ProjectContextDocType, ProjectContextPreviewDetectedFile[]>();

  for (const file of detected) {
    byType.set(file.doc_type, [...(byType.get(file.doc_type) ?? []), file]);
  }

  return Array.from(byType.entries())
    .filter(([, files]) => files.length > 1)
    .map(([docType, files]) => ({
      doc_type: docType,
      original_filenames: files.map((file) => file.original_filename),
      reason: "duplicate_doc_type",
      blocks_confirm: true,
    }));
}

function isValidPreviewFile(file: Partial<ProjectContextImportFile> | null | undefined): file is ProjectContextImportFile {
  return Boolean(
    file &&
      typeof file.client_file_id === "string" &&
      file.client_file_id.trim() &&
      typeof file.original_filename === "string" &&
      file.original_filename.trim() &&
      typeof file.content === "string",
  );
}

function isMarkdownFilename(originalFilename: string): boolean {
  return originalFilename.trim().toLowerCase().endsWith(".md");
}

function normalizeFilenameForDetection(originalFilename: string): string {
  const basename = originalFilename
    .trim()
    .split(/[\\/]/)
    .pop()
    ?.replace(/\.md$/i, "") ?? "";

  return basename
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function hasOrderedTokens(normalizedFilename: string, tokens: [string, string]): boolean {
  const first = normalizedFilename.indexOf(tokens[0]);
  const second = normalizedFilename.indexOf(tokens[1]);
  return first >= 0 && second > first;
}
