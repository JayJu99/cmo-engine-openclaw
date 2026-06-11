import { uploadCmoAttachment } from "@/lib/cmo/attachments";
import { getAppWorkspace } from "@/lib/cmo/app-workspaces";
import { getServerUserIdentity } from "@/lib/cmo/auth";
import { cmoErrorResponse } from "@/lib/cmo/errors";
import { requireWorkspaceRegistryEntry } from "@/lib/cmo/workspace-registry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, context: { params: Promise<{ appId: string }> }) {
  try {
    const { appId } = await context.params;
    const app = getAppWorkspace(appId);

    if (!app) {
      return Response.json(
        {
          error: `Unknown appId: ${appId}`,
          code: "cmo_attachment_unknown_app",
        },
        { status: 404 },
      );
    }

    const identity = await getServerUserIdentity();
    const registryEntry = requireWorkspaceRegistryEntry(app.id);
    const form = await request.formData();
    const file = form.get("file");

    if (!(file instanceof File)) {
      return Response.json(
        {
          error: "file is required",
          code: "cmo_attachment_file_required",
        },
        { status: 400 },
      );
    }

    const requestedWorkspaceId = typeof form.get("workspaceId") === "string" ? String(form.get("workspaceId")) : "";
    const sessionId = typeof form.get("sessionId") === "string" ? String(form.get("sessionId")).trim() : "";
    const userCaption = typeof form.get("userCaption") === "string" ? String(form.get("userCaption")).trim() : "";
    const legacyHoldstationMiniAppScope =
      app.id === "holdstation-mini-app" && requestedWorkspaceId === registryEntry.tenantId;
    const workspaceId = legacyHoldstationMiniAppScope
      ? registryEntry.workspaceId
      : requestedWorkspaceId || registryEntry.workspaceId;

    if (workspaceId !== registryEntry.workspaceId) {
      return Response.json(
        {
          error: `Unsupported workspaceId: ${workspaceId}`,
          code: "cmo_attachment_unsupported_workspace",
        },
        { status: 400 },
      );
    }

    const attachment = await uploadCmoAttachment({
      file,
      tenantId: registryEntry.tenantId,
      workspaceId,
      appId: app.id,
      ...(sessionId ? { sessionId } : {}),
      ...(identity.userId ? { userId: identity.userId } : {}),
      ...(identity.userEmail ? { userEmail: identity.userEmail } : {}),
      ...(userCaption ? { userCaption } : {}),
    });

    return Response.json({ data: attachment }, { status: 201 });
  } catch (error) {
    return cmoErrorResponse(error);
  }
}
