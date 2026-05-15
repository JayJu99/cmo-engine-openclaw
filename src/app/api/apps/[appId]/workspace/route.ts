import { readAppWorkspaceState } from "@/lib/cmo/vault-files";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: RouteContext<"/api/apps/[appId]/workspace">) {
  const { appId } = await context.params;
  const state = await readAppWorkspaceState(appId);

  if (!state) {
    return Response.json(
      {
        error: `Unknown appId: ${appId}`,
        code: "app_workspace_not_found",
      },
      { status: 404 },
    );
  }

  return Response.json({ data: state });
}
