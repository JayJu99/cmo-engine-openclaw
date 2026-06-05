import { buildProjectContextImportPreviewReceipt } from "@/lib/cmo/project-context-import-detection";
import { PROJECT_CONTEXT_IMPORT_REQUEST_SCHEMA_VERSION, type ProjectContextImportRequestV1 } from "@/lib/cmo/project-context-import-types";
import { requireWorkspaceRegistryEntry } from "@/lib/cmo/workspace-registry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, context: { params: Promise<{ appId: string }> }) {
  const { appId } = await context.params;

  let body: Partial<ProjectContextImportRequestV1>;
  try {
    body = (await request.json()) as Partial<ProjectContextImportRequestV1>;
  } catch {
    return Response.json(
      {
        error: "Invalid JSON request body",
        code: "invalid_json",
      },
      { status: 400 },
    );
  }

  let registryEntry;
  try {
    registryEntry = requireWorkspaceRegistryEntry(appId);
  } catch {
    return Response.json(
      {
        error: `Unknown appId: ${appId}`,
        code: "app_workspace_not_found",
      },
      { status: 404 },
    );
  }

  const validationError = validatePreviewRequest(body, registryEntry.workspaceId, registryEntry.appId, registryEntry.tenantId);
  if (validationError) {
    return Response.json(validationError, { status: 400 });
  }

  const receipt = buildProjectContextImportPreviewReceipt({
    workspaceId: registryEntry.workspaceId,
    projectName: body.project_name,
    files: body.files ?? [],
  });

  return Response.json(receipt);
}

function validatePreviewRequest(
  body: Partial<ProjectContextImportRequestV1>,
  expectedWorkspaceId: string,
  expectedAppId: string,
  expectedTenantId: string,
): { error: string; code: string } | null {
  if (body.schema_version !== PROJECT_CONTEXT_IMPORT_REQUEST_SCHEMA_VERSION) {
    return {
      error: `Unsupported schema_version: ${body.schema_version ?? "missing"}`,
      code: "unsupported_schema_version",
    };
  }

  if (body.mode !== "preview") {
    return {
      error: "Project context import preview route only accepts mode=preview",
      code: "invalid_import_mode",
    };
  }

  if (body.tenant_id !== expectedTenantId) {
    return {
      error: `tenant_id does not match app registry entry: expected ${expectedTenantId}`,
      code: "tenant_mismatch",
    };
  }

  if (body.workspace_id !== expectedWorkspaceId) {
    return {
      error: `workspace_id does not match app registry entry: expected ${expectedWorkspaceId}`,
      code: "workspace_mismatch",
    };
  }

  if (body.app_id !== expectedAppId) {
    return {
      error: `app_id does not match app registry entry: expected ${expectedAppId}`,
      code: "app_mismatch",
    };
  }

  if (body.confirmation?.accepted_project_context !== false || body.confirmation.confirmed_by_user !== false) {
    return {
      error: "Preview must not request accepted context write confirmation",
      code: "preview_confirmation_must_be_false",
    };
  }

  if (!Array.isArray(body.files)) {
    return {
      error: "files must be an array",
      code: "invalid_files",
    };
  }

  return null;
}
