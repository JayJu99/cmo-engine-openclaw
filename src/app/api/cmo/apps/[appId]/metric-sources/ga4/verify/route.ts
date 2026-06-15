import { requireRequestUserIfAuthRequired } from "@/lib/cmo/auth";
import {
  ga4VerificationMessageForCode,
  ga4VerificationStatusForCode,
  verifyLensGa4PropertyAccess,
  type LensGa4PropertyVerificationResult,
} from "@/lib/cmo/lens-ga4-properties";
import { getLensGoogleAccessToken, LensGoogleAccessTokenError } from "@/lib/cmo/lens-google-oauth";
import {
  getWorkspaceGa4MetricSourceMapping,
  updateWorkspaceGa4MetricSourceVerification,
  type WorkspaceGa4MetricSourceMapping,
  type WorkspaceGa4VerificationStatus,
} from "@/lib/cmo/workspace-metric-sources";
import { requireWorkspaceRegistryEntry } from "@/lib/cmo/workspace-registry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type SafeVerificationResponse = {
  ok: boolean;
  status: WorkspaceGa4VerificationStatus;
  code?: string;
  message?: string;
  property?: LensGa4PropertyVerificationResult["property"];
};

function safeVerificationResponse(result: LensGa4PropertyVerificationResult): SafeVerificationResponse {
  return {
    ok: result.ok,
    status: result.verificationStatus,
    code: result.code,
    message: result.message,
    property: result.property,
  };
}

function responseStatusForVerification(status: WorkspaceGa4VerificationStatus): number {
  void status;
  return 200;
}

function routeErrorResponse(error: unknown): Response {
  const message = error instanceof Error ? error.message : "Workspace GA4 source verification failed";

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
      error: message.includes("Authentication required") ? "Authentication required." : "Workspace GA4 source verification failed",
      code: message.includes("Authentication required") ? "authentication_required" : "workspace_ga4_source_verification_failed",
    },
    { status: message.includes("Authentication required") ? 401 : 500 },
  );
}

async function persistVerification(input: {
  tenantId: string;
  workspaceId: string;
  appId: string;
  result: LensGa4PropertyVerificationResult;
}): Promise<WorkspaceGa4MetricSourceMapping> {
  return updateWorkspaceGa4MetricSourceVerification({
    tenantId: input.tenantId,
    workspaceId: input.workspaceId,
    appId: input.appId,
    verificationStatus: input.result.verificationStatus,
    lastVerifiedAt: new Date().toISOString(),
    lastVerificationError: input.result.ok ? null : input.result.message ?? input.result.code ?? null,
    lastVerificationCode: input.result.ok ? null : input.result.code ?? input.result.verificationStatus,
  });
}

export async function POST(_request: Request, context: RouteContext<"/api/cmo/apps/[appId]/metric-sources/ga4/verify">) {
  try {
    await requireRequestUserIfAuthRequired();

    const { appId } = await context.params;
    const entry = requireWorkspaceRegistryEntry(appId);
    const mapping = await getWorkspaceGa4MetricSourceMapping({
      tenantId: entry.tenantId,
      workspaceId: entry.workspaceId,
      appId: entry.appId,
    });

    if (!mapping?.propertyId) {
      const result: LensGa4PropertyVerificationResult = {
        ok: false,
        verificationStatus: "error",
        code: "missing_mapping",
        message: ga4VerificationMessageForCode("missing_mapping"),
      };

      return Response.json(
        {
          mapping: null,
          verification: safeVerificationResponse(result),
        },
        { status: 404 },
      );
    }

    if (!mapping.oauthAccountId) {
      const result: LensGa4PropertyVerificationResult = {
        ok: false,
        verificationStatus: "needs_reconnect",
        code: "oauth_account_not_found",
        message: ga4VerificationMessageForCode("oauth_account_not_found"),
      };
      const updatedMapping = await persistVerification({
        tenantId: entry.tenantId,
        workspaceId: entry.workspaceId,
        appId: entry.appId,
        result,
      });

      return Response.json(
        {
          mapping: updatedMapping,
          verification: safeVerificationResponse(result),
        },
        { status: responseStatusForVerification(result.verificationStatus) },
      );
    }

    let result: LensGa4PropertyVerificationResult;

    try {
      const token = await getLensGoogleAccessToken({
        oauthAccountId: mapping.oauthAccountId,
        tenantId: entry.tenantId,
      });

      result = await verifyLensGa4PropertyAccess({
        accessToken: token.accessToken,
        propertyId: mapping.propertyId,
      });
    } catch (error) {
      if (error instanceof LensGoogleAccessTokenError) {
        result = {
          ok: false,
          verificationStatus: ga4VerificationStatusForCode(error.code),
          code: error.code,
          message: ga4VerificationMessageForCode(error.code),
        };
      } else {
        result = {
          ok: false,
          verificationStatus: "error",
          code: "ga4_admin_api_unavailable",
          message: ga4VerificationMessageForCode("ga4_admin_api_unavailable"),
        };
      }
    }

    const updatedMapping = await persistVerification({
      tenantId: entry.tenantId,
      workspaceId: entry.workspaceId,
      appId: entry.appId,
      result,
    });

    return Response.json(
      {
        mapping: updatedMapping,
        verification: safeVerificationResponse(result),
      },
      { status: responseStatusForVerification(result.verificationStatus) },
    );
  } catch (error) {
    return routeErrorResponse(error);
  }
}
