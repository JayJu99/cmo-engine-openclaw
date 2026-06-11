import "server-only";

import { createHash, randomUUID } from "crypto";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const CMO_ATTACHMENT_BUCKET = "cmo-session-attachments";
export const CMO_ATTACHMENT_MAX_BYTES = 6 * 1024 * 1024;
export const CMO_ATTACHMENT_SIGNED_URL_TTL_SECONDS = 60 * 60;

export const CMO_ATTACHMENT_ALLOWED_MIME_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "application/pdf",
  "text/plain",
  "text/markdown",
  "text/csv",
  "application/json",
] as const;

export type CmoAttachmentMimeType = (typeof CMO_ATTACHMENT_ALLOWED_MIME_TYPES)[number];

export interface CmoSessionAttachmentStorage {
  kind: "supabase_storage";
  bucket: string;
  path: string;
  ref: string;
}

export interface CmoSessionAttachment {
  schema_version: "cmo.session_attachment.v1";
  attachment_id: string;
  filename: string;
  mime_type: CmoAttachmentMimeType;
  size_bytes: number;
  sha256: string;
  storage: CmoSessionAttachmentStorage;
  created_at: string;
  tenant_id?: string;
  workspace_id: string;
  app_id: string;
  session_id?: string;
  message_id?: string;
  user_id?: string;
  user_email?: string;
  user_caption?: string;
  purpose_hint: "user_uploaded_context";
  no_auto_promote_12_knowledge: true;
}

export interface HermesCmoAttachmentRef {
  schema_version: "hermes.cmo.attachment_ref.v1";
  attachment_id: string;
  filename: string;
  mime_type: CmoAttachmentMimeType;
  size_bytes: number;
  sha256: string;
  storage: {
    kind: "signed_url" | "supabase_storage";
    ref: string;
    signed_url?: string;
    expires_at?: string;
  };
  user_caption?: string;
  purpose_hint: "user_uploaded_context";
  fallback_extracted_text: {
    available: false;
    text: "";
    extractor: "";
    char_count: 0;
    is_primary: false;
  };
}

interface UploadCmoAttachmentInput {
  file: File;
  tenantId: string;
  workspaceId: string;
  appId: string;
  sessionId?: string;
  userId?: string;
  userEmail?: string;
  userCaption?: string;
}

const ALLOWED_MIME_SET = new Set<string>(CMO_ATTACHMENT_ALLOWED_MIME_TYPES);
const EXECUTABLE_EXTENSIONS = new Set([
  "bat",
  "cmd",
  "com",
  "cpl",
  "dll",
  "dmg",
  "exe",
  "jar",
  "js",
  "jse",
  "msi",
  "ps1",
  "scr",
  "sh",
  "vbs",
  "wsf",
]);

const MIME_BY_EXTENSION: Record<string, CmoAttachmentMimeType> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  pdf: "application/pdf",
  txt: "text/plain",
  md: "text/markdown",
  markdown: "text/markdown",
  csv: "text/csv",
  json: "application/json",
};

function safePathSegment(value: string, fallback: string): string {
  const safe = value
    .trim()
    .replace(/[/\\]+/g, "-")
    .replace(/[^A-Za-z0-9_. -]+/g, "-")
    .replace(/\s+/g, " ")
    .slice(0, 140)
    .trim();

  return safe || fallback;
}

function fileExtension(filename: string): string {
  const normalized = filename.toLowerCase();
  const lastDot = normalized.lastIndexOf(".");

  return lastDot >= 0 ? normalized.slice(lastDot + 1) : "";
}

function normalizeMimeType(file: File): CmoAttachmentMimeType | null {
  const declared = file.type.trim().toLowerCase();
  const extension = fileExtension(file.name);
  const extensionMime = MIME_BY_EXTENSION[extension];

  if (
    extensionMime &&
    (
      !declared ||
      declared === extensionMime ||
      (declared === "text/plain" && (extensionMime.startsWith("text/") || extensionMime === "application/json"))
    )
  ) {
    return extensionMime;
  }

  if (ALLOWED_MIME_SET.has(declared)) {
    return declared as CmoAttachmentMimeType;
  }

  return extensionMime ?? null;
}

function validateAttachmentFile(file: File, mimeType: CmoAttachmentMimeType) {
  const extension = fileExtension(file.name);

  if (!file.name.trim()) {
    throw new Error("Attachment filename is required.");
  }

  if (EXECUTABLE_EXTENSIONS.has(extension)) {
    throw new Error("Executable files are not supported.");
  }

  if (!ALLOWED_MIME_SET.has(mimeType)) {
    throw new Error(`Unsupported attachment type: ${file.type || "unknown"}.`);
  }

  if (!MIME_BY_EXTENSION[extension] || MIME_BY_EXTENSION[extension] !== mimeType) {
    throw new Error(`Unsupported attachment extension: .${extension || "unknown"}.`);
  }

  if (file.size <= 0) {
    throw new Error("Attachment file is empty.");
  }

  if (file.size > CMO_ATTACHMENT_MAX_BYTES) {
    throw new Error(`Attachment is too large. Limit is ${CMO_ATTACHMENT_MAX_BYTES} bytes.`);
  }
}

async function ensureAttachmentBucket() {
  const supabase = createSupabaseAdminClient();
  const { data: buckets, error: listError } = await supabase.storage.listBuckets();

  if (listError) {
    throw new Error(`Unable to list Supabase Storage buckets: ${listError.message}`);
  }

  if (buckets.some((bucket) => bucket.name === CMO_ATTACHMENT_BUCKET)) {
    return supabase;
  }

  const { error } = await supabase.storage.createBucket(CMO_ATTACHMENT_BUCKET, {
    public: false,
    allowedMimeTypes: [...CMO_ATTACHMENT_ALLOWED_MIME_TYPES],
    fileSizeLimit: CMO_ATTACHMENT_MAX_BYTES,
  });

  if (error) {
    throw new Error(`Unable to create Supabase Storage bucket: ${error.message}`);
  }

  return supabase;
}

export function normalizeCmoSessionAttachments(value: unknown): CmoSessionAttachment[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item): CmoSessionAttachment | null => {
      if (typeof item !== "object" || item === null || Array.isArray(item)) {
        return null;
      }

      const record = item as Record<string, unknown>;
      const storage = record.storage;

      if (
        record.schema_version !== "cmo.session_attachment.v1" ||
        typeof record.attachment_id !== "string" ||
        typeof record.filename !== "string" ||
        typeof record.mime_type !== "string" ||
        !ALLOWED_MIME_SET.has(record.mime_type) ||
        typeof record.size_bytes !== "number" ||
        typeof record.sha256 !== "string" ||
        typeof record.created_at !== "string" ||
        typeof record.workspace_id !== "string" ||
        typeof record.app_id !== "string" ||
        typeof storage !== "object" ||
        storage === null ||
        Array.isArray(storage)
      ) {
        return null;
      }

      const storageRecord = storage as Record<string, unknown>;

      if (
        storageRecord.kind !== "supabase_storage" ||
        typeof storageRecord.bucket !== "string" ||
        typeof storageRecord.path !== "string" ||
        typeof storageRecord.ref !== "string"
      ) {
        return null;
      }

      return {
        schema_version: "cmo.session_attachment.v1",
        attachment_id: record.attachment_id,
        filename: record.filename,
        mime_type: record.mime_type as CmoAttachmentMimeType,
        size_bytes: Math.max(0, Math.floor(record.size_bytes)),
        sha256: record.sha256,
        storage: {
          kind: "supabase_storage",
          bucket: storageRecord.bucket,
          path: storageRecord.path,
          ref: storageRecord.ref,
        },
        created_at: record.created_at,
        ...(typeof record.tenant_id === "string" ? { tenant_id: record.tenant_id } : {}),
        workspace_id: record.workspace_id,
        app_id: record.app_id,
        ...(typeof record.session_id === "string" ? { session_id: record.session_id } : {}),
        ...(typeof record.message_id === "string" ? { message_id: record.message_id } : {}),
        ...(typeof record.user_id === "string" ? { user_id: record.user_id } : {}),
        ...(typeof record.user_email === "string" ? { user_email: record.user_email } : {}),
        ...(typeof record.user_caption === "string" ? { user_caption: record.user_caption } : {}),
        purpose_hint: "user_uploaded_context",
        no_auto_promote_12_knowledge: true,
      };
    })
    .filter((item): item is CmoSessionAttachment => Boolean(item))
    .slice(-8);
}

export async function uploadCmoAttachment(input: UploadCmoAttachmentInput): Promise<CmoSessionAttachment> {
  const mimeType = normalizeMimeType(input.file);
  const createdAt = new Date().toISOString();

  if (!mimeType) {
    throw new Error(`Unsupported attachment type: ${input.file.type || "unknown"}.`);
  }

  validateAttachmentFile(input.file, mimeType);

  const bytes = Buffer.from(await input.file.arrayBuffer());
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const attachmentId = `att_${randomUUID().slice(0, 12)}`;
  const filename = safePathSegment(input.file.name, "attachment");
  const sessionSegment = input.sessionId ? safePathSegment(input.sessionId, "session") : "unsent";
  const storagePath = [
    safePathSegment(input.tenantId, "tenant"),
    safePathSegment(input.workspaceId, "workspace"),
    safePathSegment(input.appId, "app"),
    sessionSegment,
    attachmentId,
    filename,
  ].join("/");
  const supabase = await ensureAttachmentBucket();
  const { error } = await supabase.storage
    .from(CMO_ATTACHMENT_BUCKET)
    .upload(storagePath, bytes, {
      contentType: mimeType,
      upsert: false,
    });

  if (error) {
    throw new Error(`Attachment upload failed: ${error.message}`);
  }

  return {
    schema_version: "cmo.session_attachment.v1",
    attachment_id: attachmentId,
    filename,
    mime_type: mimeType,
    size_bytes: bytes.byteLength,
    sha256,
    storage: {
      kind: "supabase_storage",
      bucket: CMO_ATTACHMENT_BUCKET,
      path: storagePath,
      ref: `${CMO_ATTACHMENT_BUCKET}/${storagePath}`,
    },
    created_at: createdAt,
    tenant_id: input.tenantId,
    workspace_id: input.workspaceId,
    app_id: input.appId,
    ...(input.sessionId ? { session_id: input.sessionId } : {}),
    ...(input.userId ? { user_id: input.userId } : {}),
    ...(input.userEmail ? { user_email: input.userEmail } : {}),
    ...(input.userCaption ? { user_caption: input.userCaption } : {}),
    purpose_hint: "user_uploaded_context",
    no_auto_promote_12_knowledge: true,
  };
}

export function bindCmoAttachmentsToTurn(input: {
  attachments: CmoSessionAttachment[];
  sessionId: string;
  messageId: string;
  userId?: string;
  userEmail?: string;
}): CmoSessionAttachment[] {
  return input.attachments.map((attachment) => ({
    ...attachment,
    session_id: input.sessionId,
    message_id: input.messageId,
    ...(input.userId ? { user_id: input.userId } : {}),
    ...(input.userEmail ? { user_email: input.userEmail } : {}),
  }));
}

export async function cmoAttachmentsForHermes(attachments: CmoSessionAttachment[]): Promise<HermesCmoAttachmentRef[]> {
  if (!attachments.length) {
    return [];
  }

  const supabase = createSupabaseAdminClient();
  const expiresAt = new Date(Date.now() + CMO_ATTACHMENT_SIGNED_URL_TTL_SECONDS * 1000).toISOString();

  return Promise.all(
    attachments.map(async (attachment) => {
      const { data, error } = await supabase.storage
        .from(attachment.storage.bucket)
        .createSignedUrl(attachment.storage.path, CMO_ATTACHMENT_SIGNED_URL_TTL_SECONDS);

      if (error) {
        throw new Error(`Unable to create attachment signed URL: ${error.message}`);
      }

      return {
        schema_version: "hermes.cmo.attachment_ref.v1",
        attachment_id: attachment.attachment_id,
        filename: attachment.filename,
        mime_type: attachment.mime_type,
        size_bytes: attachment.size_bytes,
        sha256: attachment.sha256,
        storage: {
          kind: "signed_url",
          ref: attachment.storage.ref,
          signed_url: data.signedUrl,
          expires_at: expiresAt,
        },
        ...(attachment.user_caption ? { user_caption: attachment.user_caption } : {}),
        purpose_hint: "user_uploaded_context",
        fallback_extracted_text: {
          available: false,
          text: "",
          extractor: "",
          char_count: 0,
          is_primary: false,
        },
      };
    }),
  );
}
