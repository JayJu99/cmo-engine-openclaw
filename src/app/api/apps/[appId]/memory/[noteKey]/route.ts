import { readAppMemoryNote, updateAppMemoryNote } from "@/lib/cmo/vault-files";
import type { AppMemoryUpdateRequest } from "@/lib/cmo/app-workspace-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function readRequestPayload(request: Request): Promise<unknown> {
  const text = await request.text();

  if (!text.trim()) {
    return {};
  }

  return JSON.parse(text) as unknown;
}

function statusForError(error: unknown): number {
  if (!(error instanceof Error)) {
    return 500;
  }

  if (error.name === "AppMemoryConflictError") {
    return 409;
  }

  if (error.message.startsWith("Unknown appId")) {
    return 404;
  }

  if (error.message.startsWith("Invalid") || error.message.includes("read-mostly")) {
    return 400;
  }

  return 500;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeUpdateRequest(value: unknown): AppMemoryUpdateRequest {
  const record = isRecord(value) ? value : {};

  return {
    body: typeof record.body === "string" ? record.body : undefined,
    status:
      record.status === "placeholder" || record.status === "draft" || record.status === "confirmed"
        ? record.status
        : undefined,
    expectedHash: typeof record.expectedHash === "string" ? record.expectedHash : undefined,
    resetToPlaceholder: record.resetToPlaceholder === true,
  };
}

export async function GET(_request: Request, context: RouteContext<"/api/apps/[appId]/memory/[noteKey]">) {
  try {
    const { appId, noteKey } = await context.params;

    return Response.json({ data: await readAppMemoryNote(appId, noteKey) });
  } catch (error) {
    return Response.json(
      {
        error: error instanceof Error ? error.message : "App memory note read failed",
        code: "app_memory_note_read_failed",
      },
      { status: statusForError(error) },
    );
  }
}

export async function PATCH(request: Request, context: RouteContext<"/api/apps/[appId]/memory/[noteKey]">) {
  try {
    const { appId, noteKey } = await context.params;
    const body = await readRequestPayload(request);

    return Response.json({ data: await updateAppMemoryNote(appId, noteKey, normalizeUpdateRequest(body)) });
  } catch (error) {
    if (error instanceof SyntaxError) {
      return Response.json(
        {
          error: "Invalid JSON request body",
          code: "app_memory_invalid_json_body",
        },
        { status: 400 },
      );
    }

    return Response.json(
      {
        error: error instanceof Error ? error.message : "App memory note write failed",
        code: "app_memory_note_write_failed",
      },
      { status: statusForError(error) },
    );
  }
}
