import { buildMockVaultGraphResponse } from "@/lib/cmo/vault-graph-contract";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json(buildMockVaultGraphResponse(), {
    headers: {
      "Cache-Control": "no-store",
    },
  });
}
