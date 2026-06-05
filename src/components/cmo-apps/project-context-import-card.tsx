"use client";

import { useMemo, useRef, useState } from "react";

import { icons } from "@/components/dashboard/icons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import {
  PROJECT_CONTEXT_IMPORT_REQUEST_SCHEMA_VERSION,
  type ProjectContextDocType,
  type ProjectContextImportFile,
  type ProjectContextImportReceiptV1,
} from "@/lib/cmo/project-context-import-types";
import type { AppWorkspace } from "@/lib/cmo/app-workspace-types";
import { cn } from "@/lib/utils";

interface ProjectContextImportCardProps {
  app: AppWorkspace;
  onImported?: () => void | Promise<void>;
}

interface ConfirmReceipt {
  schema_version?: string;
  status?: string;
  deduped?: boolean;
  conflict?: boolean;
  workspace_id?: string;
  app_id?: string;
  project_name?: string;
  source_count?: number;
  accepted_count?: number;
  deduped_count?: number;
  source_paths?: string[];
  accepted_paths?: string[];
  target_paths?: string[];
  warnings?: string[];
  errors?: string[];
  vault_write_performed?: boolean;
  gbrain_called?: boolean;
  promotion_performed?: boolean;
}

interface ConfirmResponse {
  ok?: boolean;
  status?: string;
  receipt?: ConfirmReceipt;
  warnings?: string[];
  errors?: string[];
}

type ImportStatus = "idle" | "reading" | "previewing" | "confirming" | "completed" | "error";

const allowedMarkdownMimeTypes = new Set(["text/markdown", "text/plain", ""]);

function receiptList(values: unknown): string[] {
  return Array.isArray(values) ? values.filter((value): value is string => typeof value === "string" && value.trim().length > 0) : [];
}

async function readJsonResponse<T>(response: Response): Promise<T> {
  const payload = (await response.json()) as unknown;

  if (!response.ok) {
    const record = typeof payload === "object" && payload !== null && !Array.isArray(payload) ? (payload as Record<string, unknown>) : null;
    const message = typeof record?.error === "string" ? record.error : typeof record?.status === "string" ? record.status : "Request failed";

    throw new Error(`${response.status} ${message}`);
  }

  return payload as T;
}

function isMarkdownFile(file: File): boolean {
  return file.name.toLowerCase().endsWith(".md") && allowedMarkdownMimeTypes.has(file.type);
}

function detectedDocTypesByFile(receipt: ProjectContextImportReceiptV1 | null): Map<string, ProjectContextDocType> {
  const lookup = new Map<string, ProjectContextDocType>();

  receipt?.detected.forEach((file) => lookup.set(file.client_file_id, file.doc_type));

  return lookup;
}

function confirmReceiptPaths(receipt: ConfirmReceipt | null): string[] {
  if (!receipt) {
    return [];
  }

  return [...receiptList(receipt.source_paths), ...receiptList(receipt.accepted_paths), ...receiptList(receipt.target_paths)];
}

export function ProjectContextImportCard({ app, onImported }: ProjectContextImportCardProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [files, setFiles] = useState<ProjectContextImportFile[]>([]);
  const [previewReceipt, setPreviewReceipt] = useState<ProjectContextImportReceiptV1 | null>(null);
  const [confirmReceipt, setConfirmReceipt] = useState<ConfirmReceipt | null>(null);
  const [status, setStatus] = useState<ImportStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);

  const docTypeLookup = useMemo(() => detectedDocTypesByFile(previewReceipt), [previewReceipt]);
  const previewWarnings = previewReceipt?.warnings ?? [];
  const previewErrors = previewReceipt?.errors ?? [];
  const confirmErrors = confirmReceipt?.errors ?? [];
  const confirmWarnings = confirmReceipt?.warnings ?? [];
  const hasDetectedFiles = Boolean(previewReceipt?.detected.length);
  const hasBlockingConflict = Boolean(previewReceipt?.conflicts.length);
  const hasPreviewErrors = previewErrors.length > 0;
  const isBusy = status === "reading" || status === "previewing" || status === "confirming";
  const canConfirm = Boolean(previewReceipt) && hasDetectedFiles && !hasBlockingConflict && !hasPreviewErrors && !isBusy;

  function buildRequestPayload(mode: "preview" | "confirm", requestFiles: ProjectContextImportFile[]) {
    return {
      schema_version: PROJECT_CONTEXT_IMPORT_REQUEST_SCHEMA_VERSION,
      mode,
      tenant_id: app.tenantId,
      workspace_id: app.workspaceId,
      app_id: app.id,
      project_name: app.name,
      confirmation: {
        accepted_project_context: mode === "confirm",
        confirmed_by_user: mode === "confirm",
        overwrite_changed: false,
      },
      files: requestFiles,
    };
  }

  async function previewImport(nextFiles: ProjectContextImportFile[]) {
    setStatus("previewing");
    setError(null);
    setConfirmReceipt(null);

    const receipt = await readJsonResponse<ProjectContextImportReceiptV1>(
      await fetch(`/api/apps/${app.id}/project-context/import/preview`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(buildRequestPayload("preview", nextFiles)),
      }),
    );

    setPreviewReceipt(receipt);
    setStatus("idle");
  }

  async function handleFiles(selectedFiles: FileList | File[]) {
    const selected = Array.from(selectedFiles);
    const markdownFiles = selected.filter(isMarkdownFile);

    setStatus("reading");
    setError(null);
    setPreviewReceipt(null);
    setConfirmReceipt(null);

    if (markdownFiles.length === 0) {
      setFiles([]);
      setStatus("idle");
      setError("Select one or more markdown .md files.");
      return;
    }

    try {
      const nextFiles = await Promise.all(
        markdownFiles.map(async (file, index) => ({
          client_file_id: `file-${index + 1}-${file.name.replace(/[^a-zA-Z0-9_.-]/g, "-")}`,
          original_filename: file.name,
          mime_type: file.type || "text/markdown",
          content: await file.text(),
          size_bytes: file.size,
        })),
      );

      setFiles(nextFiles);
      await previewImport(nextFiles);
    } catch (readError) {
      setStatus("error");
      setError(readError instanceof Error ? readError.message : "Could not read project context files.");
    }
  }

  async function confirmImport() {
    if (!canConfirm) {
      return;
    }

    const confirmedFiles = files
      .map((file) => {
        const docType = docTypeLookup.get(file.client_file_id);

        return docType ? { ...file, doc_type: docType } : null;
      })
      .filter((file): file is ProjectContextImportFile & { doc_type: ProjectContextDocType } => file !== null);

    setStatus("confirming");
    setError(null);

    try {
      const response = await readJsonResponse<ConfirmResponse>(
        await fetch(`/api/apps/${app.id}/project-context/import/confirm`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(buildRequestPayload("confirm", confirmedFiles)),
        }),
      );

      setConfirmReceipt(response.receipt ?? null);
      setStatus(response.ok ? "completed" : "error");

      if (response.receipt?.conflict || response.status === "conflict") {
        setError("Some files changed existing project context. Review before overwriting.");
        return;
      }

      if (!response.ok) {
        setError(response.errors?.[0] ?? "Project context import did not complete.");
        return;
      }

      await onImported?.();
    } catch (confirmError) {
      setStatus("error");
      setError(confirmError instanceof Error ? confirmError.message : "Project context import failed.");
    }
  }

  return (
    <Card className="p-5">
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-center gap-3">
          <div className="grid size-10 place-items-center rounded-xl bg-indigo-50 text-indigo-700 ring-1 ring-indigo-100">
            <icons.Upload />
          </div>
          <div>
            <CardTitle>Project Context Import</CardTitle>
            <CardDescription>Preview markdown project context, then import through Vault Agent.</CardDescription>
          </div>
        </div>
        <Badge variant={status === "completed" ? "green" : status === "error" ? "red" : isBusy ? "blue" : "slate"}>
          {status.replaceAll("_", " ")}
        </Badge>
      </div>

      <div
        onDragEnter={(event) => {
          event.preventDefault();
          setDragActive(true);
        }}
        onDragOver={(event) => {
          event.preventDefault();
          setDragActive(true);
        }}
        onDragLeave={() => setDragActive(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragActive(false);
          void handleFiles(event.dataTransfer.files);
        }}
        className={cn(
          "rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-5 text-sm font-medium text-slate-600 transition",
          dragActive ? "border-indigo-300 bg-indigo-50 text-indigo-800" : null,
        )}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept=".md,text/markdown,text/plain"
          multiple
          className="hidden"
          onChange={(event) => {
            if (event.target.files) {
              void handleFiles(event.target.files);
            }
          }}
        />
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="font-bold text-slate-950">Drop markdown files here</div>
            <div className="mt-1 text-xs font-semibold text-slate-500">Accepted: .md files for audience, positioning, product truth, campaign rules, and content pillars.</div>
          </div>
          <Button type="button" variant="outline" onClick={() => fileInputRef.current?.click()} disabled={isBusy}>
            <icons.Folder />
            Select .md files
          </Button>
        </div>
      </div>

      {files.length ? (
        <div className="mt-4 grid gap-2">
          {files.map((file) => (
            <div key={file.client_file_id} className="flex flex-col gap-2 rounded-xl border border-slate-100 bg-white px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <div className="truncate text-sm font-bold text-slate-950">{file.original_filename}</div>
                <div className="text-xs font-semibold text-slate-500">{file.size_bytes?.toLocaleString("en-US") ?? "unknown"} bytes</div>
              </div>
              <Badge variant={docTypeLookup.has(file.client_file_id) ? "green" : "orange"}>{docTypeLookup.get(file.client_file_id) ?? "unmapped"}</Badge>
            </div>
          ))}
        </div>
      ) : null}

      {previewReceipt ? (
        <div className="mt-5 space-y-4">
          <div className="flex flex-wrap gap-2">
            <Badge variant="blue">{previewReceipt.detected.length} detected</Badge>
            <Badge variant={previewReceipt.unmapped_files.length ? "orange" : "green"}>{previewReceipt.unmapped_files.length} unmapped</Badge>
            <Badge variant={previewReceipt.conflicts.length ? "red" : "green"}>{previewReceipt.conflicts.length} conflicts</Badge>
          </div>

          {previewReceipt.detected.length ? (
            <div className="grid gap-3">
              {previewReceipt.detected.map((detected) => (
                <div key={detected.client_file_id} className="rounded-xl border border-slate-100 bg-slate-50 px-4 py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="font-bold text-slate-950">{detected.original_filename}</div>
                    <Badge variant="green">{detected.doc_type}</Badge>
                    <Badge variant="slate">{detected.confidence}</Badge>
                    <Badge variant="blue">{detected.change_status}</Badge>
                  </div>
                  <div className="mt-2 space-y-1 text-xs font-semibold leading-5 text-slate-500">
                    <div className="break-all">Source: {detected.source_path}</div>
                    <div className="break-all">Accepted: {detected.accepted_path}</div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="rounded-xl border border-orange-100 bg-orange-50 px-4 py-3 text-sm font-semibold text-orange-800">No recognized project context files were detected.</div>
          )}

          {previewReceipt.unmapped_files.length ? (
            <div className="rounded-xl border border-orange-100 bg-orange-50 px-4 py-3">
              <div className="text-sm font-bold text-orange-900">Unmapped files</div>
              <div className="mt-2 grid gap-1 text-xs font-semibold text-orange-800">
                {previewReceipt.unmapped_files.map((file) => (
                  <div key={`${file.client_file_id}-${file.reason}`}>{file.original_filename || file.client_file_id}: {file.reason}</div>
                ))}
              </div>
            </div>
          ) : null}

          {previewReceipt.conflicts.length ? (
            <div className="rounded-xl border border-red-100 bg-red-50 px-4 py-3">
              <div className="text-sm font-bold text-red-900">Conflicts</div>
              <div className="mt-2 grid gap-1 text-xs font-semibold text-red-800">
                {previewReceipt.conflicts.map((conflict) => (
                  <div key={conflict.doc_type}>{conflict.doc_type}: {conflict.original_filenames.join(", ")}</div>
                ))}
              </div>
            </div>
          ) : null}

          {[...previewWarnings, ...previewErrors].length ? (
            <div className="rounded-xl border border-slate-100 bg-white px-4 py-3 text-xs font-semibold leading-5 text-slate-600">
              {[...previewWarnings, ...previewErrors].map((message) => (
                <div key={message}>{message}</div>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      {confirmReceipt ? (
        <div className="mt-5 rounded-xl border border-emerald-100 bg-emerald-50 px-4 py-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="font-bold text-emerald-950">Import receipt</div>
            <Badge variant={confirmReceipt.conflict ? "red" : confirmReceipt.status === "completed" ? "green" : "orange"}>{confirmReceipt.status ?? "unknown"}</Badge>
            {confirmReceipt.deduped ? <Badge variant="blue">deduped</Badge> : null}
          </div>
          <div className="mt-3 grid gap-2 text-xs font-semibold leading-5 text-emerald-900 md:grid-cols-3">
            <div>Source count: {confirmReceipt.source_count ?? "unknown"}</div>
            <div>Accepted count: {confirmReceipt.accepted_count ?? "unknown"}</div>
            <div>Deduped count: {confirmReceipt.deduped_count ?? "unknown"}</div>
          </div>
          {confirmReceiptPaths(confirmReceipt).length ? (
            <div className="mt-3 grid gap-1 text-xs font-semibold leading-5 text-emerald-900">
              {confirmReceiptPaths(confirmReceipt).map((path) => (
                <div key={path} className="break-all">{path}</div>
              ))}
            </div>
          ) : null}
          {[...confirmWarnings, ...confirmErrors].length ? (
            <div className="mt-3 grid gap-1 text-xs font-semibold leading-5 text-emerald-900">
              {[...confirmWarnings, ...confirmErrors].map((message) => (
                <div key={message}>{message}</div>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      {error ? <div className="mt-4 rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">{error}</div> : null}

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <Button type="button" onClick={() => void confirmImport()} disabled={!canConfirm}>
          {status === "confirming" ? <icons.RefreshCw className="animate-spin" /> : <icons.Check />}
          Import as project context
        </Button>
        <CardDescription>{canConfirm ? "Preview is ready to import." : "Preview valid project context files before importing."}</CardDescription>
      </div>
    </Card>
  );
}
