import { runSuggestedVaultUpdateDryRun } from "@/lib/cmo/app-chat-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringField(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export async function POST(request: Request) {
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body.", code: "vault_update_dry_run_invalid_json" }, { status: 400 });
  }

  if (!isRecord(body)) {
    return Response.json({ error: "Request body must be an object.", code: "vault_update_dry_run_invalid_body" }, { status: 400 });
  }

  const appId = stringField(body.appId);
  const sessionId = stringField(body.sessionId);
  const approvalId = stringField(body.approvalId);

  if (!appId || !sessionId || !approvalId) {
    return Response.json(
      {
        error: "appId, sessionId, and approvalId are required.",
        code: "vault_update_dry_run_missing_fields",
      },
      { status: 400 },
    );
  }

  try {
    const session = await runSuggestedVaultUpdateDryRun({
      appId,
      sessionId,
      approvalId,
    });

    if (!session) {
      return Response.json({ error: "Session not found.", code: "vault_update_dry_run_session_not_found" }, { status: 404 });
    }

    return Response.json({ data: session });
  } catch (error) {
    return Response.json(
      {
        error: error instanceof Error ? error.message : "Suggested Vault update dry-run failed.",
        code: "vault_update_dry_run_failed",
      },
      { status: 400 },
    );
  }
}
