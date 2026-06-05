import { validateProjectContextImportConfirmRequest } from "@/lib/cmo/project-context-import";
import { importProjectContextViaVaultAgent } from "@/lib/cmo/vault-agent-project-context-client";
import { requireWorkspaceRegistryEntry } from "@/lib/cmo/workspace-registry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function responseStatusFor(result: Awaited<ReturnType<typeof importProjectContextViaVaultAgent>>): number {
  if (result.ok) {
    return 200;
  }

  const status = result.receipt?.status;

  if (result.receipt?.conflict || status === "conflict") {
    return 409;
  }

  if (status === "rejected") {
    return 400;
  }

  return result.httpStatus && result.httpStatus >= 400 ? result.httpStatus : 502;
}

export async function POST(request: Request, context: RouteContext<"/api/apps/[appId]/project-context/import/confirm">) {
  const { appId } = await context.params;
  let registryEntry;

  try {
    registryEntry = requireWorkspaceRegistryEntry(appId);
  } catch {
    return Response.json(
      {
        ok: false,
        status: "failed",
        error: `Unknown appId: ${appId}`,
        code: "project_context_import_unknown_app",
      },
      { status: 404 },
    );
  }

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return Response.json(
      {
        ok: false,
        status: "failed",
        error: "Invalid JSON body.",
        code: "project_context_import_invalid_json",
      },
      { status: 400 },
    );
  }

  const validation = validateProjectContextImportConfirmRequest(body, {
    appId: registryEntry.appId,
    workspaceId: registryEntry.workspaceId,
    tenantId: registryEntry.tenantId,
  });

  if (!validation.ok || !validation.request) {
    return Response.json(
      {
        ok: false,
        status: "rejected",
        error: "Project context import confirmation is invalid.",
        code: "project_context_import_confirm_invalid",
        errors: validation.errors,
      },
      { status: 400 },
    );
  }

  const result = await importProjectContextViaVaultAgent(validation.request);

  return Response.json(
    {
      ok: result.ok,
      status: result.receipt?.status ?? "failed",
      receipt: result.receipt,
      warnings: result.warnings,
      errors: result.error ? [result.error] : result.receipt?.errors ?? [],
      vault_write_performed: result.receipt?.vault_write_performed === true,
      gbrain_called: false,
      promotion_performed: false,
      supabase_mutation: false,
      runtime_write: false,
    },
    { status: responseStatusFor(result) },
  );
}
