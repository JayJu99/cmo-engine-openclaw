import { requireRequestUserIfAuthRequired } from "@/lib/cmo/auth";
import { getGoogleLensOAuthAccountForToken } from "@/lib/cmo/lens-oauth-accounts";
import {
  getWorkspaceGa4MetricSourceMapping,
  upsertWorkspaceGa4MetricSourceMapping,
} from "@/lib/cmo/workspace-metric-sources";
import { requireWorkspaceRegistryEntry } from "@/lib/cmo/workspace-registry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Ga4MetricSourceBody {
  oauthAccountId?: unknown;
  propertyId?: unknown;
  propertyDisplayName?: unknown;
  accountId?: unknown;
  accountDisplayName?: unknown;
  timezone?: unknown;
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function requiredString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

async function assertOAuthAccountTenant(input: {
  oauthAccountId: string;
  tenantId: string;
}): Promise<Response | null> {
  const account = await getGoogleLensOAuthAccountForToken({ oauthAccountId: input.oauthAccountId });

  if (!account) {
    return Response.json(
      {
        error: "OAuth account not found",
        code: "oauth_account_not_found",
      },
      { status: 404 },
    );
  }

  if (account.tenant_id !== input.tenantId) {
    return Response.json(
      {
        error: "OAuth account belongs to a different tenant",
        code: "oauth_account_wrong_tenant",
      },
      { status: 403 },
    );
  }

  return null;
}

function routeErrorResponse(error: unknown): Response {
  const message = error instanceof Error ? error.message : "Workspace GA4 metric source request failed";

  if (message.includes("Unknown workspace app scope")) {
    return Response.json(
      {
        error: "Unknown appId",
        code: "unknown_app_id",
      },
      { status: 404 },
    );
  }

  return Response.json(
    {
      error: message.includes("Authentication required") ? "Authentication required." : "Workspace GA4 metric source request failed",
      code: message.includes("Authentication required") ? "authentication_required" : "workspace_ga4_metric_source_failed",
    },
    { status: message.includes("Authentication required") ? 401 : 500 },
  );
}

export async function GET(_request: Request, context: RouteContext<"/api/cmo/apps/[appId]/metric-sources/ga4">) {
  try {
    await requireRequestUserIfAuthRequired();

    const { appId } = await context.params;
    const entry = requireWorkspaceRegistryEntry(appId);
    const mapping = await getWorkspaceGa4MetricSourceMapping({
      tenantId: entry.tenantId,
      workspaceId: entry.workspaceId,
    });

    return Response.json({ data: mapping });
  } catch (error) {
    return routeErrorResponse(error);
  }
}

export async function POST(request: Request, context: RouteContext<"/api/cmo/apps/[appId]/metric-sources/ga4">) {
  try {
    await requireRequestUserIfAuthRequired();

    const { appId } = await context.params;
    const entry = requireWorkspaceRegistryEntry(appId);
    const body = (await request.json().catch(() => ({}))) as Ga4MetricSourceBody;
    const oauthAccountId = requiredString(body.oauthAccountId);
    const propertyId = requiredString(body.propertyId);

    if (!oauthAccountId || !propertyId) {
      return Response.json(
        {
          error: "oauthAccountId and propertyId are required",
          code: "ga4_metric_source_required_fields_missing",
        },
        { status: 400 },
      );
    }

    const tenantError = await assertOAuthAccountTenant({
      oauthAccountId,
      tenantId: entry.tenantId,
    });

    if (tenantError) {
      return tenantError;
    }

    const mapping = await upsertWorkspaceGa4MetricSourceMapping({
      tenantId: entry.tenantId,
      workspaceId: entry.workspaceId,
      appId: entry.appId,
      oauthAccountId,
      propertyId,
      propertyDisplayName: optionalString(body.propertyDisplayName),
      accountId: optionalString(body.accountId),
      accountDisplayName: optionalString(body.accountDisplayName),
      timezone: optionalString(body.timezone),
    });

    return Response.json({ data: mapping });
  } catch (error) {
    return routeErrorResponse(error);
  }
}
