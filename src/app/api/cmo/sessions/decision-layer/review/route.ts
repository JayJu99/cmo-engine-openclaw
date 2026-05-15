import {
  type DecisionLayerReviewItemType,
  updateDecisionLayerReview,
} from "@/lib/cmo/app-chat-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringField(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function itemType(value: string): DecisionLayerReviewItemType | null {
  return value === "decision" ||
    value === "assumption" ||
    value === "suggestedAction" ||
    value === "memoryCandidate" ||
    value === "taskCandidate"
    ? value
    : null;
}

export async function POST(request: Request) {
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body.", code: "decision_review_invalid_json" }, { status: 400 });
  }

  if (!isRecord(body)) {
    return Response.json({ error: "Request body must be an object.", code: "decision_review_invalid_body" }, { status: 400 });
  }

  const appId = stringField(body.appId);
  const sessionId = stringField(body.sessionId);
  const itemId = stringField(body.itemId);
  const reviewStatus = stringField(body.reviewStatus);
  const parsedItemType = itemType(stringField(body.itemType));

  if (!appId || !sessionId || !itemId || !reviewStatus || !parsedItemType) {
    return Response.json(
      {
        error: "appId, sessionId, itemType, itemId, and reviewStatus are required.",
        code: "decision_review_missing_fields",
      },
      { status: 400 },
    );
  }

  try {
    const session = await updateDecisionLayerReview({
      appId,
      sessionId,
      itemType: parsedItemType,
      itemId,
      reviewStatus,
      reviewedBy: stringField(body.reviewedBy) || undefined,
      reviewNote: stringField(body.reviewNote) || undefined,
    });

    if (!session) {
      return Response.json({ error: "Session not found.", code: "decision_review_session_not_found" }, { status: 404 });
    }

    return Response.json({ data: session });
  } catch (error) {
    return Response.json(
      {
        error: error instanceof Error ? error.message : "Decision review update failed.",
        code: "decision_review_failed",
      },
      { status: 400 },
    );
  }
}
