import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";

const temp = mkdtempSync(join(tmpdir(), "cmo-vault-agent-write-remote-"));
const dist = join(temp, "dist");
const requireFromScript = createRequire(import.meta.url);
const tscBin = join("node_modules", "typescript", "bin", "tsc");

function baseRequest(overrides = {}) {
  return {
    workspaceId: "holdstation",
    appId: "holdstation-mini-app",
    appName: "Holdstation",
    message: "What should we do next for activation?",
    context: {
      mode: "app_context",
      selectedNotes: [],
    },
    ...overrides,
  };
}

function baseSession(overrides = {}) {
  return {
    id: "session_write_123",
    appId: "holdstation-mini-app",
    appName: "Holdstation",
    messages: [],
    contextUsed: [],
    status: "completed",
    createdAt: "2026-05-30T00:00:00.000Z",
    updatedAt: "2026-05-30T00:00:00.000Z",
    ...overrides,
  };
}

function baseHandoffInput(overrides = {}) {
  return {
    request: baseRequest(),
    session: baseSession(),
    userIdentity: {
      authMode: "supabase",
      userId: "user_123",
      userEmail: "operator@example.test",
    },
    userMessageId: "msg_user_123",
    assistantMessageId: "msg_assistant_123",
    answer: "Focus the next sprint on activation proof, then review retention signals.",
    createdAt: "2026-05-30T00:00:00.000Z",
    ...overrides,
  };
}

function writeReceipt(overrides = {}) {
  return {
    schema_version: "hermes.vault_agent.write_receipt.v1",
    status: "completed",
    write_performed: true,
    deduped: false,
    record_id: "turnlog_write_123",
    target_relative_path: "03 Sessions/holdstation-mini-app/user_123/session_write_123/Turn Logs/turnlog_write_123 - cmo-turn.md",
    target_absolute_path: "/Users/jay/Documents/CMO Engine Vault/03 Sessions/holdstation-mini-app/user_123/session_write_123/Turn Logs/turnlog_write_123 - cmo-turn.md",
    content_hash: "sha256:test-write-hash",
    path_safety: {
      safe: true,
      normalized: true,
    },
    warnings: [],
    errors: [],
    gbrain_called: false,
    memory_mutation: false,
    ...overrides,
  };
}

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
    runVaultAgentDryRunHandoff,
  } = requireFromScript(join(dist, "vault-agent-handoff-builder.js"));
  const {
    vaultAgentDryRunMetadataForPersistence,
  } = requireFromScript(join(dist, "vault-agent-handoff-persistence.js"));

  const originalFetch = globalThis.fetch;

  try {
    process.env.CMO_VAULT_AGENT_HANDOFF_MODE = "write_remote";
    process.env.CMO_HERMES_BASE_URL = "https://hermes.example.test";
    process.env.CMO_HERMES_API_KEY = "test-key";
    process.env.CMO_HERMES_TIMEOUT_MS = "1000";

    globalThis.fetch = async (url, init) => {
      assert.equal(url, "https://hermes.example.test/agents/vault-agent/write-turn-log");
      assert.equal(init?.method, "POST");
      assert.equal(init?.headers?.Authorization, "Bearer test-key");
      const body = JSON.parse(init?.body);
      assert.equal(body.schema_version, "cmo.turn_package.v1");
      assert.equal(body.no_auto_promote, true);
      assert.equal(body.final_cmo_answer, "Focus the next sprint on activation proof, then review retention signals.");

      return new Response(JSON.stringify(writeReceipt()), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };

    const success = await runVaultAgentDryRunHandoff(baseHandoffInput());
    const successPersisted = vaultAgentDryRunMetadataForPersistence(success);
    assert.equal(success.mode, "write_remote");
    assert.equal(success.status, "completed");
    assert.equal(successPersisted.vault_handoff_mode, "write_remote");
    assert.equal(successPersisted.vault_handoff_status, "completed");
    assert.equal(successPersisted.vault_write_performed, true);
    assert.equal(successPersisted.vault_deduped, false);
    assert.equal(successPersisted.vault_record_id, "turnlog_write_123");
    assert.equal(successPersisted.vault_target_path, "03 Sessions/holdstation-mini-app/user_123/session_write_123/Turn Logs/turnlog_write_123 - cmo-turn.md");
    assert.match(successPersisted.vault_target_absolute_path, /CMO Engine Vault\/03 Sessions\/holdstation-mini-app\/user_123\/session_write_123\/Turn Logs\/turnlog_write_123 - cmo-turn\.md$/);
    assert.equal(successPersisted.vault_content_hash, "sha256:test-write-hash");
    assert.deepEqual(successPersisted.vault_path_safety, { safe: true, normalized: true });
    assert.deepEqual(successPersisted.vault_errors, []);
    assert.equal(successPersisted.gbrain_called, false);
    assert.equal(successPersisted.memory_mutation, false);

    globalThis.fetch = async () => new Response(JSON.stringify(writeReceipt({
      write_performed: false,
      deduped: true,
      record_id: "turnlog_write_deduped",
      target_relative_path: "03 Sessions/holdstation-mini-app/user_123/session_write_123/Turn Logs/turnlog_write_deduped - cmo-turn.md",
      target_absolute_path: "/Users/jay/Documents/CMO Engine Vault/03 Sessions/holdstation-mini-app/user_123/session_write_123/Turn Logs/turnlog_write_deduped - cmo-turn.md",
      content_hash: "sha256:test-deduped-hash",
      warnings: ["deduped existing turn log"],
    })), {
      status: 200,
      headers: { "content-type": "application/json" },
    });

    const deduped = await runVaultAgentDryRunHandoff(baseHandoffInput());
    const dedupedPersisted = vaultAgentDryRunMetadataForPersistence(deduped);
    assert.equal(deduped.status, "completed");
    assert.equal(dedupedPersisted.vault_handoff_status, "completed");
    assert.equal(dedupedPersisted.vault_write_performed, false);
    assert.equal(dedupedPersisted.vault_deduped, true);
    assert.equal(dedupedPersisted.vault_record_id, "turnlog_write_deduped");
    assert.equal(dedupedPersisted.vault_target_path, "03 Sessions/holdstation-mini-app/user_123/session_write_123/Turn Logs/turnlog_write_deduped - cmo-turn.md");
    assert.match(dedupedPersisted.vault_warnings.join("\n"), /deduped existing turn log/);

    globalThis.fetch = async () => new Response(JSON.stringify(writeReceipt({
      status: "rejected",
      write_performed: false,
      deduped: false,
      record_id: "turnlog_write_rejected",
      target_relative_path: "03 Sessions/holdstation-mini-app/user_123/session_write_123/Turn Logs/turnlog_write_rejected - cmo-turn.md",
      target_absolute_path: "/Users/jay/Documents/CMO Engine Vault/03 Sessions/holdstation-mini-app/user_123/session_write_123/Turn Logs/turnlog_write_rejected - cmo-turn.md",
      errors: ["remote policy rejected write"],
    })), {
      status: 200,
      headers: { "content-type": "application/json" },
    });

    const rejected = await runVaultAgentDryRunHandoff(baseHandoffInput());
    const rejectedPersisted = vaultAgentDryRunMetadataForPersistence(rejected);
    assert.equal(rejected.status, "rejected");
    assert.equal(rejectedPersisted.vault_handoff_status, "rejected");
    assert.match(rejectedPersisted.vault_errors.join("\n"), /remote policy rejected write/);
    assert.match(rejectedPersisted.vault_handoff_errors.join("\n"), /remote policy rejected write/);

    globalThis.fetch = async () => {
      throw new Error("mock write network failure");
    };

    const failed = await runVaultAgentDryRunHandoff(baseHandoffInput());
    const failedPersisted = vaultAgentDryRunMetadataForPersistence(failed);
    assert.equal(failed.status, "failed");
    assert.equal(failedPersisted.vault_handoff_status, "failed");
    assert.match(failedPersisted.vault_errors.join("\n"), /mock write network failure/);
    assert.equal(failedPersisted.gbrain_called, false);
    assert.equal(failedPersisted.memory_mutation, false);

    process.env.CMO_VAULT_AGENT_HANDOFF_MODE = "dry_run_remote";
    globalThis.fetch = async (url) => {
      assert.equal(url, "https://hermes.example.test/agents/vault-agent/dry-run");
      return new Response(JSON.stringify({
        schema_version: "hermes.vault_agent.response.v1",
        mode: "vault.write_turn_log.dry_run",
        status: "completed",
        record_id: "rec_remote_completed",
        target_path_preview: "09 Proposals/Vault Agent Dry Run/holdstation-mini-app/2026/05/rec-remote.md",
        write_performed: false,
        gbrain_called: false,
        memory_mutation: false,
        safety: {
          vault_write: false,
          gbrain_called: false,
          memory_mutation: false,
        },
        validation_errors: [],
        validation_warnings: [],
      }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };

    const dryRunRemote = await runVaultAgentDryRunHandoff(baseHandoffInput());
    assert.equal(dryRunRemote.mode, "dry_run_remote");
    assert.equal(dryRunRemote.status, "completed");
    assert.equal(dryRunRemote.metadata.dry_run_record_id, "rec_remote_completed");
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.CMO_HERMES_BASE_URL;
    delete process.env.CMO_HERMES_API_KEY;
    delete process.env.CMO_HERMES_TIMEOUT_MS;
  }

  const handoffBuilderSource = readFileSync("src/lib/cmo/vault-agent-handoff-builder.ts", "utf8");
  assert.doesNotMatch(handoffBuilderSource, /saveCaptureToCmoEngineVault|vault-auto-capture|legacy_local/);

  const appChatStoreSource = readFileSync("src/lib/cmo/app-chat-store.ts", "utf8");
  assert.match(appChatStoreSource, /vaultAgentDryRunMetadataForPersistence\(vaultAgentHandoff\)/);

  const responseTypes = readFileSync("src/lib/cmo/app-workspace-types.ts", "utf8");
  const responseBlock = responseTypes.match(/export interface CMOAppChatResponse \{[\s\S]*?\n\}/)?.[0] ?? "";
  assert.doesNotMatch(responseBlock, /vault_record_id|vault_target_path|vault_write_performed|vault_handoff/);

  const bannedGBrainCalls = /\b(importGBrain|syncGBrain|embedGBrain|dreamGBrain|extractGBrain)\b/;
  for (const file of [
    "src/lib/cmo/vault-agent-handoff-builder.ts",
    "src/lib/cmo/vault-agent-remote-client.ts",
  ]) {
    const source = readFileSync(file, "utf8");
    assert.doesNotMatch(source, bannedGBrainCalls);
  }

  console.log("CMO Vault Agent write_remote checks passed");
} finally {
  delete process.env.CMO_VAULT_AGENT_HANDOFF_MODE;
  rmSync(temp, { recursive: true, force: true });
}
