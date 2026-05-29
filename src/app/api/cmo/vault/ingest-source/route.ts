import { getServerUserIdentity } from "@/lib/cmo/auth";
import { callHermesVaultAgentIngestSource } from "@/lib/cmo/vault-agent-remote-client";
import { buildSourceIngestionPackage, type CmoSourceIngestionRequest } from "@/lib/cmo/vault-agent-source-ingestion";

function statusCodeFor(status: string | undefined): number {
  return status === "rejected" ? 400 : 200;
}

export async function POST(request: Request) {
  try {
    const input = (await request.json()) as CmoSourceIngestionRequest;
    const pkg = buildSourceIngestionPackage(input, await getServerUserIdentity());
    const result = await callHermesVaultAgentIngestSource(pkg);

    if (!result.ok || !result.receipt) {
      return Response.json({
        ok: false,
        status: "failed",
        source_ingestion_status: "failed",
        record_ids: {},
        source_record_ids: {},
        target_paths: {},
        source_target_paths: {},
        write_performed: false,
        source_write_performed: false,
        warnings: result.warnings,
        source_warnings: result.warnings,
        errors: [result.error ?? "Hermes Vault Agent source ingestion failed."],
        source_errors: [result.error ?? "Hermes Vault Agent source ingestion failed."],
        gbrain_called: false,
        promotion_performed: false,
      }, { status: 502 });
    }

    return Response.json({
      ok: result.receipt.status === "completed",
      status: result.receipt.status,
      source_ingestion_status: result.receipt.status,
      record_ids: result.receipt.record_ids,
      source_record_ids: result.receipt.record_ids,
      target_paths: result.receipt.target_paths,
      source_target_paths: result.receipt.target_paths,
      write_performed: result.receipt.write_performed,
      source_write_performed: result.receipt.write_performed,
      warnings: result.receipt.warnings,
      source_warnings: result.receipt.warnings,
      errors: result.receipt.errors,
      source_errors: result.receipt.errors,
      gbrain_called: false,
      promotion_performed: false,
    }, { status: statusCodeFor(result.receipt.status) });
  } catch (error) {
    return Response.json({
      ok: false,
      status: "failed",
      source_ingestion_status: "failed",
      record_ids: {},
      source_record_ids: {},
      target_paths: {},
      source_target_paths: {},
      write_performed: false,
      source_write_performed: false,
      warnings: [],
      source_warnings: [],
      errors: [error instanceof Error ? error.message : "Failed to ingest source."],
      source_errors: [error instanceof Error ? error.message : "Failed to ingest source."],
      gbrain_called: false,
      promotion_performed: false,
    }, { status: 400 });
  }
}
