import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";

const temp = mkdtempSync(join(tmpdir(), "cmo-source-acquisition-"));
const dist = join(temp, "dist");
const requireFromScript = createRequire(import.meta.url);
const tscBin = join("node_modules", "typescript", "bin", "tsc");

try {
  mkdirSync(join(temp, "source-acquisition"), { recursive: true });

  for (const file of [
    "app-workspace-types.ts",
    "user-metadata.ts",
    "vault-agent-contracts.ts",
    "vault-agent-source-ingestion.ts",
    "workspace-registry.ts",
  ]) {
    cpSync(`src/lib/cmo/${file}`, join(temp, file));
  }
  writeFileSync(
    join(temp, "context-quality.ts"),
    readFileSync("src/lib/cmo/context-quality.ts", "utf8")
      .replace(/@\/lib\/cmo\/app-workspace-types/g, "./app-workspace-types"),
  );

  writeFileSync(
    join(temp, "source-acquisition", "index.ts"),
    readFileSync("src/lib/cmo/source-acquisition/index.ts", "utf8")
      .replace(/@\/lib\/cmo\/app-workspace-types/g, "../app-workspace-types")
      .replace(/@\/lib\/cmo\/user-metadata/g, "../user-metadata")
      .replace(/@\/lib\/cmo\/vault-agent-source-ingestion/g, "../vault-agent-source-ingestion")
      .replace(/@\/lib\/cmo\/vault-agent-contracts/g, "../vault-agent-contracts"),
  );
  writeFileSync(
    join(temp, "runtime.ts"),
    readFileSync("src/lib/cmo/runtime.ts", "utf8")
      .replace(/@\/lib\/cmo\/app-workspace-types/g, "./app-workspace-types")
      .replace(/@\/lib\/cmo\/context-quality/g, "./context-quality")
      .replace(/@\/lib\/cmo\/config/g, "./config")
      .replace(/@\/lib\/cmo\/errors/g, "./errors")
      .replace(/@\/lib\/cmo\/openclaw-client/g, "./openclaw-client"),
  );
  writeFileSync(join(temp, "config.ts"), `
    export function getCmoFallbackFastAfterMs() { return 1000; }
    export function getCmoLiveAppTurnTimeoutMs() { return 1000; }
  `);
  writeFileSync(join(temp, "errors.ts"), `
    export class CmoAdapterError extends Error {
      status: number;
      code: string;
      constructor(message: string, status = 500, code = "cmo_error") {
        super(message);
        this.status = status;
        this.code = code;
      }
    }
  `);
  writeFileSync(join(temp, "openclaw-client.ts"), `
    export interface OpenClawCmoRuntimeAvailability {
      status: "connected" | "configured_but_unreachable" | "development_fallback" | "runtime_error" | "not_configured";
      label: string;
      reason?: string;
      config?: unknown;
    }
    export async function getOpenClawCmoRuntimeAvailability(): Promise<OpenClawCmoRuntimeAvailability> {
      return { status: "development_fallback", label: "Development fallback" };
    }
    export async function callOpenClawAppTurnRuntime(..._args: unknown[]) {
      return {
        answer: "",
        assumptions: [],
        suggestedActions: [],
        contextUsed: [],
        isDevelopmentFallback: false,
        runtimeLabel: "stub",
        runtimeProvider: "stub",
        runtimeAgent: "cmo",
      };
    }
  `);

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
    "--outDir",
    dist,
    join(temp, "app-workspace-types.ts"),
    join(temp, "context-quality.ts"),
    join(temp, "config.ts"),
    join(temp, "errors.ts"),
    join(temp, "openclaw-client.ts"),
    join(temp, "user-metadata.ts"),
    join(temp, "vault-agent-contracts.ts"),
    join(temp, "workspace-registry.ts"),
    join(temp, "vault-agent-source-ingestion.ts"),
    join(temp, "source-acquisition", "index.ts"),
    join(temp, "runtime.ts"),
  ], { stdio: "inherit" });

  const {
    buildRuntimeContext,
    buildSourceReviewContext,
    buildVaultIngestionPackage,
    detectInputType,
    extractCsv,
    extractPdf,
    fetchPublicUrl,
  } = requireFromScript(join(dist, "source-acquisition", "index.js"));
  const {
    FallbackRuntime,
  } = requireFromScript(join(dist, "runtime.js"));

  const detectedUrl = detectInputType("Review this: https://example.com/post");
  assert.equal(detectedUrl.input_type, "public_url");
  assert.equal(detectedUrl.source_type, "url");
  assert.equal(detectedUrl.url, "https://example.com/post");

  const blockedLocalhost = await fetchPublicUrl("http://127.0.0.1:3000/internal", "2026-05-31T00:00:00.000Z");
  assert.equal(blockedLocalhost.status, "blocked");
  assert.equal(blockedLocalhost.permission_status, "blocked");
  assert.match(blockedLocalhost.errors.join("\n"), /private|localhost|metadata/i);

  const blockedGoogleDoc = await fetchPublicUrl("https://docs.google.com/document/d/private-doc/edit", "2026-05-31T00:00:00.000Z");
  assert.equal(blockedGoogleDoc.status, "blocked");
  assert.equal(blockedGoogleDoc.permission_status, "permission_denied");
  assert.match(blockedGoogleDoc.errors.join("\n"), /Google Docs\/Sheets/);

  const blockedReviewContext = await buildSourceReviewContext({
    tenantId: "holdstation",
    workspaceId: "hold-pay",
    userId: "user_123",
    sessionId: "session_hold_pay_private_source",
    requestId: "msg_private_source",
    url: "https://docs.google.com/document/d/private-doc/edit",
    text: "Check this private doc https://docs.google.com/document/d/private-doc/edit",
    nowIso: "2026-05-31T00:00:00.000Z",
  });
  assert.equal(blockedReviewContext.workspace_id, "hold-pay");
  assert.equal(blockedReviewContext.extraction.status, "blocked");
  assert.match(blockedReviewContext.extraction.errors.join("\n"), /Google Docs\/Sheets/);

  const textContext = await buildSourceReviewContext({
    tenantId: "holdstation",
    workspaceId: "aion",
    userId: "user_123",
    sessionId: "session_aion_source_123",
    requestId: "msg_source_123",
    text: "AION source note: prioritize retention before paid acquisition.",
    sourceTitle: "AION pasted source",
    nowIso: "2026-05-31T00:00:00.000Z",
  });
  assert.equal(textContext.schema_version, "cmo.source_review_context.v1");
  assert.equal(textContext.mode, "review_only");
  assert.equal(textContext.workspace_id, "aion");
  assert.equal(textContext.safety.read_only, true);
  assert.equal(textContext.safety.vault_mutation, false);
  assert.equal(textContext.safety.gbrain_mutation, false);
  assert.equal(textContext.safety.no_promotion, true);
  assert.equal(textContext.extraction.status, "completed");
  assert.match(textContext.extraction.source_text, /prioritize retention/);

  for (const workspace of [
    ["holdstation-mini-app", "Holdstation Mini App"],
    ["aion", "AION"],
    ["feeback", "Feeback"],
    ["hold-pay", "Hold Pay"],
  ]) {
    const [workspaceId, appName] = workspace;
    const context = await buildSourceReviewContext({
      tenantId: "holdstation",
      workspaceId,
      userId: "user_123",
      sessionId: `session_${workspaceId}_source_123`,
      requestId: `msg_${workspaceId}_source_123`,
      text: `${appName} source note: review this temporary source artifact.`,
      sourceTitle: `${appName} pasted source`,
      nowIso: "2026-05-31T00:00:00.000Z",
    });
    assert.equal(context.workspace_id, workspaceId);
    assert.equal(context.mode, "review_only");
    assert.equal(context.safety.vault_mutation, false);

    const runtimeResult = await new FallbackRuntime({
      status: "live_failed_then_fallback",
      mode: "fallback",
      label: "Fixture fallback",
      reason: "Fixture fallback.",
    }).runTurn({
      contextPack: {
        policyVersion: "context-pack-v1",
        workspaceId,
        appId: workspaceId,
        sourceId: `${workspaceId}__${workspaceId}`,
        logicalAppPath: `Apps/${appName}`,
        physicalAppVaultPath: `02 Apps/World Mini App/${appName}`,
        appVaultPath: `Apps/${appName}`,
        physicalVaultPath: "knowledge/holdstation",
        runtimeMode: "fallback",
        tokenBudget: { maxInputTokens: 12000, estimatedTokens: 0, maxItemChars: 6000 },
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
        sourceReviewContext: context,
      },
      contextPackage: {
        workspaceId,
        sourceId: `${workspaceId}__${workspaceId}`,
        mode: "app_context",
        contextPack: null,
        sourceReviewContext: context,
        app: {
          id: workspaceId,
          name: appName,
          vaultPath: `Apps/${appName}`,
          logicalAppPath: `Apps/${appName}`,
          physicalAppVaultPath: `02 Apps/World Mini App/${appName}`,
          appVaultPath: `Apps/${appName}`,
        },
        userMessage: "Check qua link docs này nhé bạn: https://example.com/docs",
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
      },
      vaultAgentContextPackStatus: "empty",
      message: "Check qua link docs này nhé bạn: https://example.com/docs",
      history: [],
      request: {
        tenantId: "holdstation",
        workspaceId,
        appId: workspaceId,
        appName,
        message: "Check qua link docs này nhé bạn: https://example.com/docs",
        context: { selectedNotes: [], mode: "app_context" },
      },
      contextUsed: [],
      missingContext: [],
    });
    assert.match(runtimeResult.answer, /Source Review:/);
    assert.ok(runtimeResult.answer.includes(`Workspace: ${appName} (${workspaceId})`));
    assert.match(runtimeResult.answer, /No Vault save, GBrain indexing, or knowledge promotion was performed/);
    assert.doesNotMatch(runtimeResult.answer, /When Source UI is available/);
  }

  const emptyContextRuntimeResult = await new FallbackRuntime({
    status: "live_failed_then_fallback",
    mode: "fallback",
    label: "Fixture fallback",
    reason: "Fixture fallback.",
  }).runTurn({
    contextPack: {
      policyVersion: "context-pack-v1",
      workspaceId: "hold-pay",
      appId: "hold-pay",
      sourceId: "hold-pay__hold-pay",
      logicalAppPath: "Apps/Hold Pay",
      physicalAppVaultPath: "02 Apps/World Mini App/Hold Pay",
      appVaultPath: "Apps/Hold Pay",
      physicalVaultPath: "knowledge/holdstation",
      runtimeMode: "fallback",
      tokenBudget: { maxInputTokens: 12000, estimatedTokens: 0, maxItemChars: 6000 },
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
    contextPackage: {
      workspaceId: "hold-pay",
      sourceId: "hold-pay__hold-pay",
      mode: "app_context",
      contextPack: null,
      app: {
        id: "hold-pay",
        name: "Hold Pay",
        vaultPath: "Apps/Hold Pay",
        logicalAppPath: "Apps/Hold Pay",
        physicalAppVaultPath: "02 Apps/World Mini App/Hold Pay",
        appVaultPath: "Apps/Hold Pay",
      },
      userMessage: "workspace này đang có context gì?",
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
    },
    vaultAgentContextPackStatus: "empty",
    message: "workspace này đang có context gì?",
    history: [],
    request: {
      tenantId: "holdstation",
      workspaceId: "hold-pay",
      appId: "hold-pay",
      appName: "Hold Pay",
      message: "workspace này đang có context gì?",
      context: { selectedNotes: [], mode: "app_context" },
    },
    contextUsed: [],
    missingContext: [],
  });
  assert.match(emptyContextRuntimeResult.answer, /no accepted knowledge\/source context/i);

  const blockedRuntimeResult = await new FallbackRuntime({
    status: "live_failed_then_fallback",
    mode: "fallback",
    label: "Fixture fallback",
    reason: "Fixture fallback.",
  }).runTurn({
    contextPack: {
      policyVersion: "context-pack-v1",
      workspaceId: "hold-pay",
      appId: "hold-pay",
      sourceId: "hold-pay__hold-pay",
      logicalAppPath: "Apps/Hold Pay",
      physicalAppVaultPath: "02 Apps/World Mini App/Hold Pay",
      appVaultPath: "Apps/Hold Pay",
      physicalVaultPath: "knowledge/holdstation",
      runtimeMode: "fallback",
      tokenBudget: { maxInputTokens: 12000, estimatedTokens: 0, maxItemChars: 6000 },
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
      sourceReviewContext: blockedReviewContext,
    },
    contextPackage: {
      workspaceId: "hold-pay",
      sourceId: "hold-pay__hold-pay",
      mode: "app_context",
      contextPack: null,
      sourceReviewContext: blockedReviewContext,
      app: {
        id: "hold-pay",
        name: "Hold Pay",
        vaultPath: "Apps/Hold Pay",
        logicalAppPath: "Apps/Hold Pay",
        physicalAppVaultPath: "02 Apps/World Mini App/Hold Pay",
        appVaultPath: "Apps/Hold Pay",
      },
      userMessage: "Check this private doc https://docs.google.com/document/d/private-doc/edit",
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
    },
    vaultAgentContextPackStatus: "empty",
    message: "Check this private doc https://docs.google.com/document/d/private-doc/edit",
    history: [],
    request: {
      tenantId: "holdstation",
      workspaceId: "hold-pay",
      appId: "hold-pay",
      appName: "Hold Pay",
      message: "Check this private doc https://docs.google.com/document/d/private-doc/edit",
      context: { selectedNotes: [], mode: "app_context" },
    },
    contextUsed: [],
    missingContext: [],
  });
  assert.match(blockedRuntimeResult.answer, /could not extract reviewable text/i);
  assert.match(blockedRuntimeResult.answer, /publish\/export|paste the relevant excerpt/i);
  assert.doesNotMatch(blockedRuntimeResult.answer, /Source Review:/);

  const csv = extractCsv("name,value\nactivation,10\nretention,20\n");
  assert.equal(csv.status, "completed");
  assert.match(csv.table_summary, /2 columns/);
  assert.match(csv.table_summary, /name, value/);

  const pdf = extractPdf(new Uint8Array([37, 80, 68, 70]));
  assert.equal(pdf.status, "unsupported");
  assert.match(pdf.extracted_summary, /PDF text extraction is not wired/);

  const vaultPackage = buildVaultIngestionPackage(textContext, {
    appId: "aion",
    scope: "session",
    visibility: "workspace",
  });
  assert.equal(vaultPackage.schema_version, "cmo.source_ingestion.v1");
  assert.equal(vaultPackage.workspace_id, "aion");
  assert.equal(vaultPackage.session_id, "session_aion_source_123");
  assert.equal(vaultPackage.no_auto_promote, true);
  assert.equal(vaultPackage.scope, "session");
  assert.equal(vaultPackage.visibility, "workspace");
  assert.equal(vaultPackage.retrieved_at, "2026-05-31T00:00:00.000Z");
  assert.equal(vaultPackage.timezone, "Asia/Ho_Chi_Minh");
  assert.equal(vaultPackage.extraction.status, "completed");
  assert.match(vaultPackage.source_refs.join("\n"), /source_review:/);

  const runtimeContext = buildRuntimeContext({
    nowIso: "2026-05-31T01:02:03.000Z",
    userIdentity: {
      authMode: "supabase",
      userId: "user_123",
      userEmail: "jay@example.test",
    },
  });
  assert.equal(runtimeContext.now_iso, "2026-05-31T01:02:03.000Z");
  assert.equal(runtimeContext.timezone, "Asia/Ho_Chi_Minh");
  assert.equal(runtimeContext.timezone_label, "Vietnam time");
  assert.equal(runtimeContext.locale, "vi-VN");
  assert.equal(runtimeContext.user_display_name, "jay@example.test");

  const appChatStoreSource = readFileSync("src/lib/cmo/app-chat-store.ts", "utf8");
  assert.match(appChatStoreSource, /buildSourceReviewContextFromMessage/);
  assert.match(appChatStoreSource, /runtimeContext/);
  assert.match(appChatStoreSource, /hasSourceReviewContext/);
  assert.match(appChatStoreSource, /!hasSourceReviewContext[\s\S]*executeCmoSurfEvidence/);
  assert.match(appChatStoreSource, /status === "completed" \? await runVaultAgentDryRunHandoff/);
  assert.doesNotMatch(appChatStoreSource, /skipped_vault_mutation_for_source_review_only/);
  assert.doesNotMatch(appChatStoreSource, /run.*GBrain.*source/i);

  const hermesMapperSource = readFileSync("src/lib/cmo/hermes-cmo-chat-mapper.ts", "utf8");
  assert.match(hermesMapperSource, /source_review_context/);
  assert.match(hermesMapperSource, /runtime_context/);

  console.log("CMO source acquisition checks passed");
} finally {
  rmSync(temp, { recursive: true, force: true });
}
