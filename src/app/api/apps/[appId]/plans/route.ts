import type { AppPlanType } from "@/lib/cmo/app-workspace-types";
import { createAppPlanNote, readAppPlans } from "@/lib/cmo/vault-files";

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

function planType(value: unknown): AppPlanType {
  return value === "monthly" ? "monthly" : "weekly";
}

export async function GET(_request: Request, context: RouteContext<"/api/apps/[appId]/plans">) {
  try {
    const { appId } = await context.params;

    return Response.json({ data: await readAppPlans(appId) });
  } catch (error) {
    return Response.json(
      {
        error: error instanceof Error ? error.message : "Plan read failed",
        code: "app_plans_read_failed",
      },
      { status: error instanceof Error && error.message.startsWith("Unknown appId") ? 404 : 500 },
    );
  }
}

export async function POST(request: Request, context: RouteContext<"/api/apps/[appId]/plans">) {
  try {
    const { appId } = await context.params;
    const body = await readRequestPayload(request);
    const type = planType(isRecord(body) ? body.type : undefined);
    const sourceSessionId = isRecord(body) && typeof body.sourceSessionId === "string" ? body.sourceSessionId : undefined;

    return Response.json({ data: await createAppPlanNote(appId, type, sourceSessionId) }, { status: 201 });
  } catch (error) {
    if (error instanceof SyntaxError) {
      return Response.json(
        {
          error: "Invalid JSON request body",
          code: "app_plan_invalid_json_body",
        },
        { status: 400 },
      );
    }

    if (error instanceof Error && error.name === "PlanAlreadyExistsError") {
      return Response.json(
        {
          error: error.message,
          code: "app_plan_already_exists",
        },
        { status: 409 },
      );
    }

    return Response.json(
      {
        error: error instanceof Error ? error.message : "Plan creation failed",
        code: "app_plan_create_failed",
      },
      { status: error instanceof Error && error.message.startsWith("Unknown appId") ? 404 : 500 },
    );
  }
}
