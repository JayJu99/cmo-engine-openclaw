import { createHash } from "crypto";
import { lookup } from "dns/promises";
import { isIP } from "net";

import type { CmoRuntimeContext, CmoSourceReviewContext } from "@/lib/cmo/app-workspace-types";
import type { CmoServerUserIdentity } from "@/lib/cmo/user-metadata";
import { buildSourceIngestionPackage } from "@/lib/cmo/vault-agent-source-ingestion";
import type { SourceIngestionPackage, SourceIngestionSourceType } from "@/lib/cmo/vault-agent-contracts";

export const SOURCE_REVIEW_CONTEXT_SCHEMA_VERSION = "cmo.source_review_context.v1" as const;
export const CMO_RUNTIME_TIMEZONE = "Asia/Ho_Chi_Minh" as const;
export const CMO_RUNTIME_TIMEZONE_LABEL = "Vietnam time" as const;
export const CMO_RUNTIME_LOCALE = "vi-VN" as const;

const MAX_REDIRECTS = 3;
const FETCH_TIMEOUT_MS = 8_000;
const MAX_DOWNLOAD_BYTES = 2 * 1024 * 1024;
const MAX_EXTRACTED_TEXT_CHARS = 16_000;
const SUMMARY_CHARS = 700;

export type SourceInputType =
  | "pasted_text"
  | "public_url"
  | "uploaded_txt_md"
  | "uploaded_pdf"
  | "uploaded_csv"
  | "screenshot_image"
  | "unsupported";

export type SourceExtractionStatus = "completed" | "partial" | "empty" | "unsupported" | "blocked" | "failed";
export type SourceAccessType = "pasted" | "public_url" | "upload";
export type SourcePermissionStatus = "allowed" | "permission_denied" | "blocked" | "unknown";

export interface SourceAcquisitionFileInput {
  originalFilename: string;
  mimeType?: string;
  sizeBytes?: number;
  content?: string | Uint8Array | ArrayBuffer;
}

export interface SourceAcquisitionInput {
  tenantId: string;
  workspaceId: string;
  userId: string;
  sessionId: string;
  requestId: string;
  text?: string;
  url?: string;
  file?: SourceAcquisitionFileInput;
  sourceTitle?: string;
  nowIso?: string;
  timezone?: string;
}

export interface DetectedSourceInput {
  input_type: SourceInputType;
  source_type: SourceIngestionSourceType;
  access_type: SourceAccessType;
  url?: string;
  text?: string;
  original_filename?: string;
  mime_type?: string;
  size_bytes?: number;
  warnings: string[];
  errors: string[];
}

export interface PublicUrlFetchResult {
  status: SourceExtractionStatus;
  original_url: string;
  canonical_url?: string;
  mime_type?: string;
  size_bytes?: number;
  body?: Uint8Array;
  text?: string;
  warnings: string[];
  errors: string[];
  permission_status: SourcePermissionStatus;
  retrieved_at: string;
}

export interface ExtractedSource {
  status: SourceExtractionStatus;
  source_text: string;
  extracted_summary: string;
  visual_summary?: string;
  table_summary?: string;
  detected_language: string;
  warnings: string[];
  errors: string[];
  content_hash: string;
}

function trimString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function firstUrl(value: string): string | undefined {
  return value.match(/\bhttps?:\/\/[^\s<>"')]+/i)?.[0];
}

function mimeFromFilename(filename: string): string {
  const lower = filename.toLowerCase();

  if (lower.endsWith(".md") || lower.endsWith(".markdown")) return "text/markdown";
  if (lower.endsWith(".txt")) return "text/plain";
  if (lower.endsWith(".csv")) return "text/csv";
  if (lower.endsWith(".pdf")) return "application/pdf";
  if (/\.(png|jpe?g|webp|gif)$/i.test(lower)) return lower.endsWith(".png") ? "image/png" : "image/jpeg";

  return "application/octet-stream";
}

function detectedFileType(filename: string, mimeType: string): Pick<DetectedSourceInput, "input_type" | "source_type" | "access_type"> {
  if (mimeType.includes("pdf") || /\.pdf$/i.test(filename)) {
    return { input_type: "uploaded_pdf", source_type: "document", access_type: "upload" };
  }

  if (mimeType.includes("csv") || /\.csv$/i.test(filename)) {
    return { input_type: "uploaded_csv", source_type: "spreadsheet", access_type: "upload" };
  }

  if (mimeType.startsWith("image/") || /\.(png|jpe?g|webp|gif)$/i.test(filename)) {
    return { input_type: "screenshot_image", source_type: "screenshot", access_type: "upload" };
  }

  if (mimeType.startsWith("text/") || /\.(txt|md|markdown)$/i.test(filename)) {
    return { input_type: "uploaded_txt_md", source_type: "document", access_type: "upload" };
  }

  return { input_type: "unsupported", source_type: "other", access_type: "upload" };
}

export function detectInputType(input: string | Partial<SourceAcquisitionInput>): DetectedSourceInput {
  const source = typeof input === "string" ? { text: input } : input;
  const text = trimString(source.text);
  const explicitUrl = trimString(source.url);
  const url = explicitUrl || (text ? firstUrl(text) : undefined);

  if (url) {
    return {
      input_type: "public_url",
      source_type: "url",
      access_type: "public_url",
      url,
      text,
      warnings: [],
      errors: [],
    };
  }

  if (source.file) {
    const filename = trimString(source.file.originalFilename) || "uploaded-source";
    const mimeType = trimString(source.file.mimeType) || mimeFromFilename(filename);

    return {
      ...detectedFileType(filename, mimeType),
      original_filename: filename,
      mime_type: mimeType,
      size_bytes: source.file.sizeBytes,
      warnings: [],
      errors: [],
    };
  }

  if (text) {
    return {
      input_type: "pasted_text",
      source_type: "text",
      access_type: "pasted",
      text,
      warnings: [],
      errors: [],
    };
  }

  return {
    input_type: "unsupported",
    source_type: "other",
    access_type: "pasted",
    warnings: [],
    errors: ["No supported source input was provided."],
  };
}

function normalizeExtractedText(value: string): string {
  return value.replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").replace(/[ \t]{2,}/g, " ").trim();
}

function truncateText(value: string, maxChars = MAX_EXTRACTED_TEXT_CHARS): string {
  return value.length > maxChars ? `${value.slice(0, maxChars).trimEnd()}\n\n[truncated]` : value;
}

function contentHash(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function basicSummary(value: string): string {
  const compact = value.replace(/\s+/g, " ").trim();

  return compact.length > SUMMARY_CHARS ? `${compact.slice(0, SUMMARY_CHARS - 3).trimEnd()}...` : compact;
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_match, code) => String.fromCodePoint(Number(code)));
}

function textFromHtml(value: string): string {
  const withoutUnsafeBlocks = value
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ");
  const withBreaks = withoutUnsafeBlocks
    .replace(/<\/(p|div|li|tr|h[1-6]|section|article)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n");

  return decodeHtmlEntities(withBreaks.replace(/<[^>]+>/g, " "));
}

function titleFromHtml(value: string): string | undefined {
  const title = value.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];

  return title ? normalizeExtractedText(decodeHtmlEntities(title)) : undefined;
}

function detectLanguage(value: string): string {
  return /[ăâđêôơưáàảãạắằẳẵặấầẩẫậéèẻẽẹếềểễệíìỉĩịóòỏõọốồổỗộớờởỡợúùủũụứừửữựýỳỷỹỵ]/i.test(value)
    ? "vi"
    : "en";
}

function parseCsvRows(csv: string, maxRows = 25): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;

  for (let index = 0; index < csv.length; index += 1) {
    const char = csv[index];
    const next = csv[index + 1];

    if (quoted && char === "\"" && next === "\"") {
      cell += "\"";
      index += 1;
      continue;
    }

    if (char === "\"") {
      quoted = !quoted;
      continue;
    }

    if (!quoted && char === ",") {
      row.push(cell.trim());
      cell = "";
      continue;
    }

    if (!quoted && (char === "\n" || char === "\r")) {
      if (char === "\r" && next === "\n") {
        index += 1;
      }
      row.push(cell.trim());
      if (row.some(Boolean)) {
        rows.push(row);
      }
      if (rows.length >= maxRows) {
        return rows;
      }
      row = [];
      cell = "";
      continue;
    }

    cell += char;
  }

  row.push(cell.trim());
  if (row.some(Boolean) && rows.length < maxRows) {
    rows.push(row);
  }

  return rows;
}

export function extractCsv(value: string): ExtractedSource {
  const normalized = normalizeExtractedText(value);
  const rows = parseCsvRows(normalized);
  const headers = rows[0] ?? [];
  const dataRows = rows.slice(1);
  const tableSummary = headers.length
    ? `CSV table with ${headers.length} columns (${headers.slice(0, 12).join(", ")}) and at least ${dataRows.length} data rows sampled.`
    : "CSV table detected, but no header row was found in the sample.";

  return {
    status: normalized ? "completed" : "empty",
    source_text: truncateText(normalized),
    extracted_summary: basicSummary(normalized) || tableSummary,
    table_summary: tableSummary,
    detected_language: detectLanguage(normalized),
    warnings: normalized.length > MAX_EXTRACTED_TEXT_CHARS ? ["CSV source_text was truncated for CMO review."] : [],
    errors: [],
    content_hash: contentHash(normalized),
  };
}

export function extractPdf(value: Uint8Array | ArrayBuffer | string): ExtractedSource {
  void value;
  const summary = "PDF received, but PDF text extraction is not wired in this build. Upload TXT/MD or paste the key excerpt for review.";

  return {
    status: "unsupported",
    source_text: "",
    extracted_summary: summary,
    detected_language: "unknown",
    warnings: [summary],
    errors: [],
    content_hash: contentHash("pdf-extraction-unsupported"),
  };
}

export function extractText(value: string | Uint8Array | ArrayBuffer, options: { mimeType?: string; filename?: string } = {}): ExtractedSource {
  const bytes = typeof value === "string" ? undefined : value instanceof Uint8Array ? value : new Uint8Array(value);
  const raw = typeof value === "string" ? value : new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  const mimeType = options.mimeType ?? "";
  const filename = options.filename ?? "";
  const isHtml = mimeType.includes("html") || /^\s*<!doctype html|^\s*<html[\s>]/i.test(raw);
  const isCsv = mimeType.includes("csv") || /\.csv$/i.test(filename);

  if (isCsv) {
    return extractCsv(raw);
  }

  const normalized = normalizeExtractedText(isHtml ? textFromHtml(raw) : raw);
  const warnings = normalized.length > MAX_EXTRACTED_TEXT_CHARS ? ["Extracted source_text was truncated for CMO review."] : [];

  return {
    status: normalized ? "completed" : "empty",
    source_text: truncateText(normalized),
    extracted_summary: basicSummary(normalized),
    detected_language: detectLanguage(normalized),
    warnings,
    errors: [],
    content_hash: contentHash(normalized),
  };
}

function isPrivateIpv4(ip: string): boolean {
  const parts = ip.split(".").map(Number);
  const [a, b] = parts;

  return a === 10 ||
    a === 127 ||
    a === 0 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 169 && b === 254) ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 192 && b === 0) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224;
}

function isPrivateIpv6(ip: string): boolean {
  const normalized = ip.toLowerCase();

  return normalized === "::1" ||
    normalized === "::" ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    normalized.startsWith("fe80:") ||
    normalized.startsWith("::ffff:127.") ||
    normalized.startsWith("::ffff:10.") ||
    normalized.startsWith("::ffff:192.168.") ||
    normalized.startsWith("::ffff:169.254.");
}

async function assertPublicHttpUrl(url: URL): Promise<void> {
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Only public http(s) URLs are supported for source acquisition.");
  }

  const hostname = url.hostname.toLowerCase();
  if (hostname === "localhost" || hostname.endsWith(".localhost") || hostname === "metadata.google.internal") {
    throw new Error("Blocked private or metadata hostname.");
  }

  const ipVersion = isIP(hostname);
  const addresses = ipVersion ? [{ address: hostname, family: ipVersion }] : await lookup(hostname, { all: true, verbatim: true });
  for (const address of addresses) {
    const blocked = address.family === 4 ? isPrivateIpv4(address.address) : isPrivateIpv6(address.address);
    if (blocked) {
      throw new Error("Blocked localhost, private LAN, link-local, or metadata IP address.");
    }
  }
}

function googleWorkspacePermissionIssue(url: URL): string | null {
  const host = url.hostname.toLowerCase();
  const isGoogleDoc = host === "docs.google.com" || host === "drive.google.com";
  const looksPublished = /\/pub\b|\/export\b/i.test(url.pathname) || url.searchParams.has("exportFormat") || url.searchParams.has("format");

  return isGoogleDoc && !looksPublished
    ? "Google Docs/Sheets links must be publicly published/exportable. Private Google OAuth is not connected yet."
    : null;
}

async function readBoundedResponse(response: Response): Promise<{ body: Uint8Array; sizeBytes: number; truncated: boolean }> {
  const reader = response.body?.getReader();

  if (!reader) {
    const body = new Uint8Array(await response.arrayBuffer());
    return {
      body: body.slice(0, MAX_DOWNLOAD_BYTES),
      sizeBytes: body.byteLength,
      truncated: body.byteLength > MAX_DOWNLOAD_BYTES,
    };
  }

  const chunks: Uint8Array[] = [];
  let total = 0;
  let truncated = false;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;

    total += value.byteLength;
    if (total > MAX_DOWNLOAD_BYTES) {
      const allowed = Math.max(0, value.byteLength - (total - MAX_DOWNLOAD_BYTES));
      if (allowed > 0) {
        chunks.push(value.slice(0, allowed));
      }
      truncated = true;
      await reader.cancel();
      break;
    }
    chunks.push(value);
  }

  const body = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0));
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return { body, sizeBytes: total, truncated };
}

export async function fetchPublicUrl(rawUrl: string, nowIso = new Date().toISOString()): Promise<PublicUrlFetchResult> {
  const originalUrl = rawUrl.trim();
  let current: URL;

  try {
    current = new URL(originalUrl);
  } catch {
    return {
      status: "blocked",
      original_url: originalUrl,
      warnings: [],
      errors: ["Invalid URL."],
      permission_status: "blocked",
      retrieved_at: nowIso,
    };
  }

  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
    const googlePermission = googleWorkspacePermissionIssue(current);
    if (googlePermission) {
      return {
        status: "blocked",
        original_url: originalUrl,
        canonical_url: current.toString(),
        warnings: [googlePermission],
        errors: [googlePermission],
        permission_status: "permission_denied",
        retrieved_at: nowIso,
      };
    }

    try {
      await assertPublicHttpUrl(current);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Blocked URL.";
      return {
        status: "blocked",
        original_url: originalUrl,
        canonical_url: current.toString(),
        warnings: [],
        errors: [message],
        permission_status: "blocked",
        retrieved_at: nowIso,
      };
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    try {
      const response = await fetch(current, {
        method: "GET",
        headers: {
          Accept: "text/html,text/plain,text/markdown,text/csv,application/pdf;q=0.8,*/*;q=0.2",
          "User-Agent": "CMO-Engine-Source-Acquisition/1.0",
        },
        cache: "no-store",
        redirect: "manual",
        signal: controller.signal,
      });

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        if (!location) {
          return {
            status: "failed",
            original_url: originalUrl,
            canonical_url: current.toString(),
            warnings: [],
            errors: [`Redirect from ${current.toString()} did not include a Location header.`],
            permission_status: "unknown",
            retrieved_at: nowIso,
          };
        }
        current = new URL(location, current);
        continue;
      }

      if (!response.ok) {
        const permissionDenied = response.status === 401 || response.status === 403;
        return {
          status: permissionDenied ? "blocked" : "failed",
          original_url: originalUrl,
          canonical_url: current.toString(),
          mime_type: response.headers.get("content-type") ?? undefined,
          warnings: permissionDenied ? ["The source appears private or permission-gated."] : [],
          errors: [`Source fetch returned HTTP ${response.status}.`],
          permission_status: permissionDenied ? "permission_denied" : "unknown",
          retrieved_at: nowIso,
        };
      }

      const { body, sizeBytes, truncated } = await readBoundedResponse(response);
      const mimeType = response.headers.get("content-type")?.split(";")[0]?.trim();

      return {
        status: "completed",
        original_url: originalUrl,
        canonical_url: current.toString(),
        mime_type: mimeType,
        size_bytes: sizeBytes,
        body,
        text: new TextDecoder("utf-8", { fatal: false }).decode(body),
        warnings: truncated ? [`Download exceeded ${MAX_DOWNLOAD_BYTES} bytes and was truncated.`] : [],
        errors: [],
        permission_status: "allowed",
        retrieved_at: nowIso,
      };
    } catch (error) {
      return {
        status: "failed",
        original_url: originalUrl,
        canonical_url: current.toString(),
        warnings: [],
        errors: [error instanceof Error && error.name === "AbortError" ? "Source fetch timed out." : "Source fetch failed."],
        permission_status: "unknown",
        retrieved_at: nowIso,
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  return {
    status: "blocked",
    original_url: originalUrl,
    canonical_url: current.toString(),
    warnings: [],
    errors: [`Redirect limit of ${MAX_REDIRECTS} exceeded.`],
    permission_status: "blocked",
    retrieved_at: nowIso,
  };
}

function fallbackTitle(input: SourceAcquisitionInput, detected: DetectedSourceInput, urlTitle?: string): string {
  return trimString(input.sourceTitle) ||
    urlTitle ||
    detected.original_filename ||
    detected.url ||
    "Pasted source";
}

function reviewContextFromExtraction(
  input: SourceAcquisitionInput,
  detected: DetectedSourceInput,
  extraction: ExtractedSource,
  metadata: {
    sourceTitle?: string;
    originalUrl?: string;
    canonicalUrl?: string;
    originalFilename?: string;
    mimeType?: string;
    sizeBytes?: number;
    retrievedAt?: string;
    accessType?: SourceAccessType;
    permissionStatus?: SourcePermissionStatus;
  } = {},
): CmoSourceReviewContext {
  return {
    schema_version: SOURCE_REVIEW_CONTEXT_SCHEMA_VERSION,
    mode: "review_only",
    tenant_id: input.tenantId,
    workspace_id: input.workspaceId,
    user_id: input.userId,
    session_id: input.sessionId,
    request_id: input.requestId,
    source: {
      source_id: `source_review_${contentHash([
        input.workspaceId,
        metadata.canonicalUrl,
        metadata.originalFilename,
        extraction.content_hash,
      ].filter(Boolean).join(":")).slice(0, 16)}`,
      source_type: detected.source_type,
      source_title: metadata.sourceTitle ?? fallbackTitle(input, detected),
      original_url: metadata.originalUrl ?? null,
      canonical_url: metadata.canonicalUrl ?? null,
      original_filename: metadata.originalFilename ?? detected.original_filename ?? null,
      mime_type: metadata.mimeType ?? detected.mime_type ?? null,
      size_bytes: metadata.sizeBytes ?? detected.size_bytes ?? null,
      retrieved_at: metadata.retrievedAt ?? input.nowIso ?? new Date().toISOString(),
      timezone: input.timezone ?? CMO_RUNTIME_TIMEZONE,
      access_type: metadata.accessType ?? detected.access_type,
      permission_status: metadata.permissionStatus ?? "allowed",
    },
    extraction: {
      status: extraction.status,
      content_hash: extraction.content_hash,
      source_text: extraction.source_text,
      extracted_summary: extraction.extracted_summary,
      visual_summary: extraction.visual_summary ?? null,
      table_summary: extraction.table_summary ?? null,
      detected_language: extraction.detected_language,
      warnings: [...detected.warnings, ...extraction.warnings],
      errors: [...detected.errors, ...extraction.errors],
    },
    safety: {
      read_only: true,
      vault_mutation: false,
      gbrain_mutation: false,
      no_promotion: true,
    },
  };
}

export async function buildSourceReviewContext(input: SourceAcquisitionInput): Promise<CmoSourceReviewContext> {
  const detected = detectInputType(input);

  if (detected.input_type === "public_url" && detected.url) {
    const fetched = await fetchPublicUrl(detected.url, input.nowIso);
    if (fetched.status !== "completed" || !fetched.body) {
      const extraction: ExtractedSource = {
        status: fetched.status,
        source_text: "",
        extracted_summary: fetched.errors[0] ?? fetched.warnings[0] ?? "Source could not be fetched for review.",
        detected_language: "unknown",
        warnings: fetched.warnings,
        errors: fetched.errors,
        content_hash: contentHash(`${fetched.status}:${fetched.canonical_url ?? fetched.original_url}`),
      };

      return reviewContextFromExtraction(input, detected, extraction, {
        originalUrl: fetched.original_url,
        canonicalUrl: fetched.canonical_url,
        mimeType: fetched.mime_type,
        sizeBytes: fetched.size_bytes,
        retrievedAt: fetched.retrieved_at,
        accessType: "public_url",
        permissionStatus: fetched.permission_status,
      });
    }

    const fetchedText = fetched.text ?? new TextDecoder("utf-8", { fatal: false }).decode(fetched.body);
    const extraction = fetched.mime_type?.includes("pdf")
      ? extractPdf(fetched.body)
      : extractText(fetchedText, { mimeType: fetched.mime_type });
    const htmlTitle = fetched.mime_type?.includes("html") ? titleFromHtml(fetchedText) : undefined;

    return reviewContextFromExtraction(input, detected, {
      ...extraction,
      warnings: [...fetched.warnings, ...extraction.warnings],
    }, {
      sourceTitle: fallbackTitle(input, detected, htmlTitle),
      originalUrl: fetched.original_url,
      canonicalUrl: fetched.canonical_url,
      mimeType: fetched.mime_type,
      sizeBytes: fetched.size_bytes,
      retrievedAt: fetched.retrieved_at,
      accessType: "public_url",
      permissionStatus: fetched.permission_status,
    });
  }

  if (detected.input_type === "uploaded_pdf" && input.file?.content) {
    return reviewContextFromExtraction(input, detected, extractPdf(input.file.content), {
      originalFilename: detected.original_filename,
      mimeType: detected.mime_type,
      sizeBytes: detected.size_bytes,
      accessType: "upload",
    });
  }

  if (detected.input_type === "screenshot_image") {
    const summary = "Image received. Vision extraction is not wired yet, so only file metadata is available for CMO review.";
    return reviewContextFromExtraction(input, detected, {
      status: "unsupported",
      source_text: "",
      extracted_summary: summary,
      visual_summary: summary,
      detected_language: "unknown",
      warnings: [summary],
      errors: [],
      content_hash: contentHash(`${detected.original_filename ?? "image"}:${detected.size_bytes ?? 0}`),
    }, {
      originalFilename: detected.original_filename,
      mimeType: detected.mime_type,
      sizeBytes: detected.size_bytes,
      accessType: "upload",
    });
  }

  const fileContent = input.file?.content;
  const rawText = typeof fileContent === "string"
    ? fileContent
    : fileContent
      ? new TextDecoder("utf-8", { fatal: false }).decode(fileContent instanceof Uint8Array ? fileContent : new Uint8Array(fileContent))
      : detected.text ?? input.text ?? "";
  const extraction = detected.input_type === "uploaded_csv"
    ? extractCsv(rawText)
    : extractText(rawText, { mimeType: detected.mime_type, filename: detected.original_filename });

  return reviewContextFromExtraction(input, detected, extraction, {
    originalFilename: detected.original_filename,
    mimeType: detected.mime_type,
    sizeBytes: detected.size_bytes,
    accessType: detected.access_type,
  });
}

export function buildVaultIngestionPackage(
  context: CmoSourceReviewContext,
  options: {
    appId?: string;
    scope?: "user" | "workspace" | "session";
    visibility?: "private" | "workspace";
  } = {},
): SourceIngestionPackage {
  const source = context.source;
  const extraction = context.extraction;

  return buildSourceIngestionPackage({
    appId: options.appId ?? context.workspace_id,
    tenant_id: context.tenant_id,
    workspace_id: context.workspace_id,
    session_id: context.session_id,
    source_type: trimString(source.source_type) as SourceIngestionSourceType,
    source_title: trimString(source.source_title) || "Acquired source",
    original_url: trimString(source.original_url),
    canonical_url: trimString(source.canonical_url),
    original_filename: trimString(source.original_filename),
    mime_type: trimString(source.mime_type),
    size_bytes: typeof source.size_bytes === "number" ? source.size_bytes : undefined,
    source_text: trimString(extraction.source_text),
    extracted_summary: trimString(extraction.extracted_summary),
    visual_summary: trimString(extraction.visual_summary),
    table_summary: trimString(extraction.table_summary),
    original_language: trimString(extraction.detected_language) || "unknown",
    retrieved_at: trimString(source.retrieved_at),
    timezone: trimString(source.timezone) || CMO_RUNTIME_TIMEZONE,
    extraction: {
      status: trimString(extraction.status),
      content_hash: trimString(extraction.content_hash),
      detected_language: trimString(extraction.detected_language),
      warnings: Array.isArray(extraction.warnings) ? extraction.warnings.filter((item): item is string => typeof item === "string") : [],
      errors: Array.isArray(extraction.errors) ? extraction.errors.filter((item): item is string => typeof item === "string") : [],
    },
    source_refs: [`source_review:${trimString(source.source_id) || context.request_id}`],
    scope: options.scope ?? "session",
    visibility: options.visibility ?? "workspace",
  }, {
    authMode: "legacy",
    userId: context.user_id,
  }, trimString(source.retrieved_at) || new Date().toISOString());
}

export function buildRuntimeContext(input: { now?: Date; nowIso?: string; userIdentity?: CmoServerUserIdentity } = {}): CmoRuntimeContext {
  const userDisplayName = input.userIdentity?.userEmail?.trim() || input.userIdentity?.createdByEmail?.trim();

  return {
    now_iso: input.nowIso ?? input.now?.toISOString() ?? new Date().toISOString(),
    timezone: CMO_RUNTIME_TIMEZONE,
    timezone_label: CMO_RUNTIME_TIMEZONE_LABEL,
    locale: CMO_RUNTIME_LOCALE,
    ...(userDisplayName ? { user_display_name: userDisplayName } : {}),
  };
}

export function buildRuntimeContextText(context: CmoRuntimeContext): string {
  return [
    `now_iso: ${context.now_iso}`,
    `timezone: ${context.timezone}`,
    `timezone_label: ${context.timezone_label}`,
    `locale: ${context.locale}`,
    context.user_display_name ? `user_display_name: ${context.user_display_name}` : "",
  ].filter(Boolean).join("\n");
}

export async function buildSourceReviewContextFromMessage(input: Omit<SourceAcquisitionInput, "url" | "text"> & { message: string }): Promise<CmoSourceReviewContext | undefined> {
  const url = firstUrl(input.message);

  if (!url) {
    return undefined;
  }

  return buildSourceReviewContext({
    ...input,
    text: input.message,
    url,
  });
}
