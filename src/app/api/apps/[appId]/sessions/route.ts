import { readAppChatSessions } from "@/lib/cmo/app-chat-store";
import { getAppWorkspace } from "@/lib/cmo/app-workspaces";
import { readAppSessionSummaries } from "@/lib/cmo/vault-files";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function limitFromRequest(request: Request): number {
  const url = new URL(request.url);
  const limit = Number.parseInt(url.searchParams.get("limit") ?? "50", 10);

  return Number.isFinite(limit) ? Math.max(1, Math.min(100, limit)) : 50;
}

export async function GET(request: Request, context: RouteContext<"/api/apps/[appId]/sessions">) {
  const { appId } = await context.params;
  const limit = limitFromRequest(request);
  const app = getAppWorkspace(appId);

  if (!app) {
    return Response.json(
      {
        error: `Unknown appId: ${appId}`,
        code: "app_sessions_unknown_app",
      },
      { status: 404 },
    );
  }

  return Response.json({
    data: await readAppChatSessions(limit, app.id),
    summaries: await readAppSessionSummaries(app.id, limit),
  });
}
