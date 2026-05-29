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
    "vault-agent-handoff-builder.ts",
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
    join(temp, "vault-agent-handoff-builder.ts"),
  ], { stdio: "inherit" });

  const {
    buildTurnCompletedPackage,
    runVaultAgentDryRunHandoff,
  } = requireFromScript(join(dist, "vault-agent-handoff-builder.js"));
  const {
    buildVaultAgentDryRunReceipt,
  } = requireFromScript(join(dist, "vault-agent-dry-run.js"));

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
  const validHandoff = runVaultAgentDryRunHandoff(baseHandoffInput());
  assert.equal(validHandoff.mode, "dry_run");
  assert.equal(validHandoff.status, "dry_run_valid");
  assert.equal(validHandoff.receipt.write_confirmed, false);
  assert.equal(validHandoff.receipt.no_filesystem_write, true);
  assert.equal(validHandoff.receipt.no_gbrain_call, true);
  assert.equal(validHandoff.metadata.vault_handoff_status, "dry_run_valid");
  assert.match(validHandoff.metadata.dry_run_record_id, /^rec_/);
  assert.match(validHandoff.metadata.dry_run_target_path, /^09 Proposals\/Vault Agent Dry Run\//);
  assert.equal(validHandoff.metadata.dry_run_indexability.gbrain_index, false);

  process.env.CMO_VAULT_AGENT_HANDOFF_MODE = "off";
  const offHandoff = runVaultAgentDryRunHandoff(baseHandoffInput());
  assert.equal(offHandoff.mode, "off");
  assert.equal(offHandoff.status, "skipped");
  assert.equal(offHandoff.package, undefined);
  assert.equal(offHandoff.receipt, undefined);

  process.env.CMO_VAULT_AGENT_HANDOFF_MODE = "dry_run";
  const missingWorkspace = runVaultAgentDryRunHandoff(baseHandoffInput({
    request: baseRequest({ appId: "" }),
  }));
  assert.equal(missingWorkspace.status, "dry_run_invalid");
  assert.match(missingWorkspace.metadata.vault_handoff_errors.join("\n"), /workspace_id/);

  const missingSession = runVaultAgentDryRunHandoff(baseHandoffInput({
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

  const responseTypes = readFileSync("src/lib/cmo/app-workspace-types.ts", "utf8");
  const responseBlock = responseTypes.match(/export interface CMOAppChatResponse \{[\s\S]*?\n\}/)?.[0] ?? "";
  assert.doesNotMatch(responseBlock, /vaultAgentDryRun|vault_handoff|dry_run_record_id/);

  const bannedRuntimeCalls = /\b(writeFile|appendFile|mkdir|rm|createWriteStream|fetch|axios|saveCaptureToCmoEngineVault|importGBrain|syncGBrain|embedGBrain|dreamGBrain|extractGBrain)\b/;
  for (const file of [
    "src/lib/cmo/vault-agent-handoff-builder.ts",
    "src/lib/cmo/vault-agent-dry-run.ts",
  ]) {
    assert.doesNotMatch(readFileSync(file, "utf8"), bannedRuntimeCalls);
  }

  console.log("CMO Vault Agent handoff dry-run checks passed");
} finally {
  delete process.env.CMO_VAULT_AGENT_HANDOFF_MODE;
  rmSync(temp, { recursive: true, force: true });
}
