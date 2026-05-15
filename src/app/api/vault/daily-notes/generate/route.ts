import { generateDailyNote } from "@/lib/cmo/vault-files";
import type { DailyNoteGenerateRequest } from "@/lib/cmo/app-workspace-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function readRequestPayload(request: Request): Promise<unknown> {
  const text = await request.text();

  if (!text.trim()) {
    return {};
  }

  return JSON.parse(text) as unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isDailyNoteGenerateRequest(value: unknown): value is DailyNoteGenerateRequest {
  return isRecord(value) && typeof value.workspaceId === "string";
}

export async function POST(request: Request) {
  try {
    const body = await readRequestPayload(request);

    if (!isDailyNoteGenerateRequest(body)) {
      return Response.json(
        {
          error: "Invalid daily note generation request",
          code: "vault_daily_note_invalid_request",
        },
        { status: 400 },
      );
    }

    return Response.json(await generateDailyNote(body), { status: 201 });
  } catch (error) {
    if (error instanceof SyntaxError) {
      return Response.json(
        {
          error: "Invalid JSON request body",
          code: "vault_invalid_json_body",
        },
        { status: 400 },
      );
    }

    if (error instanceof Error && error.name === "DailyNoteAlreadyExistsError") {
      return Response.json(
        {
          error: error.message,
          code: "vault_daily_note_already_exists",
        },
        { status: 409 },
      );
    }

    if (error instanceof Error && error.message.startsWith("No raw capture note found")) {
      return Response.json(
        {
          error: error.message,
          code: "vault_raw_capture_not_found",
        },
        { status: 404 },
      );
    }

    return Response.json(
      {
        error: error instanceof Error ? error.message : "Daily note generation failed",
        code: "vault_daily_note_generation_failed",
      },
      { status: 500 },
    );
  }
}
