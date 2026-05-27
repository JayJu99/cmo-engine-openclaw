import { buildManualCapturePreview } from "@/lib/cmo/vault-capture-preview";
import type { CMOVaultCapturePreviewInput } from "@/lib/cmo/vault-capture-preview";

export async function POST(request: Request) {
  try {
    const input = (await request.json()) as CMOVaultCapturePreviewInput;
    if (!input.eventType) {
      return Response.json({ ok: false, mode: "dry_run", savedToVault: false, warnings: [], error: "eventType is required" }, { status: 400 });
    }
    return Response.json(buildManualCapturePreview(input));
  } catch (error) {
    return Response.json({ ok: false, mode: "dry_run", savedToVault: false, warnings: [], error: error instanceof Error ? error.message : "Failed to build capture preview" }, { status: 400 });
  }
}
