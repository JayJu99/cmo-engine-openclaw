import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";

const temp = mkdtempSync(join(tmpdir(), "cmo-vault-agent-handoff-"));
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
    id: "session_123",
    appId: "holdstation-mini-app",
    appName: "Holdstation",
    messages: [],
    contextUsed: [],
    status: "completed",
    createdAt: "2026-05-29T00:00:00.000Z",
    updatedAt: "2026-05-29T00:00:00.000Z",
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
    createdAt: "2026-05-29T00:00:00.000Z",
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
    buildTurnCompletedPackage,
    runVaultAgentDryRunHandoff,
  } = requireFromScript(join(dist, "vault-agent-handoff-builder.js"));
  const {
    buildVaultAgentDryRunReceipt,
  } = requireFromScript(join(dist, "vault-agent-dry-run.js"));
  const {
    vaultAgentDryRunMetadataForPersistence,
  } = requireFromScript(join(dist, "vault-agent-handoff-persistence.js"));

  const cmoOnlyPackage = buildTurnCompletedPackage(baseHandoffInput());
  assert.equal(cmoOnlyPackage.tenant_id, "holdstation");
  assert.equal(cmoOnlyPackage.workspace_id, "holdstation-mini-app");
  assert.equal(cmoOnlyPackage.user_id, "user_123");
  assert.equal(cmoOnlyPackage.session_id, "session_123");
  assert.equal(cmoOnlyPackage.turn_id, "msg_user_123");
  assert.equal(cmoOnlyPackage.message_id, "msg_assistant_123");
  assert.equal(cmoOnlyPackage.user_message, "What should we do next for activation?");
  assert.match(cmoOnlyPackage.final_cmo_answer, /activation proof/);
  assert.deepEqual(cmoOnlyPackage.agents_used, ["cmo"]);
  assert.equal(cmoOnlyPackage.surf_calls, 0);
  assert.equal(cmoOnlyPackage.echo_calls, 0);
  assert.equal(cmoOnlyPackage.no_auto_promote, true);
  assert.equal(cmoOnlyPackage.canonical_language, "en");

  const surfEchoPackage = buildTurnCompletedPackage(baseHandoffInput({
    activityEvents: [
      {
        eventId: "event_1",
        type: "delegation",
        status: "completed",
        message: "Surf checked market evidence.",
        userVisible: true,
        sourceAgent: "surf",
      },
    ],
    delegationSummary: [
      {
        delegationId: "delegation_1",
        targetAgent: "surf",
        mode: "surf.default",
        objective: "Find evidence",
        status: "completed",
        summary: "Surf found supporting market signals.",
      },
    ],
    agentsUsed: ["cmo", "surf", "echo"],
    surfCalls: 1,
    echoCalls: 1,
  }));
  assert.deepEqual(surfEchoPackage.agents_used, ["cmo", "surf", "echo"]);
  assert.equal(surfEchoPackage.surf_calls, 1);
  assert.equal(surfEchoPackage.echo_calls, 1);
  assert.equal(surfEchoPackage.delegation_summary?.[0]?.targetAgent, "surf");

  process.env.CMO_VAULT_AGENT_HANDOFF_MODE = "dry_run";
  const validHandoff = await runVaultAgentDryRunHandoff(baseHandoffInput());
  assert.equal(validHandoff.mode, "dry_run");
  assert.equal(validHandoff.status, "completed");
  assert.equal(validHandoff.receipt.write_confirmed, false);
  assert.equal(validHandoff.receipt.no_filesystem_write, true);
  assert.equal(validHandoff.receipt.no_gbrain_call, true);
  assert.equal(validHandoff.metadata.vault_handoff_status, "completed");
  assert.match(validHandoff.metadata.dry_run_record_id, /^rec_/);
  assert.match(validHandoff.metadata.dry_run_target_path, /^09 Proposals\/Vault Agent Dry Run\//);
  assert.equal(validHandoff.metadata.dry_run_indexability.gbrain_index, false);

  process.env.CMO_VAULT_AGENT_HANDOFF_MODE = "off";
  const offHandoff = await runVaultAgentDryRunHandoff(baseHandoffInput());
  assert.equal(offHandoff.mode, "off");
  assert.equal(offHandoff.status, "skipped");
  assert.equal(offHandoff.package, undefined);
  assert.equal(offHandoff.receipt, undefined);

  process.env.CMO_VAULT_AGENT_HANDOFF_MODE = "dry_run";
  const missingWorkspace = await runVaultAgentDryRunHandoff(baseHandoffInput({
    request: baseRequest({ appId: "" }),
  }));
  assert.equal(missingWorkspace.status, "dry_run_invalid");
  assert.match(missingWorkspace.metadata.vault_handoff_errors.join("\n"), /workspace_id/);

  const missingSession = await runVaultAgentDryRunHandoff(baseHandoffInput({
    session: baseSession({ id: "" }),
  }));
  assert.equal(missingSession.status, "dry_run_invalid");
  assert.match(missingSession.metadata.vault_handoff_errors.join("\n"), /session_id/);

  const missingUserReceipt = buildVaultAgentDryRunReceipt({
    ...cmoOnlyPackage,
    user_id: undefined,
    user_ref: "",
  });
  assert.equal(missingUserReceipt.status, "rejected");
  assert.match(missingUserReceipt.validation_errors.join("\n"), /user_id or user_ref/);

  const originalFetch = globalThis.fetch;
  const hermesVaultAgentResponse = (status = "completed") => ({
    schema_version: "hermes.vault_agent.response.v1",
    mode: "vault.write_turn_log.dry_run",
    status,
    record_id: `rec_remote_${status}`,
    target_path_preview: "09 Proposals/Vault Agent Dry Run/holdstation-mini-app/2026/05/rec-remote.md",
    write_performed: false,
    gbrain_called: false,
    memory_mutation: false,
    safety: {
      vault_write: false,
      gbrain_called: false,
      memory_mutation: false,
    },
    indexability: {
      gbrain_index: false,
      gbrain_status: "not_indexable",
      reason: "Remote Hermes Vault Agent dry-run kept raw turn log out of GBrain.",
    },
    validation_errors: status === "rejected" ? ["remote policy rejected package"] : [],
    validation_warnings: status === "rejected" ? ["remote rejected dry-run"] : [],
  });

  const legacyRemoteReceipt = (status = "dry_run") => ({
    schema_version: "cmo.vault-agent.v1",
    record_id: `rec_legacy_${status}`,
    status,
    write_confirmed: false,
    target_path_preview: "09 Proposals/Vault Agent Dry Run/holdstation-mini-app/2026/05/rec-remote.md",
    indexability: {
      gbrain_index: false,
      gbrain_status: "not_indexable",
      reason: "Completed dry-run receipt can be intentionally not indexable.",
    },
    validation_errors: status === "rejected" ? ["remote policy rejected package"] : [],
    validation_warnings: status === "rejected" ? ["remote rejected dry-run"] : [],
    no_filesystem_write: true,
    no_gbrain_call: true,
  });

  const completedReceiptWrapper = () => ({
    schema_version: "legacy.wrapper.v1",
    receipt: legacyRemoteReceipt("completed"),
  });

  try {
    process.env.CMO_VAULT_AGENT_HANDOFF_MODE = "dry_run_remote";
    process.env.CMO_HERMES_BASE_URL = "https://hermes.example.test";
    process.env.CMO_HERMES_API_KEY = "test-key";
    process.env.CMO_HERMES_TIMEOUT_MS = "1000";

    globalThis.fetch = async (url, init) => {
      assert.equal(url, "https://hermes.example.test/agents/vault-agent/dry-run");
      assert.equal(init?.method, "POST");
      assert.equal(init?.headers?.Authorization, "Bearer test-key");
      const body = JSON.parse(init?.body);
      assert.equal(body.final_cmo_answer, "Focus the next sprint on activation proof, then review retention signals.");
      assert.equal(body.no_auto_promote, true);

      return new Response(JSON.stringify(hermesVaultAgentResponse()), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };

    const remoteSuccess = await runVaultAgentDryRunHandoff(baseHandoffInput());
    assert.equal(remoteSuccess.mode, "dry_run_remote");
    assert.equal(remoteSuccess.status, "completed");
    assert.equal(remoteSuccess.metadata.vault_handoff_status, "completed");
    assert.equal(remoteSuccess.receipt.write_confirmed, false);
    assert.equal(remoteSuccess.receipt.no_filesystem_write, true);
    assert.equal(remoteSuccess.receipt.no_gbrain_call, true);
    assert.equal(remoteSuccess.metadata.dry_run_record_id, "rec_remote_completed");
    assert.equal(remoteSuccess.metadata.dry_run_indexability.gbrain_index, false);
    assert.equal(remoteSuccess.metadata.dry_run_indexability.gbrain_status, "not_indexable");

    globalThis.fetch = async () => new Response(JSON.stringify(hermesVaultAgentResponse("rejected")), {
      status: 200,
      headers: { "content-type": "application/json" },
    });

    const remoteRejected = await runVaultAgentDryRunHandoff(baseHandoffInput());
    assert.equal(remoteRejected.mode, "dry_run_remote");
    assert.equal(remoteRejected.status, "dry_run_invalid");
    assert.equal(remoteRejected.metadata.vault_handoff_status, "dry_run_invalid");
    assert.match(remoteRejected.metadata.vault_handoff_errors.join("\n"), /remote policy rejected/);

    globalThis.fetch = async () => new Response(JSON.stringify({
      schema_version: "legacy.wrapper.v1",
      receipt: legacyRemoteReceipt(),
    }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });

    const legacyWrapperRemote = await runVaultAgentDryRunHandoff(baseHandoffInput());
    assert.equal(legacyWrapperRemote.mode, "dry_run_remote");
    assert.equal(legacyWrapperRemote.status, "completed");
    assert.equal(legacyWrapperRemote.metadata.dry_run_record_id, "rec_legacy_dry_run");

    globalThis.fetch = async () => new Response(JSON.stringify(completedReceiptWrapper()), {
      status: 200,
      headers: { "content-type": "application/json" },
    });

    const completedStatusWrapperRemote = await runVaultAgentDryRunHandoff(baseHandoffInput());
    assert.equal(completedStatusWrapperRemote.mode, "dry_run_remote");
    assert.equal(completedStatusWrapperRemote.status, "completed");
    assert.equal(completedStatusWrapperRemote.metadata.vault_handoff_status, "completed");
    assert.equal(completedStatusWrapperRemote.metadata.vault_handoff_errors.length, 0);
    assert.equal(completedStatusWrapperRemote.metadata.dry_run_indexability.gbrain_status, "not_indexable");

    const liveShapePersistedMetadata = vaultAgentDryRunMetadataForPersistence({
      mode: "dry_run_remote",
      status: "completed",
      receipt: {
        schema_version: "cmo.vault-agent.v1",
        record_id: "turnlog_04e7af3c63819549",
        status: "validated",
        write_confirmed: false,
        target_path_preview: "03 Sessions/holdstation-mini-app/user/session/Turn Logs/turnlog_04e7af3c63819549 - cmo-turn.md",
        validation_errors: [],
        validation_warnings: [],
        no_filesystem_write: true,
        no_gbrain_call: true,
      },
      metadata: {
        vault_handoff_mode: "dry_run_remote",
        vault_handoff_status: "dry_run_invalid",
        dry_run_record_id: "turnlog_04e7af3c63819549",
        dry_run_target_path: "03 Sessions/holdstation-mini-app/user/session/Turn Logs/turnlog_04e7af3c63819549 - cmo-turn.md",
        dry_run_indexability: {
          gbrain_index: false,
          gbrain_status: "not_indexable",
          reason: "Hermes Vault Agent dry-run indexability decision.",
        },
        vault_handoff_warnings: [],
        vault_handoff_errors: [],
      },
    });
    assert.equal(liveShapePersistedMetadata.vault_handoff_mode, "dry_run_remote");
    assert.equal(liveShapePersistedMetadata.vault_handoff_status, "completed");
    assert.equal(liveShapePersistedMetadata.dry_run_record_id, "turnlog_04e7af3c63819549");
    assert.match(liveShapePersistedMetadata.dry_run_target_path, /Turn Logs\/turnlog_04e7af3c63819549 - cmo-turn\.md$/);
    assert.equal(liveShapePersistedMetadata.dry_run_indexability.gbrain_status, "not_indexable");
    assert.deepEqual(liveShapePersistedMetadata.vault_handoff_errors, []);

    globalThis.fetch = async () => {
      throw new Error("mock network failure");
    };

    const remoteFailure = await runVaultAgentDryRunHandoff(baseHandoffInput());
    assert.equal(remoteFailure.mode, "dry_run_remote");
    assert.equal(remoteFailure.status, "failed");
    assert.equal(remoteFailure.metadata.vault_handoff_status, "failed");
    assert.match(remoteFailure.metadata.vault_handoff_errors.join("\n"), /mock network failure/);
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.CMO_HERMES_BASE_URL;
    delete process.env.CMO_HERMES_API_KEY;
    delete process.env.CMO_HERMES_TIMEOUT_MS;
  }

  const responseTypes = readFileSync("src/lib/cmo/app-workspace-types.ts", "utf8");
  const responseBlock = responseTypes.match(/export interface CMOAppChatResponse \{[\s\S]*?\n\}/)?.[0] ?? "";
  assert.doesNotMatch(responseBlock, /vaultAgentDryRun|vault_handoff|dry_run_record_id/);

  const appChatStoreSource = readFileSync("src/lib/cmo/app-chat-store.ts", "utf8");
  assert.match(appChatStoreSource, /vaultAgentDryRunMetadataForPersistence\(vaultAgentHandoff\)/);
  const handoffBuilderSource = readFileSync("src/lib/cmo/vault-agent-handoff-builder.ts", "utf8");
  assert.doesNotMatch(
    handoffBuilderSource,
    /receipt\.status === "dry_run" \? "dry_run_valid" : "dry_run_invalid"/,
  );

  const bannedFilesystemCalls = /\b(writeFile|appendFile|mkdir|rm|createWriteStream|saveCaptureToCmoEngineVault)\b/;
  const bannedGBrainCalls = /\b(importGBrain|syncGBrain|embedGBrain|dreamGBrain|extractGBrain)\b/;
  for (const file of [
    "src/lib/cmo/vault-agent-handoff-builder.ts",
    "src/lib/cmo/vault-agent-remote-client.ts",
    "src/lib/cmo/vault-agent-dry-run.ts",
  ]) {
    const source = readFileSync(file, "utf8");
    assert.doesNotMatch(source, bannedFilesystemCalls);
    assert.doesNotMatch(source, bannedGBrainCalls);
  }

  console.log("CMO Vault Agent handoff dry-run checks passed");
} finally {
  delete process.env.CMO_VAULT_AGENT_HANDOFF_MODE;
  rmSync(temp, { recursive: true, force: true });
}
