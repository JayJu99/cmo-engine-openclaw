import { getServerUserIdentity } from "@/lib/cmo/auth";
import { applyServerUserIdentity } from "@/lib/cmo/user-metadata";
import { buildManualCapturePreview } from "@/lib/cmo/vault-capture-preview";
import type { CMOVaultCapturePreviewInput } from "@/lib/cmo/vault-capture-preview";

export async function POST(request: Request) {
  try {
    const input = (await request.json()) as CMOVaultCapturePreviewInput;
    if (!input.eventType) {
      return Response.json({ ok: false, mode: "dry_run", savedToVault: false, warnings: [], error: "eventType is required" }, { status: 400 });
    }
    const serverInput = applyServerUserIdentity(input, await getServerUserIdentity());
    return Response.json(buildManualCapturePreview(serverInput));
  } catch (error) {
    return Response.json({ ok: false, mode: "dry_run", savedToVault: false, warnings: [], error: error instanceof Error ? error.message : "Failed to build capture preview" }, { status: 400 });
  }
}
