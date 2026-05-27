import { getServerUserIdentity } from "@/lib/cmo/auth";
import { applyServerUserIdentity } from "@/lib/cmo/user-metadata";
import { buildCapturePreviewEvent } from "@/lib/cmo/vault-capture-preview";
import type { CMOVaultCapturePreviewInput } from "@/lib/cmo/vault-capture-preview";
import { buildCapturePreview } from "@/lib/cmo/vault-capture-renderer";
import { saveCaptureToCmoEngineVault } from "@/lib/cmo/vault-capture-writer";

interface SaveInput extends CMOVaultCapturePreviewInput {
  confirmed?: boolean;
}

export async function POST(request: Request) {
  try {
    const input = (await request.json()) as SaveInput;
    if (!input.confirmed) {
      return Response.json({ ok: false, savedToVault: false, warnings: [], error: "confirmed: true is required before writing to CMO Engine Vault" }, { status: 400 });
    }
    if (!input.eventType) {
      return Response.json({ ok: false, savedToVault: false, warnings: [], error: "eventType is required" }, { status: 400 });
    }

    const serverInput = applyServerUserIdentity(input, await getServerUserIdentity());
    const event = buildCapturePreviewEvent(serverInput);
    const preview = buildCapturePreview(event);
    if (!preview.ok) {
      return Response.json({ ok: false, savedToVault: false, warnings: preview.warnings, error: preview.error }, { status: 400 });
    }

    const saved = await saveCaptureToCmoEngineVault(event);
    return Response.json({ ...saved, warnings: preview.warnings });
  } catch (error) {
    return Response.json({ ok: false, savedToVault: false, warnings: [], error: error instanceof Error ? error.message : "Failed to save capture" }, { status: 400 });
  }
}
