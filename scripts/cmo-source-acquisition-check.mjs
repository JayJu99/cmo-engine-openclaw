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
    join(temp, "source-acquisition", "source-reader.ts"),
    readFileSync("src/lib/cmo/source-acquisition/source-reader.ts", "utf8")
      .replace(/@\/lib\/cmo\/app-workspace-types/g, "../app-workspace-types")
      .replace(/@\/lib\/cmo\/source-acquisition/g, "./index"),
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
    join(temp, "source-acquisition", "source-reader.ts"),
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
    buildSourceAnswerContext,
    buildSourceQualityReport,
    querySessionLocalSource,
  } = requireFromScript(join(dist, "source-acquisition", "source-reader.js"));
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
  assert.ok(["good", "partial", "low"].includes(textContext.extraction.main_content_quality));
  assert.ok(["static_html", "rendered_dom", "deep_crawl", "partial"].includes(textContext.extraction.extraction_coverage));

  const readableSessionSource = {
    type: "session_local_source",
    schema_version: "cmo.session_local_source.v1",
    workspace_id: "feeback",
    session_id: "session_feeback_reader",
    turn_id: "msg_source_reader",
    source_id: "source_reader_fixture",
    source_type: "url",
    source_title: "Feeback",
    original_url: "https://feeback.org/",
    canonical_url: "https://feeback.org/",
    extracted_summary: "Feeback source summary.",
    source_text_excerpt: "Feeback supports campaign analytics for CEX launch teams.",
    source_text_cache: [
      "Feeback applies to CEX launch teams, trading venues, and market operators that need campaign feedback loops.",
      "The source explains activation workflows, partner onboarding, reporting rituals, campaign analysis, audience signals, conversion tracking, retention reviews, and launch team operating cadence.",
      "It focuses on source-specific evidence for marketing teams that compare channels, prioritize campaigns, coordinate exchange partners, and evaluate market operator feedback before scaling distribution.",
    ].join(" ").repeat(4),
    extraction_status: "completed",
    main_content_quality: "good",
    extraction_coverage: "rendered_dom",
    content_hash: "sha256:reader_fixture",
    saved_to_vault: false,
    official_project_source: false,
    truth_status: "session_only",
    review_status: "temporary",
    no_auto_promote: true,
    safety: {
      read_only: true,
      vault_mutation: false,
      gbrain_mutation: false,
      promotion_performed: false,
    },
  };
  const answerableContext = querySessionLocalSource(readableSessionSource, "Which venues does Feeback apply to?");
  assert.equal(answerableContext.schema_version, "cmo.source_answer_context.v1");
  assert.equal(answerableContext.workspace_id, "feeback");
  assert.equal(answerableContext.query_type, "specific_question");
  assert.equal(answerableContext.action, "answer_question");
  assert.equal(answerableContext.answerable, true);
  assert.match(answerableContext.relevant_snippets.join("\n"), /trading venues|market operators/i);
  assert.ok(answerableContext.used_source_fields.includes("source_text_cache"));
  assert.equal(answerableContext.saved_to_vault, false);
  assert.equal(answerableContext.no_auto_promote, true);
  assert.equal(answerableContext.cache_role, "high_quality_evidence");
  assert.equal(answerableContext.read_depth, "browser_rendered");
  assert.equal(answerableContext.nav_heavy, false);
  assert.equal(answerableContext.tool_read_recommended, false);

  const missingAnswerContext = querySessionLocalSource(readableSessionSource, "What is the tokenomics vesting schedule?");
  assert.equal(missingAnswerContext.query_type, "specific_question");
  assert.equal(missingAnswerContext.answerable, false);
  assert.equal(missingAnswerContext.reason, "not_found_in_current_extraction");
  assert.equal(missingAnswerContext.relevant_snippets.length, 0);
  assert.match(missingAnswerContext.used_source_fields.join("\n"), /source_text_cache/);

  const summaryContext = querySessionLocalSource(readableSessionSource, "Summary web đó giúp mình nhé");
  assert.equal(summaryContext.query_type, "summarize");
  assert.equal(summaryContext.action, "summarize");
  assert.equal(summaryContext.answerable, true);
  assert.match(summaryContext.relevant_snippets.join("\n"), /Feeback source summary|campaign feedback loops/i);
  assert.ok(summaryContext.used_source_fields.includes("extracted_summary"));

  const summaryWithoutKeywordMatch = querySessionLocalSource(readableSessionSource, "Summarize the website");
  assert.equal(summaryWithoutKeywordMatch.answerable, true);
  assert.match(summaryWithoutKeywordMatch.relevant_snippets.join("\n"), /Feeback source summary|campaign feedback loops/i);

  const translateContext = querySessionLocalSource(readableSessionSource, "Translate source to Vietnamese");
  assert.equal(translateContext.query_type, "translate");
  assert.equal(translateContext.action, "translate");
  assert.equal(translateContext.answerable, true);
  assert.match(translateContext.relevant_snippets.join("\n"), /campaign feedback loops/i);

  const canReadContext = querySessionLocalSource(readableSessionSource, "Can you read this source?");
  assert.equal(canReadContext.query_type, "can_read");
  assert.equal(canReadContext.action, "can_read");
  assert.equal(canReadContext.answerable, true);
  assert.ok(canReadContext.relevant_snippets.length > 0);

  const lowQualitySource = {
    ...readableSessionSource,
    source_id: "source_low_quality_fixture",
    source_text_cache: "Home Menu Login Docs Blog Contact Terms Privacy",
    source_text_excerpt: "Home Menu Login",
    extraction_status: "partial",
    main_content_quality: undefined,
    extraction_coverage: "partial",
  };
  const lowQuality = buildSourceQualityReport(lowQualitySource);
  assert.equal(lowQuality.main_content_quality, "low");
  assert.match(lowQuality.warnings.join("\n"), /nav_heavy/);
  const lowQualitySummaryContext = querySessionLocalSource(lowQualitySource, "Tóm tắt link đó");
  assert.equal(lowQualitySummaryContext.query_type, "summarize");
  assert.equal(lowQualitySummaryContext.answerable, false);
  assert.equal(lowQualitySummaryContext.cache_role, "fallback_only");
  assert.equal(lowQualitySummaryContext.read_depth, "partial");
  assert.equal(lowQualitySummaryContext.nav_heavy, true);
  assert.equal(lowQualitySummaryContext.tool_read_recommended, true);

  const builtAnswerContext = await buildSourceAnswerContext({
    source: readableSessionSource,
    query: "market operators",
    workspaceId: "feeback",
    sessionId: "session_feeback_reader",
    allowRefetch: false,
  });
  assert.equal(builtAnswerContext?.type, "source_answer_context");
  assert.equal(builtAnswerContext?.answerable, true);

  const leakedAnswerContext = await buildSourceAnswerContext({
    source: readableSessionSource,
    query: "market operators",
    workspaceId: "aion",
    sessionId: "session_feeback_reader",
    allowRefetch: false,
  });
  assert.equal(leakedAnswerContext, undefined);
  const acknowledgementAnswerContext = await buildSourceAnswerContext({
    source: readableSessionSource,
    query: "Ok thanks bro",
    workspaceId: "feeback",
    sessionId: "session_feeback_reader",
    allowRefetch: false,
  });
  assert.equal(acknowledgementAnswerContext, undefined);

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

  const sessionLocalContext = JSON.parse(JSON.stringify(textContext));
  sessionLocalContext.mode = "session_local";
  sessionLocalContext.persistence = {
    saved_to_vault: false,
    truth_status: "session_only",
    review_status: "temporary",
    no_auto_promote: true,
  };
  sessionLocalContext.extraction.source_text_excerpt = sessionLocalContext.extraction.source_text;
  delete sessionLocalContext.extraction.source_text;

  for (const followUpMessage of [
    "Ok thanks bro",
    "Mình hiểu rồi",
    "Bạn dịch phần này sang tiếng Việt",
    "Tóm tắt lại bằng tiếng Việt",
    "Link đó là website của project",
  ]) {
    const sessionLocalRuntimeResult = await new FallbackRuntime({
      status: "live_failed_then_fallback",
      mode: "fallback",
      label: "Fixture fallback",
      reason: "Fixture fallback.",
    }).runTurn({
      contextPack: {
        policyVersion: "context-pack-v1",
        workspaceId: "aion",
        appId: "aion",
        sourceId: "aion__aion",
        logicalAppPath: "Apps/AION",
        physicalAppVaultPath: "02 Apps/World Mini App/AION",
        appVaultPath: "Apps/AION",
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
        sourceReviewContext: sessionLocalContext,
      },
      contextPackage: {
        workspaceId: "aion",
        sourceId: "aion__aion",
        mode: "app_context",
        contextPack: null,
        sourceReviewContext: sessionLocalContext,
        app: {
          id: "aion",
          name: "AION",
          vaultPath: "Apps/AION",
          logicalAppPath: "Apps/AION",
          physicalAppVaultPath: "02 Apps/World Mini App/AION",
          appVaultPath: "Apps/AION",
        },
        userMessage: followUpMessage,
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
      message: followUpMessage,
      history: [],
      request: {
        tenantId: "holdstation",
        workspaceId: "aion",
        appId: "aion",
        appName: "AION",
        message: followUpMessage,
        context: { selectedNotes: [], mode: "app_context" },
      },
      contextUsed: [],
      missingContext: [],
    });
    assert.doesNotMatch(sessionLocalRuntimeResult.answer, /Source Review:/);
    assert.doesNotMatch(sessionLocalRuntimeResult.answer, /What I Read/);
    assert.doesNotMatch(sessionLocalRuntimeResult.answer, /This source is available as temporary review-only context/);
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
  assert.match(appChatStoreSource, /buildSourceAnswerContext/);
  assert.match(appChatStoreSource, /withSessionSourceRoutingMetadata/);
  assert.match(appChatStoreSource, /sourceToolReadRecommended/);
  assert.match(appChatStoreSource, /runtimeContext/);
  assert.match(appChatStoreSource, /sessionLocalSources/);
  assert.match(appChatStoreSource, /activeSourceId/);
  assert.match(appChatStoreSource, /sessionLocalSourceFromReviewContext/);
  assert.match(appChatStoreSource, /sourceReviewContextFromSessionLocalSource/);
  assert.match(appChatStoreSource, /const hermesCmoChatRequested = !request\.forceFallback && shouldUseHermesCmoChat\(request\.appId\)/);
  assert.match(appChatStoreSource, /productRenderSource = "hermes_cmo"/);
  assert.match(appChatStoreSource, /productRenderSource = hermesCmoChatRequested \? "fallback_after_hermes_failure"/);
  assert.match(appChatStoreSource, /productFallbackReason = hermesCmoChatRequested/);
  assert.match(appChatStoreSource, /fallbackContextPackage/);
  assert.match(appChatStoreSource, /hasSourceReviewContext/);
  assert.match(appChatStoreSource, /!hasSourceReviewContext[\s\S]*executeCmoSurfEvidence/);
  assert.match(appChatStoreSource, /status === "completed" \? await runVaultAgentDryRunHandoff/);
  assert.match(appChatStoreSource, /await writeJsonFile\(sessionPath\(sessionId\), session\)/);
  assert.doesNotMatch(appChatStoreSource, /skipped_vault_mutation_for_source_review_only/);
  assert.doesNotMatch(appChatStoreSource, /run.*GBrain.*source/i);
  assert.doesNotMatch(appChatStoreSource, /buildVaultIngestionPackage|callHermesVaultAgentIngestSource|ingest-source/i);
  assert.doesNotMatch(appChatStoreSource, /13 Sources/);
  assert.doesNotMatch(appChatStoreSource, /Source Review:|What I Read|CMO Read/);

  const hermesMapperSource = readFileSync("src/lib/cmo/hermes-cmo-chat-mapper.ts", "utf8");
  assert.match(hermesMapperSource, /source_review_context/);
  assert.match(hermesMapperSource, /source_answer_context/);
  assert.match(hermesMapperSource, /session_local_source/);
  assert.match(hermesMapperSource, /tool_read_recommended/);
  assert.match(hermesMapperSource, /cache_role/);
  assert.match(hermesMapperSource, /read_depth/);
  assert.match(hermesMapperSource, /nav_heavy/);
  assert.match(hermesMapperSource, /active_source_id/);
  assert.match(hermesMapperSource, /runtime_context/);
  assert.match(hermesMapperSource, /product_gateway_boundary/);
  assert.match(hermesMapperSource, /read_web_allowed/);
  assert.match(hermesMapperSource, /allowed_toolsets/);
  assert.match(hermesMapperSource, /disabled_toolsets: \["messaging", "cronjob", "kanban"\]/);
  assert.match(hermesMapperSource, /durable_writes_require_confirmation/);
  assert.match(hermesMapperSource, /no_auto_save_13_sources/);
  assert.match(hermesMapperSource, /official_ingestion_role: "inputs_priorities_sources_ui"/);
  assert.match(hermesMapperSource, /productRenderSource: "hermes_cmo"/);

  const runtimeSource = readFileSync("src/lib/cmo/runtime.ts", "utf8");
  assert.match(runtimeSource, /reviewContext\.mode !== "review_only"/);
  assert.match(runtimeSource, /I did not save anything to Vault/);

  console.log("CMO source acquisition checks passed");
} finally {
  rmSync(temp, { recursive: true, force: true });
}
