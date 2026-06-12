import { getVaultGraph } from "@/lib/cmo/vault-graph-adapter";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json(await getVaultGraph(), {
    headers: {
      "Cache-Control": "no-store",
    },
  });
}
