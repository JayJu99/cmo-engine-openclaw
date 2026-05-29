import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";

const temp = mkdtempSync(join(tmpdir(), "cmo-vault-agent-context-pack-"));
const dist = join(temp, "dist");
const requireFromScript = createRequire(import.meta.url);
const tscBin = join("node_modules", "typescript", "bin", "tsc");

function baseRequest(overrides = {}) {
  return {
    workspaceId: "holdstation",
    appId: "holdstation-mini-app",
    appName: "Holdstation",
    message: "What is the M3.12 source ingestion status?",
    context: {
      mode: "app_context",
      selectedNotes: [],
    },
    ...overrides,
  };
}

function baseContextPackage() {
  return {
    workspaceId: "holdstation",
    sourceId: "holdstation-mini-app",
    mode: "app_context",
    contextPack: {
      policyVersion: "context-pack-v1",
      workspaceId: "holdstation",
      appId: "holdstation-mini-app",
      sourceId: "holdstation-mini-app",
      logicalAppPath: "01 Apps/holdstation-mini-app",
      physicalAppVaultPath: "01 Apps/holdstation-mini-app",
      appVaultPath: "01 Apps/holdstation-mini-app",
      physicalVaultPath: "knowledge/holdstation",
      runtimeMode: "live",
      tokenBudget: {
        maxInputTokens: 12000,
        estimatedTokens: 100,
        maxItemChars: 6000,
      },
      items: [],
      exclusions: [],
      contextQualitySummary: {
        selectedCount: 0,
        existingCount: 0,
        missingCount: 0,
        confirmedCount: 0,
        draftCount: 0,
        placeholderCount: 0,
        placeholderOrDraftCount: 0,
      },
    },
    app: {
      id: "holdstation-mini-app",
      name: "Holdstation",
      vaultPath: "01 Apps/holdstation-mini-app",
      logicalAppPath: "01 Apps/holdstation-mini-app",
      physicalAppVaultPath: "01 Apps/holdstation-mini-app",
      appVaultPath: "01 Apps/holdstation-mini-app",
    },
    userMessage: "What is the M3.12 source ingestion status?",
    selectedContext: [],
    missingContext: [],
    contextQualitySummary: {
      selectedCount: 0,
      existingCount: 0,
      missingCount: 0,
      confirmedCount: 0,
      draftCount: 0,
      placeholderCount: 0,
      placeholderOrDraftCount: 0,
    },
    instructions: {
      role: "strategic CMO",
      doNotOverpromise: true,
      answerStyle: "operator-grade, concise, decision-oriented",
      mustStateAssumptions: true,
      mustReferenceContextUsed: true,
      useSelectedNotesOnly: true,
      doNotClaimAllVaultRag: true,
      doNotPretendDurableMemoryComplete: true,
      mustStatePlaceholderLimitations: true,
      askForConfirmationWhenContextIsDraft: true,
      suggestFillingAppMemoryWhenRelevant: true,
    },
  };
}

function contextPackReceipt(overrides = {}) {
  return {
    schema_version: "hermes.vault_agent.context_pack.v1",
    status: "completed",
    source_count: 1,
    gbrain_called: true,
    gbrain_mode: "pilot_keyword_no_embedding",
    vault_mutation: false,
    promotion_performed: false,
    sources: [
      {
        source_id: "srcnote_m312",
        title: "M3.12 Source Ingestion",
        citation: "13 Sources/Source Notes/holdstation-mini-app/2026/05/srcnote_m312 - M3.12.md#summary",
        source_path: "13 Sources/Source Notes/holdstation-mini-app/2026/05/srcnote_m312 - M3.12.md",
        summary: "M3.12 added source ingestion through Hermes Vault Agent with GBrain off and no promotion.",
        excerpt: "Source ingestion endpoint writes under 13 Sources and does not promote accepted knowledge.",
      },
    ],
    warnings: [],
    errors: [],
    ...overrides,
  };
}

try {
  for (const file of [
    "app-workspace-types.ts",
    "config.ts",
    "user-metadata.ts",
    "vault-agent-contracts.ts",
    "vault-agent-remote-client.ts",
    "vault-agent-context-pack-handoff.ts",
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
    join(temp, "vault-agent-remote-client.ts"),
    join(temp, "vault-agent-context-pack-handoff.ts"),
  ], { stdio: "inherit" });

  const {
    buildVaultAgentContextPackRequest,
    contextPackQueryFromUserMessage,
    runVaultAgentContextPackHandoff,
    applyVaultAgentContextPackToCmoContextPackage,
  } = requireFromScript(join(dist, "vault-agent-context-pack-handoff.js"));

  const originalFetch = globalThis.fetch;

  try {
    process.env.CMO_HERMES_BASE_URL = "https://hermes.example.test";
    process.env.CMO_HERMES_API_KEY = "test-key";
    process.env.CMO_HERMES_TIMEOUT_MS = "1000";

    let fetchCalls = 0;
    process.env.CMO_VAULT_CONTEXT_PACK_MODE = "off";
    globalThis.fetch = async () => {
      fetchCalls += 1;
      throw new Error("off mode should not call Hermes");
    };

    const off = await runVaultAgentContextPackHandoff({
      request: baseRequest(),
      sessionId: "session_context_pack_123",
      userIdentity: {
        authMode: "supabase",
        userId: "user_123",
        userEmail: "operator@example.test",
      },
      createdAt: "2026-05-30T00:00:00.000Z",
    });
    assert.equal(off.mode, "off");
    assert.equal(off.status, "skipped");
    assert.equal(fetchCalls, 0);

    process.env.CMO_VAULT_CONTEXT_PACK_MODE = "pilot_remote";
    globalThis.fetch = async (url, init) => {
      fetchCalls += 1;
      assert.equal(url, "https://hermes.example.test/agents/vault-agent/get-context-pack");
      assert.equal(init?.method, "POST");
      assert.equal(init?.headers?.Authorization, "Bearer test-key");
      const body = JSON.parse(init?.body);
      assert.equal(body.schema_version, "cmo.context_pack.request.v1");
      assert.equal(body.tenant_id, "holdstation");
      assert.equal(body.workspace_id, "holdstation-mini-app");
      assert.equal(body.user_id, "user_123");
      assert.equal(body.session_id, "session_context_pack_123");
      assert.equal(body.query, "M3.12");
      assert.deepEqual(body.allowed_scopes, ["workspace"]);
      assert.equal(body.max_results, 3);

      return new Response(JSON.stringify(contextPackReceipt()), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };

    const request = buildVaultAgentContextPackRequest({
      request: baseRequest(),
      sessionId: "session_context_pack_123",
      userIdentity: {
        authMode: "supabase",
        userId: "user_123",
        userEmail: "operator@example.test",
      },
      createdAt: "2026-05-30T00:00:00.000Z",
    });
    assert.equal(request.schema_version, "cmo.context_pack.request.v1");
    assert.equal(request.query, "M3.12");
    assert.deepEqual(request.allowed_scopes, ["workspace"]);
    assert.equal(
      contextPackQueryFromUserMessage("M3.12 là gì? Tóm tắt source ingestion live test trong Vault context."),
      "M3.12",
    );
    assert.equal(
      contextPackQueryFromUserMessage("Review M3.10B rollout state for this workspace."),
      "M3.10B",
    );
    assert.equal(
      contextPackQueryFromUserMessage("Summarize source ingestion readiness.").startsWith("Summarize source ingestion readiness."),
      true,
    );

    const success = await runVaultAgentContextPackHandoff({
      request: baseRequest(),
      sessionId: "session_context_pack_123",
      userIdentity: {
        authMode: "supabase",
        userId: "user_123",
        userEmail: "operator@example.test",
      },
      createdAt: "2026-05-30T00:00:00.000Z",
    });
    assert.equal(success.mode, "pilot_remote");
    assert.equal(success.status, "completed");
    assert.equal(success.metadata.context_pack_status, "completed");
    assert.equal(success.metadata.context_pack_source_count, 1);
    assert.equal(success.metadata.context_pack_sources[0].title, "M3.12 Source Ingestion");
    assert.match(success.metadata.context_pack_sources[0].citation, /13 Sources\/Source Notes/);
    assert.match(success.metadata.context_pack_sources[0].source_path, /13 Sources\/Source Notes/);
    assert.equal(success.metadata.gbrain_called, true);
    assert.equal(success.metadata.vault_mutation, false);
    assert.equal(success.metadata.promotion_performed, false);
    assert.match(success.hiddenText, /^## Vault Context Pack/);
    assert.match(success.hiddenText, /M3\.12 Source Ingestion/);
    assert(success.hiddenText.length <= 4000);

    const injected = applyVaultAgentContextPackToCmoContextPackage(baseContextPackage(), success);
    assert.equal(injected.contextPack.vaultAgentContextPack.hidden_text, success.hiddenText);
    assert.equal(injected.contextPack.vaultAgentContextPack.sources[0].source_path, success.metadata.context_pack_sources[0].source_path);

    globalThis.fetch = async () => new Response(JSON.stringify(contextPackReceipt({
      status: "empty",
      source_count: 0,
      sources: [],
      warnings: ["No pilot context matched workspace/scope filters; embeddings are disabled, so natural-language semantic queries may return empty."],
    })), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
    const empty = await runVaultAgentContextPackHandoff({
      request: baseRequest(),
      sessionId: "session_context_pack_123",
      createdAt: "2026-05-30T00:00:00.000Z",
    });
    assert.equal(empty.status, "empty");
    assert.equal(empty.metadata.context_pack_status, "empty");
    assert.equal(empty.metadata.context_pack_source_count, 0);
    assert.deepEqual(empty.metadata.context_pack_errors, []);
    assert.match(empty.metadata.context_pack_warnings.join("\n"), /No pilot context matched/);
    assert.equal(empty.hiddenText, undefined);
    assert.equal(applyVaultAgentContextPackToCmoContextPackage(baseContextPackage(), empty).contextPack.vaultAgentContextPack, undefined);

    globalThis.fetch = async () => {
      throw new Error("mock context pack network failure");
    };
    const failed = await runVaultAgentContextPackHandoff({
      request: baseRequest(),
      sessionId: "session_context_pack_123",
      createdAt: "2026-05-30T00:00:00.000Z",
    });
    assert.equal(failed.status, "failed");
    assert.match(failed.metadata.context_pack_errors.join("\n"), /mock context pack network failure/);
    assert.equal(failed.metadata.vault_mutation, false);
    assert.equal(failed.metadata.promotion_performed, false);
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.CMO_HERMES_BASE_URL;
    delete process.env.CMO_HERMES_API_KEY;
    delete process.env.CMO_HERMES_TIMEOUT_MS;
    delete process.env.CMO_VAULT_CONTEXT_PACK_MODE;
  }

  const appChatStoreSource = readFileSync("src/lib/cmo/app-chat-store.ts", "utf8");
  assert.match(appChatStoreSource, /runVaultAgentContextPackHandoff/);
  assert.match(appChatStoreSource, /applyVaultAgentContextPackToCmoContextPackage/);
  assert.match(appChatStoreSource, /vaultAgentContextPackMetadata/);

  const mapperSource = readFileSync("src/lib/cmo/hermes-cmo-chat-mapper.ts", "utf8");
  assert.match(mapperSource, /vaultAgentContextPackArtifact/);
  assert.match(mapperSource, /type: "vault_context_pack"/);
  assert.match(mapperSource, /artifacts_in: vaultContextPack \? \[vaultContextPack\] : \[\]/);

  const responseTypes = readFileSync("src/lib/cmo/app-workspace-types.ts", "utf8");
  const responseBlock = responseTypes.match(/export interface CMOAppChatResponse \{[\s\S]*?\n\}/)?.[0] ?? "";
  assert.doesNotMatch(responseBlock, /context_pack_|vaultAgentContextPack|Vault Context Pack/);

  const bannedVaultWrites = /\b(writeFile|appendFile|saveCaptureToCmoEngineVault|autoCaptureTurnOnce)\b/;
  const bannedGBrainCommands = /\b(importGBrain|syncGBrain|embedGBrain|dreamGBrain|extractGBrain)\b/;
  const bannedCmoOrchestrationChanges = /\bexecuteHermesCmoDelegations|executeHermesSurf|executeHermesEcho\b/;
  for (const file of [
    "src/lib/cmo/vault-agent-context-pack-handoff.ts",
    "src/lib/cmo/vault-agent-remote-client.ts",
    "src/lib/cmo/hermes-cmo-chat-mapper.ts",
  ]) {
    const source = readFileSync(file, "utf8");
    assert.doesNotMatch(source, bannedVaultWrites);
    assert.doesNotMatch(source, bannedGBrainCommands);
    assert.doesNotMatch(source, bannedCmoOrchestrationChanges);
  }

  console.log("CMO Vault Agent context pack checks passed");
} finally {
  rmSync(temp, { recursive: true, force: true });
}
