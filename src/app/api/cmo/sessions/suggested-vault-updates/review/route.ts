import { updateSuggestedVaultUpdateReview } from "@/lib/cmo/app-chat-store";
import type { CmoVaultUpdateReviewAction } from "@/lib/cmo/app-workspace-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringField(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function reviewAction(value: string): CmoVaultUpdateReviewAction | null {
  return value === "approved" || value === "rejected" || value === "deferred" ? value : null;
}

export async function POST(request: Request) {
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body.", code: "vault_update_review_invalid_json" }, { status: 400 });
  }

  if (!isRecord(body)) {
    return Response.json({ error: "Request body must be an object.", code: "vault_update_review_invalid_body" }, { status: 400 });
  }

  const appId = stringField(body.appId);
  const sessionId = stringField(body.sessionId);
  const candidateKey = stringField(body.candidateKey);
  const action = reviewAction(stringField(body.action));

  if (!appId || !sessionId || !candidateKey || !action) {
    return Response.json(
      {
        error: "appId, sessionId, candidateKey, and action are required.",
        code: "vault_update_review_missing_fields",
      },
      { status: 400 },
    );
  }

  try {
    const session = await updateSuggestedVaultUpdateReview({
      appId,
      sessionId,
      candidateKey,
      action,
    });

    if (!session) {
      return Response.json({ error: "Session not found.", code: "vault_update_review_session_not_found" }, { status: 404 });
    }

    return Response.json({ data: session });
  } catch (error) {
    return Response.json(
      {
        error: error instanceof Error ? error.message : "Suggested Vault update review failed.",
        code: "vault_update_review_failed",
      },
      { status: 400 },
    );
  }
}
