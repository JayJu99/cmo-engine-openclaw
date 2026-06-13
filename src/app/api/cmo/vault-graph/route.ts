import { getVaultGraph } from "@/lib/cmo/vault-graph-adapter";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VAULT_GRAPH_QUERY_PARAMS = [
  "workspace_id",
  "include_runtime_aggregates",
  "include_archive",
  "limit_nodes",
  "limit_edges",
  "operator_mode",
] as const;

export async function GET(request: Request) {
  const searchParams = new URL(request.url).searchParams;
  const options = Object.fromEntries(
    VAULT_GRAPH_QUERY_PARAMS.flatMap((key) => {
      const value = searchParams.get(key)?.trim();
      return value ? [[key, value]] : [];
    }),
  );

  return Response.json(await getVaultGraph(undefined, options), {
    headers: {
      "Cache-Control": "no-store",
    },
  });
}
