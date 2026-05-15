import { saveRawCapture } from "@/lib/cmo/vault-files";
import type { RawCaptureRequest } from "@/lib/cmo/app-workspace-types";

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

function isRawCaptureRequest(value: unknown): value is RawCaptureRequest {
  return (
    isRecord(value) &&
    typeof value.workspaceId === "string" &&
    typeof value.appId === "string" &&
    typeof value.appName === "string" &&
    typeof value.summary === "string" &&
    Array.isArray(value.messages) &&
    Array.isArray(value.contextUsed)
  );
}

export async function POST(request: Request) {
  try {
    const body = await readRequestPayload(request);

    if (!isRawCaptureRequest(body)) {
      return Response.json(
        {
          error: "Invalid raw capture request",
          code: "vault_raw_capture_invalid_request",
        },
        { status: 400 },
      );
    }

    return Response.json(await saveRawCapture(body), { status: 201 });
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

    return Response.json(
      {
        error: error instanceof Error ? error.message : "Raw capture write failed",
        code: "vault_raw_capture_write_failed",
      },
      { status: 500 },
    );
  }
}
