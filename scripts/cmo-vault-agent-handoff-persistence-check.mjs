import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";

const temp = mkdtempSync(join(tmpdir(), "cmo-vault-agent-persistence-"));
const dist = join(temp, "dist");
const requireFromScript = createRequire(import.meta.url);
const tscBin = join("node_modules", "typescript", "bin", "tsc");

try {
  for (const file of [
    "app-workspace-types.ts",
    "config.ts",
    "user-metadata.ts",
    "vault-agent-contracts.ts",
    "vault-scope-policy.ts",
    "vault-agent-dry-run.ts",
    "vault-agent-remote-client.ts",
    "vault-agent-handoff-builder.ts",
    "vault-agent-handoff-persistence.ts",
  ]) {
    cpSync(`src/lib/cmo/${file}`, join(temp, file));
  }

  execFileSync(process.execPath, [
    tscBin,
    "--target",
    "ES2022",
    "--module",
    "commonjs",
    "--moduleResolution",
    "node",
    "--esModuleInterop",
    "--skipLibCheck",
    "--strict",
    "--outDir",
    dist,
    join(temp, "app-workspace-types.ts"),
    join(temp, "config.ts"),
    join(temp, "user-metadata.ts"),
    join(temp, "vault-agent-contracts.ts"),
    join(temp, "vault-scope-policy.ts"),
    join(temp, "vault-agent-dry-run.ts"),
    join(temp, "vault-agent-remote-client.ts"),
    join(temp, "vault-agent-handoff-builder.ts"),
    join(temp, "vault-agent-handoff-persistence.ts"),
  ], { stdio: "inherit" });

  const {
    vaultAgentDryRunMetadataForPersistence,
  } = requireFromScript(join(dist, "vault-agent-handoff-persistence.js"));

  const liveMismatch = {
    mode: "dry_run_remote",
    status: "completed",
    receipt: {
      schema_version: "cmo.vault-agent.v1",
      record_id: "turnlog_04e7af3c63819549",
      status: "validated",
      write_confirmed: false,
      target_path_preview: "03 Sessions/holdstation-mini-app/04acf682-0067-4a8c-8a42-3520a30f8ccf/session_20260529090629_f15ef189/Turn Logs/turnlog_04e7af3c63819549 - cmo-turn.md",
      validation_errors: [],
      validation_warnings: [],
      no_filesystem_write: true,
      no_gbrain_call: true,
    },
    metadata: {
      vault_handoff_mode: "dry_run_remote",
      vault_handoff_status: "dry_run_invalid",
      dry_run_record_id: "turnlog_04e7af3c63819549",
      dry_run_target_path: "03 Sessions/holdstation-mini-app/04acf682-0067-4a8c-8a42-3520a30f8ccf/session_20260529090629_f15ef189/Turn Logs/turnlog_04e7af3c63819549 - cmo-turn.md",
      dry_run_indexability: {
        gbrain_index: false,
        gbrain_status: "not_indexable",
        reason: "Hermes Vault Agent dry-run indexability decision.",
      },
      vault_handoff_warnings: [],
      vault_handoff_errors: [],
    },
  };

  const persisted = vaultAgentDryRunMetadataForPersistence(liveMismatch);

  console.log("raw handoff.status:", liveMismatch.status);
  console.log("raw receipt.status:", liveMismatch.receipt.status);
  console.log("raw metadata.vault_handoff_status:", liveMismatch.metadata.vault_handoff_status);
  console.log("final persisted vault_handoff_status:", persisted?.vault_handoff_status);

  assert.equal(persisted?.vault_handoff_mode, "dry_run_remote");
  assert.equal(persisted?.vault_handoff_status, "completed");
  assert.equal(persisted?.dry_run_record_id, "turnlog_04e7af3c63819549");
  assert.equal(persisted?.dry_run_target_path, liveMismatch.metadata.dry_run_target_path);
  assert.equal(persisted?.dry_run_indexability?.gbrain_status, "not_indexable");
  assert.deepEqual(persisted?.vault_handoff_errors, []);

  const failed = vaultAgentDryRunMetadataForPersistence({
    ...liveMismatch,
    status: "failed",
    receipt: undefined,
    metadata: {
      ...liveMismatch.metadata,
      vault_handoff_status: "completed",
      vault_handoff_errors: ["network failure"],
    },
  });
  assert.equal(failed?.vault_handoff_status, "failed");

  const rejected = vaultAgentDryRunMetadataForPersistence({
    ...liveMismatch,
    status: "dry_run_invalid",
    receipt: {
      ...liveMismatch.receipt,
      status: "rejected",
      validation_errors: ["remote policy rejected package"],
    },
    metadata: {
      ...liveMismatch.metadata,
      vault_handoff_status: "completed",
      vault_handoff_errors: ["remote policy rejected package"],
    },
  });
  assert.equal(rejected?.vault_handoff_status, "dry_run_invalid");

  console.log("CMO Vault Agent handoff persistence checks passed");
} finally {
  rmSync(temp, { recursive: true, force: true });
}
