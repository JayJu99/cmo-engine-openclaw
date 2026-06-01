import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import ts from "typescript";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cmoDir = path.join(rootDir, "src", "lib", "cmo");
const expectedCounters = {
  surfCalls: 0,
  echoCalls: 0,
  vaultAgentCalls: 0,
  vaultWrites: 0,
  directSupabaseMutations: 0,
  openclawCalls: 0,
};
const forbiddenZeroCounters = {
  vaultAgentCalls: 0,
  vaultWrites: 0,
  directSupabaseMutations: 0,
  openclawCalls: 0,
};

const restoreEnvValue = (name, value) => {
  if (value === undefined) {
    delete process.env[name];
    return;
  }

  process.env[name] = value;
};

const withEnv = async (patch, fn) => {
  const previous = {};

  for (const key of Object.keys(patch)) {
    previous[key] = process.env[key];
    if (patch[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = patch[key];
    }
  }

  try {
    return await fn();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      restoreEnvValue(key, value);
    }
  }
};

const transpile = async (sourcePath, outputPath, rewrite) => {
  const source = await readFile(sourcePath, "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      esModuleInterop: true,
      importsNotUsedAsValues: ts.ImportsNotUsedAsValues.Remove,
    },
    fileName: sourcePath,
  }).outputText;

  await writeFile(outputPath, rewrite ? rewrite(output) : output, "utf8");
};

const loadCompiledModules = async () => {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "hermes-cmo-chat-wiring-"));
  const configOut = path.join(tmpDir, "config.js");
  const routerOut = path.join(tmpDir, "hermes-cmo-chat-router.js");
  const mapperOut = path.join(tmpDir, "hermes-cmo-chat-mapper.js");

  await transpile(path.join(cmoDir, "config.ts"), configOut);
  await transpile(path.join(cmoDir, "hermes-cmo-chat-router.ts"), routerOut, (output) =>
    output.replace('require("@/lib/cmo/config")', 'require("./config.js")'),
  );
  await transpile(path.join(cmoDir, "hermes-cmo-chat-mapper.ts"), mapperOut);

  const requireFromTmp = createRequire(routerOut);

  return {
    tmpDir,
    router: requireFromTmp(routerOut),
    mapper: requireFromTmp(mapperOut),
  };
};

const sampleTurnInput = {
  contextPack: {
    policyVersion: "context-pack-v1",
    workspaceId: "holdstation-mini-app",
    appId: "holdstation-mini-app",
    sourceId: "holdstation-mini-app__holdstation-mini-app",
    logicalAppPath: "02 Apps/World Mini App/Holdstation Mini App",
    physicalAppVaultPath: "knowledge/holdstation/02 Apps/World Mini App/Holdstation Mini App",
    appVaultPath: "02 Apps/World Mini App/Holdstation Mini App",
    physicalVaultPath: "knowledge/holdstation",
    runtimeMode: "live",
    tokenBudget: {
      maxInputTokens: 8000,
      estimatedTokens: 120,
      maxItemChars: 4000,
    },
    items: [
      {
        id: "priority",
        kind: "current_priority",
        title: "Current Priority",
        source: {
          sourceId: "holdstation:holdstation-mini-app",
          type: "vault_note",
          label: "Current Priority",
          path: "priority.md",
        },
        inclusionReason: "Priority context",
        exists: true,
        content: "Focus on activation loop clarity.",
        contentPreview: "Focus on activation loop clarity.",
        contextQuality: "confirmed",
        tokenEstimate: 8,
        truncated: false,
      },
      {
        id: "indexed",
        kind: "indexed_context_supplement",
        title: "Indexed Context Supplement",
        source: {
          sourceId: "holdstation:holdstation-mini-app",
          type: "indexed_context_preview",
          label: "Indexed",
          path: "supabase-index://cmo-engine/context-preview",
        },
        inclusionReason: "Canary supplement",
        exists: true,
        content: "Prior session said activation proof matters.",
        contentPreview: "Prior session said activation proof matters.",
        contextQuality: "draft",
        tokenEstimate: 10,
        truncated: false,
      },
    ],
    exclusions: [],
    contextQualitySummary: {
      selectedCount: 2,
      existingCount: 2,
      missingCount: 0,
      confirmedCount: 1,
      draftCount: 1,
      placeholderCount: 0,
      placeholderOrDraftCount: 1,
    },
  },
  contextPackage: {
    workspaceId: "holdstation-mini-app",
    sourceId: "holdstation-mini-app__holdstation-mini-app",
    mode: "app_context",
    contextPack: null,
    app: {
      id: "holdstation-mini-app",
      name: "Holdstation Mini App",
      vaultPath: "knowledge/holdstation/02 Apps/World Mini App/Holdstation Mini App",
      logicalAppPath: "02 Apps/World Mini App/Holdstation Mini App",
      physicalAppVaultPath: "knowledge/holdstation/02 Apps/World Mini App/Holdstation Mini App",
      appVaultPath: "02 Apps/World Mini App/Holdstation Mini App",
    },
    userMessage: "Review activation plan.",
    selectedContext: [
      {
        title: "Current Priority",
        path: "priority.md",
        type: "app-note",
        exists: true,
        content: "Focus on activation loop clarity.",
        truncated: false,
        contextQuality: "confirmed",
        qualityReason: "fixture",
      },
    ],
    missingContext: [],
    contextQualitySummary: {
      selectedCount: 2,
      existingCount: 2,
      missingCount: 0,
      confirmedCount: 1,
      draftCount: 1,
      placeholderCount: 0,
      placeholderOrDraftCount: 1,
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
  message: "Review activation plan.",
  history: [
    {
      id: "msg_prev",
      role: "assistant",
      content: [
        "Previous Echo output:",
        "",
        "POST 1: Build the first activation proof before you scale the campaign.",
        "",
        "POST 2: Show the Mini App action that creates value in one step.",
        "",
        "POST 3: Keep claims tight until the activation evidence is visible.",
      ].join("\n"),
      createdAt: "2026-05-28T08:00:00.000Z",
    },
  ],
  request: {
    workspaceId: "holdstation-mini-app",
    appId: "holdstation-mini-app",
    appName: "Holdstation Mini App",
    message: "Review activation plan.",
    context: {
      selectedNotes: [],
      mode: "app_context",
    },
  },
  contextUsed: [
    {
      id: "priority",
      title: "Current Priority",
      path: "priority.md",
      type: "app-note",
      exists: true,
    },
  ],
  missingContext: [],
};
sampleTurnInput.contextPackage.contextPack = sampleTurnInput.contextPack;
sampleTurnInput.contextPackage.runtimeContext = {
  now_iso: "2026-05-28T11:00:00.000Z",
  timezone: "Asia/Ho_Chi_Minh",
  timezone_label: "Vietnam time",
  locale: "vi-VN",
  user_display_name: "jay@example.com",
};
sampleTurnInput.contextPackage.sourceReviewContext = {
  schema_version: "cmo.source_review_context.v1",
  mode: "session_local",
  tenant_id: "holdstation",
  workspace_id: "holdstation-mini-app",
  user_id: "user_h6",
  session_id: "session_h6",
  request_id: "msg_001",
  source: {
    source_id: "source_review_fixture",
    workspace_id: "holdstation-mini-app",
    source_type: "url",
    source_title: "Fixture source",
    original_url: "https://example.test/source",
    canonical_url: "https://example.test/source",
  },
  extraction: {
    status: "completed",
    content_hash: "sha256:hash_fixture",
    source_text_excerpt: "Fixture source text",
    extracted_summary: "Fixture source summary",
    main_content_quality: "good",
    extraction_coverage: "rendered_dom",
  },
  persistence: {
    saved_to_vault: false,
    truth_status: "session_only",
    review_status: "temporary",
    no_auto_promote: true,
  },
  safety: {
    read_only: true,
    vault_mutation: false,
    gbrain_mutation: false,
    no_promotion: true,
  },
};
sampleTurnInput.contextPackage.sessionLocalSources = [
  {
    type: "session_local_source",
    schema_version: "cmo.session_local_source.v1",
    workspace_id: "holdstation-mini-app",
    session_id: "session_h6",
    turn_id: "msg_source_001",
    source_id: "source_review_fixture",
    source_type: "url",
    source_title: "Fixture source",
    original_url: "https://example.test/source",
    canonical_url: "https://example.test/source",
    extracted_summary: "Fixture source summary",
    source_text_excerpt: "Fixture source text",
    extraction_status: "completed",
    main_content_quality: "good",
    extraction_coverage: "rendered_dom",
    read_depth: "browser_rendered",
    cache_role: "high_quality_evidence",
    nav_heavy: false,
    tool_read_recommended: false,
    content_hash: "sha256:hash_fixture",
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
  },
];
sampleTurnInput.contextPackage.activeSourceId = "source_review_fixture";
sampleTurnInput.contextPack.sourceReviewContext = sampleTurnInput.contextPackage.sourceReviewContext;
sampleTurnInput.contextPackage.sourceAnswerContext = {
  type: "source_answer_context",
  schema_version: "cmo.source_answer_context.v1",
  workspace_id: "holdstation-mini-app",
  session_id: "session_h6",
  source_id: "source_review_fixture",
  query: "Which venues does this apply to?",
  query_type: "specific_question",
  action: "answer_question",
  answerable: true,
  relevant_snippets: ["Fixture source text says this applies to supported trading venues."],
  used_source_fields: ["source_text_cache"],
  source_title: "Fixture source",
  original_url: "https://example.test/source",
  canonical_url: "https://example.test/source",
  content_hash: "sha256:hash_fixture",
  truth_status: "session_only",
  saved_to_vault: false,
  no_auto_promote: true,
  extraction_quality: "good",
  extraction_coverage: "rendered_dom",
  read_depth: "browser_rendered",
  cache_role: "high_quality_evidence",
  nav_heavy: false,
  tool_read_recommended: false,
  warnings: [],
};
sampleTurnInput.contextPack.sourceAnswerContext = sampleTurnInput.contextPackage.sourceAnswerContext;

const makeRuntimeResult = (overrides = {}) => {
  const response = {
    schema_version: "hermes.cmo.response.v1",
    request_id: "req_h6_msg_001",
    session_id: "session_h6",
    turn_id: "msg_001",
    status: "completed",
    answer_basis: {
      mode: "fully_grounded",
      missing_inputs: [],
      assumptions_used: [],
      user_can_override: true,
      suggested_user_inputs: [],
    },
    clarifying_question: {
      required: false,
      question: null,
      reason: null,
      missing_inputs: [],
    },
    answer: {
      format: "markdown",
      title: "H6 Hermes CMO response",
      summary: "Hermes CMO mapped into the app-chat response shape.",
      decision: "Proceed",
      body: "Use Hermes CMO for the canary app only.",
    },
    structured_output: {
      next_steps: ["Review the canary response in CMO chat."],
      currentStep: "Review the canary response in CMO chat.",
    },
    delegations: [
      {
        status: "proposed",
        proposal_only: true,
        target: {
          agent: "surf",
          mode: "surf.default",
        },
        objective: "Gather evidence later if approved.",
      },
    ],
    artifacts: [],
    memory_suggestions: [],
    activity_summary: {
      events_count: 1,
      final_state: "completed",
    },
  };

  return {
    ok: true,
    mode: "live",
    runtimeMode: "live",
    calledHermesCmo: true,
    request: {},
    response,
    activity_events: [
      {
        schema_version: "hermes.activity.event.v1",
        event_id: "evt_h6_001",
        request_id: "req_h6_msg_001",
        session_id: "session_h6",
        turn_id: "msg_001",
        seq: 1,
        created_at: "2026-05-28T11:00:01.000Z",
        source: {
          agent: "cmo",
          mode: "cmo.default",
        },
        type: "run.completed",
        status: "completed",
        message: "Hermes CMO completed.",
        user_visible: true,
        data: {},
      },
    ],
    safety_counters: { ...expectedCounters },
    forbidden_counters: { ...forbiddenZeroCounters },
    strategyMode: "DIAGNOSE",
    mainBottleneck: "Activation loop clarity",
    decisionLabel: "TEST",
    currentStep: "Review the canary response in CMO chat.",
    delegationSummary: [],
    agentsUsed: ["cmo"],
    surfCalls: 0,
    echoCalls: 0,
    safety: {
      counters: { ...expectedCounters },
    },
    ...overrides,
  };
};

try {
  const { tmpDir, router, mapper } = await loadCompiledModules();

  try {
    await withEnv(
      {
        CMO_HERMES_CMO_CHAT_ENABLED: "false",
        CMO_HERMES_CMO_CANARY_APPS: "holdstation-mini-app",
      },
      async () => {
        assert.equal(router.shouldUseHermesCmoChat("holdstation-mini-app"), false, "flag off must keep existing path selected");
      },
    );

    await withEnv(
      {
        CMO_HERMES_CMO_CHAT_ENABLED: "true",
        CMO_HERMES_CMO_CANARY_APPS: "holdstation-mini-app,aion",
      },
      async () => {
        assert.equal(router.shouldUseHermesCmoChat("holdstation-mini-app"), true, "canary app must select Hermes CMO");
      },
    );

    await withEnv(
      {
        CMO_HERMES_CMO_CHAT_ENABLED: "true",
        CMO_HERMES_CMO_CANARY_APPS: "*",
      },
      async () => {
        for (const appId of ["holdstation-mini-app", "aion", "feeback", "winance", "hold-pay", "holdstation-wallet"]) {
          assert.equal(router.shouldUseHermesCmoChat(appId), true, `wildcard canary must select Hermes CMO for ${appId}`);
        }
      },
    );

    await withEnv(
      {
        CMO_HERMES_CMO_CHAT_ENABLED: "true",
        CMO_HERMES_CMO_CANARY_APPS: "holdstation-mini-app",
      },
      async () => {
        assert.equal(router.shouldUseHermesCmoChat("aion"), false, "non-canary app must keep existing path selected");
      },
    );

    const hermesRequest = mapper.mapCmoChatToHermesCmoRequest({
      ...sampleTurnInput,
      sessionId: "session_h6",
      userMessageId: "msg_001",
      createdAt: "2026-05-28T11:00:00.000Z",
      userIdentity: {
        userId: "user_h6",
        userEmail: "jay@example.com",
      },
    });

    assert.equal(hermesRequest.schema_version, "hermes.cmo.request.v1");
    assert.equal(hermesRequest.workspace.app_id, "holdstation-mini-app");
    assert.equal(hermesRequest.context_pack.read_only_snapshot, true);
    assert.equal(hermesRequest.runtime_context.timezone, "Asia/Ho_Chi_Minh");
    assert.equal(hermesRequest.runtime_context.timezone_label, "Vietnam time");
    assert.equal(hermesRequest.runtime_context.locale, "vi-VN");
    assert.equal(hermesRequest.context_pack.source_review_context.schema_version, "cmo.source_review_context.v1");
    assert.equal(hermesRequest.context_pack.source_review_context.mode, "session_local");
    assert.equal(hermesRequest.context_pack.source_review_context.persistence.saved_to_vault, false);
    assert.equal(hermesRequest.context_pack.source_review_context.safety.vault_mutation, false);
    assert.equal(hermesRequest.context_pack.source_review_context.safety.gbrain_mutation, false);
    assert.equal(hermesRequest.context_pack.source_answer_context.schema_version, "cmo.source_answer_context.v1");
    assert.equal(hermesRequest.context_pack.source_answer_context.answerable, true);
    assert.equal(hermesRequest.context_pack.source_answer_context.query_type, "specific_question");
    assert.deepEqual(hermesRequest.context_pack.source_answer_context.used_source_fields, ["source_text_cache"]);
    assert.equal(hermesRequest.context_pack.source_answer_context.saved_to_vault, false);
    assert.equal(hermesRequest.context_pack.source_answer_context.cache_role, "high_quality_evidence");
    assert.equal(hermesRequest.context_pack.source_answer_context.read_depth, "browser_rendered");
    assert.equal(hermesRequest.context_pack.source_answer_context.tool_read_recommended, false);
    assert.equal(hermesRequest.context_pack.active_source_id, "source_review_fixture");
    const sessionLocalSource = hermesRequest.context_pack.artifacts_in.find((artifact) => artifact.type === "session_local_source");
    const sourceAnswerContext = hermesRequest.context_pack.artifacts_in.find((artifact) => artifact.type === "source_answer_context");
    assert.ok(sessionLocalSource, "session local source must be passed as a read-only artifact");
    assert.ok(sourceAnswerContext, "source answer context must be passed as a read-only artifact");
    assert.equal(sessionLocalSource.workspace_id, "holdstation-mini-app");
    assert.equal(sessionLocalSource.saved_to_vault, false);
    assert.equal(sessionLocalSource.official_project_source, false);
    assert.equal(sessionLocalSource.truth_status, "session_only");
    assert.equal(sessionLocalSource.review_status, "temporary");
    assert.equal(sessionLocalSource.no_auto_promote, true);
    assert.equal(sessionLocalSource.extraction_quality, "good");
    assert.equal(sessionLocalSource.extraction_coverage, "rendered_dom");
    assert.equal(sessionLocalSource.read_depth, "browser_rendered");
    assert.equal(sessionLocalSource.cache_role, "high_quality_evidence");
    assert.equal(sessionLocalSource.nav_heavy, false);
    assert.equal(sessionLocalSource.tool_read_recommended, false);

    const researchFollowupInput = JSON.parse(JSON.stringify(sampleTurnInput));
    researchFollowupInput.message = "Ok lập bảng so 5 bên cho mình xem thử";
    researchFollowupInput.contextPackage.userMessage = researchFollowupInput.message;
    researchFollowupInput.contextPackage.sessionLocalResearchResults = [
      {
        type: "session_local_research_result",
        schema_version: "cmo.session_local_research_result.v1",
        workspace_id: "holdstation-mini-app",
        session_id: "session_h6",
        turn_id: "msg_prior_surf",
        created_turn_id: "msg_prior_surf",
        research_id: "research_surf_competitors",
        source_agent: "surf",
        research_type: "competitor_landscape",
        user_question: "Find competitors similar to Hold Pay.",
        competitors: [
          { name: "PayPal Payouts", fit: "high" },
          { name: "Stripe Connect", fit: "high" },
        ],
        sources_used: ["https://paypal.com", "https://stripe.com"],
        key_findings: ["Two products overlap with payout APIs."],
        evidence_gaps: ["Need local fiat rail depth."],
        created_at: "2026-06-01T00:00:00.000Z",
        truth_status: "session_only",
        saved_to_vault: false,
        no_auto_promote: true,
        safety: {
          read_only: true,
          vault_mutation: false,
          gbrain_mutation: false,
          promotion_performed: false,
        },
      },
    ];
    const researchFollowupRequest = mapper.mapCmoChatToHermesCmoRequest({
      ...researchFollowupInput,
      sessionId: "session_h6",
      userMessageId: "msg_research_followup",
      createdAt: "2026-06-01T00:00:00.000Z",
    });
    const researchArtifact = researchFollowupRequest.context_pack.artifacts_in.find((artifact) => artifact.type === "session_local_research_result");
    assert.ok(researchArtifact, "research follow-up must pass completed Surf result as session-local research artifact");
    assert.equal(researchArtifact.schema_version, "cmo.session_local_research_result.v1");
    assert.equal(researchArtifact.truth_status, "session_only");
    assert.equal(researchArtifact.saved_to_vault, false);
    assert.equal(researchArtifact.no_auto_promote, true);
    assert.equal(researchFollowupRequest.context_pack.research_context.artifact_count, 1);
    assert.equal(researchFollowupRequest.source_acquisition.research_followup_requested, true);
    assert.equal(researchFollowupRequest.source_acquisition.research_followup_has_session_artifact, true);
    assert.equal(researchFollowupRequest.source_acquisition.research_followup_missing_session_artifact, false);

    const missingResearchInput = JSON.parse(JSON.stringify(sampleTurnInput));
    missingResearchInput.message = "Trong 5 bên đó, bên nào giống Hold Pay nhất nếu xét merchant payout API + local fiat rail?";
    missingResearchInput.contextPackage.userMessage = missingResearchInput.message;
    missingResearchInput.contextPackage.sessionLocalResearchResults = [];
    const missingResearchRequest = mapper.mapCmoChatToHermesCmoRequest({
      ...missingResearchInput,
      sessionId: "session_h6",
      userMessageId: "msg_research_followup_missing",
      createdAt: "2026-06-01T00:01:00.000Z",
    });
    assert.equal(missingResearchRequest.source_acquisition.research_followup_requested, true);
    assert.equal(missingResearchRequest.source_acquisition.research_followup_has_session_artifact, false);
    assert.equal(missingResearchRequest.source_acquisition.research_followup_missing_session_artifact, true);

    for (const workspace of [
      ["aion", "AION"],
      ["feeback", "Feeback"],
      ["winance", "Winance"],
      ["hold-pay", "Hold Pay"],
      ["holdstation-wallet", "Holdstation Wallet"],
    ]) {
      const [workspaceId, appName] = workspace;
      const workspaceInput = JSON.parse(JSON.stringify(sampleTurnInput));
      workspaceInput.contextPack.workspaceId = workspaceId;
      workspaceInput.contextPack.appId = workspaceId;
      workspaceInput.contextPackage.workspaceId = workspaceId;
      workspaceInput.contextPackage.sourceId = `${workspaceId}__${workspaceId}`;
      workspaceInput.contextPackage.app.id = workspaceId;
      workspaceInput.contextPackage.app.appId = workspaceId;
      workspaceInput.contextPackage.app.workspaceId = workspaceId;
      workspaceInput.contextPackage.app.name = appName;
      workspaceInput.contextPackage.sourceReviewContext.workspace_id = workspaceId;
      workspaceInput.contextPackage.sourceReviewContext.source.workspace_id = workspaceId;
      workspaceInput.contextPackage.sourceReviewContext.session_id = `session_${workspaceId}`;
      workspaceInput.contextPackage.sourceAnswerContext.workspace_id = workspaceId;
      workspaceInput.contextPackage.sourceAnswerContext.session_id = `session_${workspaceId}`;
      workspaceInput.contextPackage.sessionLocalSources[0].workspace_id = workspaceId;
      workspaceInput.contextPackage.sessionLocalSources[0].session_id = `session_${workspaceId}`;
      workspaceInput.contextPackage.sessionLocalSources.push({
        ...workspaceInput.contextPackage.sessionLocalSources[0],
        workspace_id: "holdstation-mini-app",
        session_id: `session_${workspaceId}`,
        source_id: "leaked_holdstation_source",
      });
      workspaceInput.request.workspaceId = workspaceId;
      workspaceInput.request.appId = workspaceId;
      workspaceInput.request.appName = appName;
      const workspaceRequest = mapper.mapCmoChatToHermesCmoRequest({
        ...workspaceInput,
        sessionId: `session_${workspaceId}`,
        userMessageId: `msg_${workspaceId}`,
        createdAt: "2026-05-28T11:00:00.000Z",
        userIdentity: {
          userId: "user_h6",
          userEmail: "jay@example.com",
        },
      });
      const workspaceArtifacts = workspaceRequest.context_pack.artifacts_in.filter((artifact) => artifact.type === "session_local_source");
      const workspaceSourceAnswerContext = workspaceRequest.context_pack.artifacts_in.find((artifact) => artifact.type === "source_answer_context");
      assert.equal(workspaceRequest.workspace.workspace_id, workspaceId);
      assert.equal(workspaceRequest.context_pack.source_review_context.workspace_id, workspaceId);
      assert.equal(workspaceRequest.context_pack.source_answer_context.workspace_id, workspaceId);
      assert.equal(workspaceSourceAnswerContext.workspace_id, workspaceId);
      assert.equal(workspaceArtifacts.length, 1, `${workspaceId} should receive only its own session-local source`);
      assert.equal(workspaceArtifacts[0].workspace_id, workspaceId);
      assert.equal(workspaceArtifacts[0].session_id, `session_${workspaceId}`);
      assert.equal(workspaceArtifacts[0].saved_to_vault, false);
      assert.equal(workspaceArtifacts[0].truth_status, "session_only");
      assert.ok(!workspaceArtifacts.some((artifact) => artifact.source_id === "leaked_holdstation_source"), `${workspaceId} must not receive Holdstation source artifacts`);
    }
    const priorAssistantContext = hermesRequest.context_pack.selected_context.find((item) => item?.kind === "recent_chat_message" && item?.role === "assistant");
    assert.ok(priorAssistantContext, "follow-up context must include prior assistant message in selected_context");
    assert.match(priorAssistantContext.content, /POST 1:/);
    assert.match(priorAssistantContext.content, /POST 2:/);
    assert.match(priorAssistantContext.content, /POST 3:/);
    assert.equal(priorAssistantContext.full_content, priorAssistantContext.content);
    assert.equal(priorAssistantContext.truncated, false);
    assert.equal(hermesRequest.constraints.allowSubAgentExecution, false);
    assert.equal(hermesRequest.constraints.allowSurfExecution, false);
    assert.equal(hermesRequest.constraints.allowEchoExecution, false);
    assert.equal(hermesRequest.constraints.allowVaultAgentExecution, false);
    assert.equal(hermesRequest.constraints.allowVaultWrites, false);
    assert.equal(hermesRequest.constraints.allowSupabaseWrites, false);
    assert.equal(hermesRequest.constraints.allowSessionWrites, false);
    assert.equal(hermesRequest.constraints.allowRawCaptureWrites, false);
    assert.equal(hermesRequest.constraints.allowOpenClawCalls, false);
    assert.equal(hermesRequest.constraints.no_direct_supabase_mutation, true);
    assert.equal(hermesRequest.constraints.no_direct_session_write, true);
    assert.equal(hermesRequest.constraints.no_direct_raw_capture_write, true);
    assert.equal(hermesRequest.constraints.delegations_mode, "proposals_only");
    assert.deepEqual(hermesRequest.constraints.allowed_agents, ["echo", "surf"]);
    assert.equal(hermesRequest.tool_policy.schema_version, "cmo.hermes.tool_policy.v1");
    assert.equal(hermesRequest.tool_policy.role, "product_shell_context_provider");
    assert.equal(hermesRequest.tool_policy.read_web_allowed, true);
    assert.equal(hermesRequest.tool_policy.read_browser_allowed, true);
    assert.equal(hermesRequest.tool_policy.read_file_allowed, true);
    assert.equal(hermesRequest.tool_policy.terminal_read_only_allowed, true);
    assert.equal(hermesRequest.tool_policy.durable_writes_require_confirmation, true);
    assert.ok(hermesRequest.tool_policy.allowed_toolsets.includes("web"));
    assert.ok(hermesRequest.tool_policy.allowed_toolsets.includes("browser"));
    assert.ok(hermesRequest.tool_policy.allowed_toolsets.includes("file"));
    assert.ok(hermesRequest.tool_policy.allowed_toolsets.includes("terminal_read_only"));
    assert.deepEqual(hermesRequest.tool_policy.disabled_toolsets, ["messaging", "cronjob", "kanban"]);
    assert.equal(hermesRequest.tool_policy.durable_writes.no_auto_save_13_sources, true);
    assert.equal(hermesRequest.tool_policy.durable_writes.no_auto_promote_12_knowledge, true);
    assert.equal(hermesRequest.tool_policy.durable_writes.no_gbrain_mutation, true);
    assert.equal(hermesRequest.product_boundary.engine_owns_session, true);
    assert.equal(hermesRequest.product_boundary.engine_owns_turn_logging, true);
    assert.equal(hermesRequest.product_boundary.durable_write_requires_approval, true);
    assert.equal(hermesRequest.product_boundary.no_auto_save_13_sources, true);
    assert.equal(hermesRequest.product_boundary.no_auto_promote_12_knowledge, true);
    assert.equal(hermesRequest.product_boundary.final_answer_owner_when_live, "hermes_cmo");
    assert.equal(hermesRequest.product_boundary.cmo_engine_must_not_synthesize_source_review_when_live, true);
    assert.equal(hermesRequest.product_boundary.cmo_engine_must_not_synthesize_source_answer_when_live, true);
    assert.equal(hermesRequest.source_acquisition.chat_role, "cache_fallback_context_provider");
    assert.equal(hermesRequest.source_acquisition.official_ingestion_role, "inputs_priorities_sources_ui");
    assert.equal(hermesRequest.source_acquisition.tool_read_recommended, false);
    assert.equal(hermesRequest.source_acquisition.nav_heavy_source_count, 0);
    assert.equal(hermesRequest.source_acquisition.original_url, "https://example.test/source");
    assert.equal(hermesRequest.source_acquisition.extraction_quality, "good");
    assert.equal(hermesRequest.source_acquisition.read_depth, "browser_rendered");
    assert.equal(hermesRequest.source_acquisition.cache_role, "high_quality_evidence");
    assert.equal(hermesRequest.source_acquisition.no_auto_save_13_sources, true);
    assert.equal(hermesRequest.session_context_pack, null);

    const navHeavyInput = JSON.parse(JSON.stringify(sampleTurnInput));
    navHeavyInput.message = "Tóm tắt link đó";
    navHeavyInput.request.message = "Tóm tắt link đó";
    navHeavyInput.contextPackage.userMessage = "Tóm tắt link đó";
    navHeavyInput.contextPackage.sessionLocalSources[0] = {
      ...navHeavyInput.contextPackage.sessionLocalSources[0],
      extracted_summary: "Home Menu Docs Blog Contact Privacy Terms Login",
      source_text_excerpt: "Home Menu Docs Blog Contact Privacy Terms Login",
      extraction_status: "partial",
      main_content_quality: "low",
      extraction_coverage: "static_html",
      read_depth: "partial",
      cache_role: "fallback_only",
      nav_heavy: true,
      tool_read_recommended: true,
      warnings: ["nav_heavy"],
    };
    navHeavyInput.contextPackage.sourceAnswerContext = {
      ...navHeavyInput.contextPackage.sourceAnswerContext,
      query: "Tóm tắt link đó",
      query_type: "summarize",
      action: "summarize",
      answerable: false,
      relevant_snippets: [],
      extraction_quality: "low",
      extraction_coverage: "static_html",
      read_depth: "partial",
      cache_role: "fallback_only",
      nav_heavy: true,
      tool_read_recommended: true,
      reason: "extraction_partial",
      suggested_next_step: "deep_read_or_rendered_fetch",
      warnings: ["nav_heavy"],
    };
    navHeavyInput.contextPack.sourceAnswerContext = navHeavyInput.contextPackage.sourceAnswerContext;
    const navHeavyHermesRequest = mapper.mapCmoChatToHermesCmoRequest({
      ...navHeavyInput,
      sessionId: "session_h6",
      userMessageId: "msg_nav_heavy_001",
      createdAt: "2026-05-28T11:05:00.000Z",
      userIdentity: {
        userId: "user_h6",
        userEmail: "jay@example.com",
      },
    });
    assert.equal(navHeavyHermesRequest.context_pack.source_answer_context.answerable, false);
    assert.equal(navHeavyHermesRequest.context_pack.source_answer_context.cache_role, "fallback_only");
    assert.equal(navHeavyHermesRequest.context_pack.source_answer_context.nav_heavy, true);
    assert.equal(navHeavyHermesRequest.context_pack.source_answer_context.tool_read_recommended, true);
    assert.equal(navHeavyHermesRequest.source_acquisition.chat_role, "cache_fallback_context_provider");
    assert.equal(navHeavyHermesRequest.source_acquisition.tool_read_recommended, true);
    assert.equal(navHeavyHermesRequest.source_acquisition.nav_heavy_source_count, 1);
    assert.equal(navHeavyHermesRequest.source_acquisition.original_url, "https://example.test/source");
    assert.equal(navHeavyHermesRequest.source_acquisition.extraction_quality, "low");
    assert.equal(navHeavyHermesRequest.source_acquisition.read_depth, "partial");
    assert.equal(navHeavyHermesRequest.source_acquisition.cache_role, "fallback_only");
    assert.equal(navHeavyHermesRequest.source_acquisition.nav_heavy, true);
    const navHeavyArtifact = navHeavyHermesRequest.context_pack.artifacts_in.find((artifact) => artifact.type === "session_local_source");
    assert.equal(navHeavyArtifact.original_url, "https://example.test/source");
    assert.equal(navHeavyArtifact.cache_role, "fallback_only");
    assert.equal(navHeavyArtifact.read_depth, "partial");
    assert.equal(navHeavyArtifact.nav_heavy, true);
    assert.equal(navHeavyArtifact.tool_read_recommended, true);

    const mapped = mapper.mapHermesCmoResponseToChatResult(makeRuntimeResult());
    assert.equal(mapped.runtimeStatus, "live");
    assert.equal(mapped.runtimeMode, "live");
    assert.equal(mapped.runtimeProvider, "hermes");
    assert.equal(mapped.runtimeAgent, "cmo");
    assert.equal(mapped.calledHermesCmo, true);
    assert.equal(mapped.hermesCmoMetadata.runtimeMode, "hermes_cmo");
    assert.equal(mapped.hermesCmoMetadata.hermesRequestSent, true);
    assert.equal(mapped.hermesCmoMetadata.productRenderSource, "hermes_cmo");
    assert.equal(mapped.delegationsMode, "proposals_only");
    assert.deepEqual(mapped.hermesCmoCounters, expectedCounters);
    assert.deepEqual(mapped.hermesCmoMetadata.forbiddenCounters, forbiddenZeroCounters);
    assert.equal(mapped.hermesCmoMetadata.strategyMode, "DIAGNOSE");
    assert.equal(mapped.hermesCmoMetadata.mainBottleneck, "Activation loop clarity");
    assert.equal(mapped.hermesCmoMetadata.decisionLabel, "TEST");
    assert.match(mapped.answer, /Use Hermes CMO/);
    assert.ok(
      mapped.suggestedActions.some((action) => action.label.includes("proposed surf delegation")),
      "delegations must map as reviewable proposals only",
    );

    const sourceTranslateBase = makeRuntimeResult();
    const sourceTranslateMapped = mapper.mapHermesCmoResponseToChatResult({
      ...sourceTranslateBase,
      response: {
        ...sourceTranslateBase.response,
        answer_basis: {
          ...sourceTranslateBase.response.answer_basis,
          mode: "source_translate",
        },
        answer: {
          format: "markdown",
          title: "CMO strategic response",
          summary: "REVIEW",
          decision: "KEEP",
          body: "This CMO synthesis wrapper should not be visible for source translation.",
        },
        structured_output: {
          ...sourceTranslateBase.response.structured_output,
          classification: "source_translate",
        },
      },
      delegationSummary: [
        {
          delegationKey: "echo:source_translate",
          delegationId: "del_source_translate",
          targetAgent: "echo",
          mode: "echo.source_translate",
          objective: "Translate the active source.",
          status: "completed",
          summary: "Echo returned 1 output(s).",
          response: {
            schema_version: "echo.response.v1",
            handoff_id: "del_source_translate",
            agent: "echo",
            mode: "echo.source_translate",
            status: "completed",
            outputs: [
              {
                label: "translation",
                copy: "Bản dịch tự nhiên của nguồn đang hoạt động.",
              },
            ],
            notes: [],
          },
        },
      ],
      safety_counters: {
        ...sourceTranslateBase.safety_counters,
        echoCalls: 1,
      },
      echoCalls: 1,
      agentsUsed: ["cmo", "echo"],
    });
    assert.equal(sourceTranslateMapped.answer, "Bản dịch tự nhiên của nguồn đang hoạt động.");
    assert.doesNotMatch(sourceTranslateMapped.answer, /CMO strategic response|Decision:|REVIEW/);

    const sourceAnswerBase = makeRuntimeResult();
    const sourceAnswerMapped = mapper.mapHermesCmoResponseToChatResult({
      ...sourceAnswerBase,
      response: {
        ...sourceAnswerBase.response,
        answer_basis: {
          ...sourceAnswerBase.response.answer_basis,
          mode: "source_answer",
        },
        answer: {
          format: "markdown",
          title: "CMO strategic response",
          summary: "REVIEW",
          decision: "KEEP",
          body: "Feeback applies where the active source says the campaign surface is supported.",
        },
        structured_output: {
          classification: "source_answer",
          response_style: "source_answer",
          tool_policy: "none",
          speech_act: "answer",
          target_type: "session_local_source",
          target_ref: "source_review_fixture",
          action: "answer_from_source",
          confidence: 0.94,
          negated_intents: [],
          uses_session_local_source: true,
          uses_vault_context_pack: false,
        },
      },
    });
    assert.equal(sourceAnswerMapped.answer, "Feeback applies where the active source says the campaign surface is supported.");
    assert.doesNotMatch(sourceAnswerMapped.answer, /CMO strategic response|Decision:|REVIEW/);

    const nativeAcknowledgementBase = makeRuntimeResult();
    const nativeAcknowledgementMapped = mapper.mapHermesCmoResponseToChatResult({
      ...nativeAcknowledgementBase,
      response: {
        ...nativeAcknowledgementBase.response,
        answer_basis: {
          ...nativeAcknowledgementBase.response.answer_basis,
          mode: "native_conversation",
        },
        answer: {
          format: "markdown",
          title: "CMO strategic response",
          summary: "REVIEW",
          decision: "KEEP",
          body: "Ok bro, rõ rồi.",
        },
        structured_output: {
          classification: "native_conversation",
          response_style: "native_conversation",
          tool_policy: "none",
        },
      },
    });
    assert.equal(nativeAcknowledgementMapped.answer, "Ok bro, rõ rồi.");
    assert.doesNotMatch(nativeAcknowledgementMapped.answer, /CMO strategic response|Decision:|REVIEW/);

    const clarifyBase = makeRuntimeResult();
    const clarifyMapped = mapper.mapHermesCmoResponseToChatResult({
      ...clarifyBase,
      response: {
        ...clarifyBase.response,
        status: "needs_user_input",
        classification: "clarify",
        answer_basis: {
          mode: "needs_user_input",
          missing_inputs: ["source URL"],
          assumptions_used: [],
          user_can_override: true,
          suggested_user_inputs: ["Send the source URL or file."],
        },
        clarifying_question: {
          required: true,
          question: "Please send the source URL or file you want me to read.",
          reason: "No source was provided.",
          missing_inputs: ["source URL"],
        },
        answer: null,
        structured_output: null,
      },
    });
    assert.match(clarifyMapped.answer, /Need Clarification/);
    assert.match(clarifyMapped.answer, /Please send the source URL/);

    const saveToVaultIntentBase = makeRuntimeResult();
    const saveToVaultIntentMapped = mapper.mapHermesCmoResponseToChatResult({
      ...saveToVaultIntentBase,
      response: {
        ...saveToVaultIntentBase.response,
        answer_basis: {
          ...saveToVaultIntentBase.response.answer_basis,
          mode: "save_to_vault",
        },
        answer: {
          format: "markdown",
          title: "CMO strategic response",
          summary: "REVIEW",
          decision: "WAIT",
          body: "I can prepare this for the explicit Save Source flow, but I will not write 13 Sources from chat.",
        },
        structured_output: {
          classification: "save_to_vault",
          response_style: "save_to_vault",
          tool_policy: "vault_agent",
          save_requires_explicit_user_confirmation: true,
          no_auto_save_13_sources: true,
        },
      },
    });
    assert.equal(saveToVaultIntentMapped.answer, "I can prepare this for the explicit Save Source flow, but I will not write 13 Sources from chat.");
    assert.doesNotMatch(saveToVaultIntentMapped.answer, /CMO strategic response|Decision:|REVIEW/);

    const structuredReviewBase = makeRuntimeResult();
    const structuredReviewMapped = mapper.mapHermesCmoResponseToChatResult({
      ...structuredReviewBase,
      response: {
        ...structuredReviewBase.response,
        answer_basis: {
          ...structuredReviewBase.response.answer_basis,
          mode: "structured_review",
        },
        answer: {
          format: "markdown",
          title: "CMO strategic response",
          summary: "REVIEW",
          decision: "KEEP",
          body: "Review body stays structured for explicit review requests.",
        },
        structured_output: {
          classification: "structured_review",
          response_style: "structured_review",
          tool_policy: "none",
        },
      },
    });
    assert.match(structuredReviewMapped.answer, /## CMO strategic response/);
    assert.match(structuredReviewMapped.answer, /Decision: KEEP/);

    const externalResearchBase = makeRuntimeResult();
    const externalResearchMapped = mapper.mapHermesCmoResponseToChatResult({
      ...externalResearchBase,
      response: {
        ...externalResearchBase.response,
        answer_basis: {
          ...externalResearchBase.response.answer_basis,
          mode: "external_research",
        },
        answer: {
          format: "markdown",
          title: "External research result",
          summary: "Surf-backed answer",
          decision: "KEEP",
          body: "Hermes CMO used Surf evidence and returned the final product answer.",
        },
        structured_output: {
          classification: "external_research",
          response_style: "research_answer",
          tool_policy: "surf",
        },
      },
      delegationSummary: [
        {
          delegationKey: "surf:surf.default",
          delegationId: "del_external_research",
          targetAgent: "surf",
          mode: "surf.default",
          objective: "Gather external evidence.",
          status: "completed",
          summary: "Surf returned evidence.",
        },
      ],
      safety_counters: {
        ...externalResearchBase.safety_counters,
        surfCalls: 1,
      },
      surfCalls: 1,
      agentsUsed: ["cmo", "surf"],
    });
    assert.match(externalResearchMapped.answer, /Hermes CMO used Surf evidence/);
    assert.equal(externalResearchMapped.hermesCmoMetadata.surfCalls, 1);
    assert.deepEqual(externalResearchMapped.hermesCmoMetadata.agentsUsed, ["cmo", "surf"]);

    const researchFollowupMapped = mapper.mapHermesCmoResponseToChatResult({
      ...makeRuntimeResult(),
      response: {
        ...makeRuntimeResult().response,
        answer_basis: {
          mode: "external_research",
          missing_inputs: [],
          assumptions_used: [],
          user_can_override: true,
          suggested_user_inputs: [],
        },
        answer: {
          format: "markdown",
          title: "Follow-up comparison",
          summary: "Comparison from existing Surf results.",
          decision: "KEEP",
          body: "| Product | Similarity | Note |\n| --- | --- | --- |\n| UserVoice | High | Feedback workflow overlap |",
        },
        structured_output: {
          classification: "research_followup",
          response_style: "research_followup",
          tool_policy: "none",
          used_session_local_research_result: true,
        },
      },
      delegationSummary: [],
      safety_counters: { ...expectedCounters, surfCalls: 0 },
      safety: {
        counters: { ...expectedCounters, surfCalls: 0 },
      },
      agentsUsed: ["cmo"],
      surfCalls: 0,
      echoCalls: 0,
    });
    assert.equal(
      researchFollowupMapped.answer,
      "| Product | Similarity | Note |\n| --- | --- | --- |\n| UserVoice | High | Feedback workflow overlap |",
    );
    assert.equal(researchFollowupMapped.hermesCmoMetadata.productRenderSource, "hermes_cmo");
    assert.equal(researchFollowupMapped.hermesCmoMetadata.surfCalls, 0);
    assert.equal(researchFollowupMapped.hermesCmoCounters.surfCalls, 0);

    const strategyOnlyReviewBase = makeRuntimeResult();
    const strategyOnlyReviewMapped = mapper.mapHermesCmoResponseToChatResult({
      ...strategyOnlyReviewBase,
      response: {
        ...strategyOnlyReviewBase.response,
        answer_basis: {
          ...strategyOnlyReviewBase.response.answer_basis,
          mode: "fully_grounded",
        },
        answer: {
          format: "markdown",
          title: "CMO strategic response",
          summary: "REVIEW",
          decision: "KEEP",
          body: "Legacy strategy_only review body stays structured.",
        },
        structured_output: {
          classification: "strategy_only",
          strategyMode: "REVIEW",
          mainBottleneck: "source proof gap",
          decisionLabel: "KEEP",
          currentStep: "Confirm project source fit.",
          uses_session_local_source: true,
          active_source_id: "source_review_fixture",
        },
      },
    });
    assert.match(strategyOnlyReviewMapped.answer, /## CMO strategic response/);
    assert.match(strategyOnlyReviewMapped.answer, /Decision: KEEP/);
    assert.match(strategyOnlyReviewMapped.answer, /Legacy strategy_only review body stays structured/);

    const noDelegationNeedsSurfBase = makeRuntimeResult();
    const noDelegationNeedsSurfMapped = mapper.mapHermesCmoResponseToChatResult({
      ...noDelegationNeedsSurfBase,
      response: {
        ...noDelegationNeedsSurfBase.response,
        structured_output: {
          ...noDelegationNeedsSurfBase.response.structured_output,
          classification: "needs_surf",
        },
        delegations: [],
        activity_summary: {
          events_count: 3,
          final_state: "completed",
        },
      },
      activity_events: [
        ...noDelegationNeedsSurfBase.activity_events,
        {
          schema_version: "hermes.activity.event.v1",
          event_id: "evt_h6_surf_started_stale",
          request_id: "req_h6_msg_001",
          session_id: "session_h6",
          turn_id: "msg_001",
          seq: 2,
          created_at: "2026-05-28T11:00:02.000Z",
          source: {
            agent: "surf",
            mode: "surf.default",
          },
          type: "delegation.started",
          status: "running",
          message: "Calling Surf.",
          user_visible: true,
          data: {},
        },
        {
          schema_version: "hermes.activity.event.v1",
          event_id: "evt_h6_surf_completed_stale",
          request_id: "req_h6_msg_001",
          session_id: "session_h6",
          turn_id: "msg_001",
          seq: 3,
          created_at: "2026-05-28T11:00:03.000Z",
          source: {
            agent: "surf",
            mode: "surf.default",
          },
          type: "delegation.completed",
          status: "completed",
          message: "Surf completed.",
          user_visible: true,
          data: {},
        },
      ],
      safety_counters: { ...expectedCounters, surfCalls: 1 },
      safety: {
        counters: { ...expectedCounters, surfCalls: 1 },
      },
      delegationSummary: [],
      agentsUsed: ["cmo", "surf"],
      surfCalls: 1,
      echoCalls: 0,
    });
    assert.equal(noDelegationNeedsSurfMapped.hermesCmoMetadata.surfCalls, 0);
    assert.equal(noDelegationNeedsSurfMapped.hermesCmoCounters.surfCalls, 0);
    assert.deepEqual(noDelegationNeedsSurfMapped.hermesCmoMetadata.agentsUsed, ["cmo"]);
    assert.equal(noDelegationNeedsSurfMapped.hermesCmoMetadata.delegationSummary.length, 0);
    assert.equal(
      noDelegationNeedsSurfMapped.hermesCmoMetadata.activityEvents.some((event) => event.sourceAgent === "surf"),
      false,
      "classification needs_surf without executable delegations must not create Surf activity rows",
    );
    const staleMappedResult = mapper.sanitizeHermesCmoMappedChatResult({
      ...noDelegationNeedsSurfMapped,
      hermesCmoCounters: { ...noDelegationNeedsSurfMapped.hermesCmoCounters, surfCalls: 1 },
      hermesCmoMetadata: {
        ...noDelegationNeedsSurfMapped.hermesCmoMetadata,
        counters: { ...noDelegationNeedsSurfMapped.hermesCmoMetadata.counters, surfCalls: 1 },
        activityEvents: [
          ...(noDelegationNeedsSurfMapped.hermesCmoMetadata.activityEvents ?? []),
          {
            eventId: "evt_h6_surf_stale_app_chat",
            type: "delegation.completed",
            status: "completed",
            message: "Surf completed.",
            userVisible: true,
            sourceAgent: "surf",
            sourceMode: "surf.default",
          },
        ],
        delegationSummary: [],
        agentsUsed: ["cmo", "surf"],
        surfCalls: 1,
        echoCalls: 0,
      },
    });
    assert.equal(staleMappedResult.hermesCmoMetadata.surfCalls, 0);
    assert.equal(staleMappedResult.hermesCmoMetadata.counters.surfCalls, 0);
    assert.equal(staleMappedResult.hermesCmoCounters.surfCalls, 0);
    assert.deepEqual(staleMappedResult.hermesCmoMetadata.agentsUsed, ["cmo"]);
    assert.equal(
      staleMappedResult.hermesCmoMetadata.activityEvents.some((event) => event.sourceAgent === "surf"),
      false,
      "final app-chat sanitizer must remove stale Surf activity when delegationSummary is empty",
    );
    const finalNoDelegationAppChatFields = {
      activityEvents: staleMappedResult.hermesCmoMetadata.activityEvents,
      delegationSummary: staleMappedResult.hermesCmoMetadata.delegationSummary,
      agentsUsed: staleMappedResult.hermesCmoMetadata.agentsUsed,
      surfCalls: staleMappedResult.hermesCmoMetadata.surfCalls,
      echoCalls: staleMappedResult.hermesCmoMetadata.echoCalls,
      hermesCmoCounters: staleMappedResult.hermesCmoCounters,
      hermesCmoMetadata: staleMappedResult.hermesCmoMetadata,
    };
    assert.equal(finalNoDelegationAppChatFields.surfCalls, 0);
    assert.deepEqual(finalNoDelegationAppChatFields.agentsUsed, ["cmo"]);
    assert.equal(finalNoDelegationAppChatFields.hermesCmoCounters.surfCalls, 0);
    assert.equal(finalNoDelegationAppChatFields.hermesCmoMetadata.surfCalls, 0);
    assert.equal(
      finalNoDelegationAppChatFields.activityEvents.some((event) => event.sourceAgent === "surf"),
      false,
      "final top-level app-chat fields must not expose Surf rows without executable delegations",
    );

    const realSurfDelegationBase = makeRuntimeResult();
    const realSurfDelegationMapped = mapper.mapHermesCmoResponseToChatResult({
      ...realSurfDelegationBase,
      response: {
        ...realSurfDelegationBase.response,
        delegations: [],
        activity_summary: {
          events_count: 3,
          final_state: "completed",
        },
      },
      activity_events: [
        ...realSurfDelegationBase.activity_events,
        {
          schema_version: "hermes.activity.event.v1",
          event_id: "evt_h6_surf_started_real",
          request_id: "req_h6_msg_001",
          session_id: "session_h6",
          turn_id: "msg_001",
          seq: 2,
          created_at: "2026-05-28T11:00:02.000Z",
          source: {
            agent: "surf",
            mode: "surf.default",
          },
          type: "delegation.started",
          status: "running",
          message: "Calling Surf.",
          user_visible: true,
          data: {},
        },
        {
          schema_version: "hermes.activity.event.v1",
          event_id: "evt_h6_surf_completed_real",
          request_id: "req_h6_msg_001",
          session_id: "session_h6",
          turn_id: "msg_001",
          seq: 3,
          created_at: "2026-05-28T11:00:03.000Z",
          source: {
            agent: "surf",
            mode: "surf.default",
          },
          type: "delegation.completed",
          status: "completed",
          message: "Surf completed.",
          user_visible: true,
          data: {},
        },
      ],
      safety_counters: { ...expectedCounters, surfCalls: 1 },
      safety: {
        counters: { ...expectedCounters, surfCalls: 1 },
      },
      delegationSummary: [
        {
          delegationId: "dlg_h6_surf_real",
          targetAgent: "surf",
          mode: "surf.default",
          objective: "Gather live evidence.",
          status: "completed",
          summary: "Surf completed.",
        },
      ],
      agentsUsed: ["cmo", "surf"],
      surfCalls: 1,
      echoCalls: 0,
    });
    assert.equal(realSurfDelegationMapped.hermesCmoMetadata.surfCalls, 1);
    assert.equal(realSurfDelegationMapped.hermesCmoCounters.surfCalls, 1);
    assert.deepEqual(realSurfDelegationMapped.hermesCmoMetadata.agentsUsed, ["cmo", "surf"]);
    assert.equal(
      realSurfDelegationMapped.hermesCmoMetadata.activityEvents.some((event) => event.sourceAgent === "surf"),
      true,
      "real executed Surf delegations must keep Surf activity rows",
    );

    const invalidCounters = mapper.validateHermesCmoChatCounters(
      makeRuntimeResult({
        forbidden_counters: {
          ...forbiddenZeroCounters,
          vaultWrites: 1,
        },
      }),
    );
    assert.equal(invalidCounters.ok, false);
    assert.match(invalidCounters.errorReason, /^forbidden_counter_non_zero:vaultWrites=1/);

    const source = await readFile(path.join(cmoDir, "app-chat-store.ts"), "utf8");
    assert.match(source, /const hermesCmoChatRequested = !request\.forceFallback && shouldUseHermesCmoChat\(request\.appId\)/);
    assert.match(source, /shouldUseHermesCmoChat\(request\.appId\)/);
    assert.match(source, /runHermesCmoRuntime\(hermesRequest\)/);
    assert.match(source, /answer = mappedHermesResult\.answer/);
    assert.match(source, /productRenderSource = "hermes_cmo"/);
    assert.match(source, /if \(!usedHermesCmoChat\)/);
    assert.match(source, /productRenderSource = hermesCmoChatRequested \? "fallback_after_hermes_failure"/);
    assert.match(source, /productFallbackReason = hermesCmoChatRequested/);
    assert.match(source, /withSessionSourceRoutingMetadata/);
    assert.match(source, /fallbackContextPackage/);
    assert.match(source, /failed_then_existing_fallback/);
    assert.match(source, /guardrail_violation_then_existing_fallback/);
    assert.doesNotMatch(source, /Source Review:|What I Read|CMO Read/);

    const runtimeSource = await readFile(path.join(cmoDir, "runtime.ts"), "utf8");
    assert.match(runtimeSource, /function sourceReviewFallbackAnswer/);
    assert.match(runtimeSource, /reviewContext\.mode !== "review_only"/);
    assert.match(runtimeSource, /Source Review:/);
    const hermesRuntimeSource = await readFile(path.join(cmoDir, "hermes-cmo-runtime.ts"), "utf8");
    assert.match(hermesRuntimeSource, /HERMES_CMO_TOOL_AGENT_DEFAULT_PATH = "\/agents\/cmo\/tool-execute"/);
    assert.match(hermesRuntimeSource, /selectedHermesCmoConfig/);
    assert.match(hermesRuntimeSource, /requestIsSourceBackedOrSeeking/);
    assert.match(hermesRuntimeSource, /requestIsExternalResearch/);
    assert.match(hermesRuntimeSource, /researchFollowupTextPattern/);
    assert.match(hermesRuntimeSource, /stripAcknowledgementPrefix/);
    assert.match(hermesRuntimeSource, /requestIsResearchFollowup/);
    assert.match(hermesRuntimeSource, /requestIsResearchFollowupUsingPriorResult/);
    assert.match(hermesRuntimeSource, /researchFollowupUsesPriorResult\s*\?\s*false/);
    assert.match(hermesRuntimeSource, /user_message: userMessage/);
    assert.match(hermesRuntimeSource, /input: \{/);
    assert.match(hermesRuntimeSource, /externalResearchTextPattern/);
    assert.match(hermesRuntimeSource, /toolEndpointEnabled && !externalResearch && requestIsSourceBackedOrSeeking/);
    assert.match(hermesRuntimeSource, /toolEndpointRequest/);
    assert.match(hermesRuntimeSource, /user_message: userMessage/);
    assert.match(hermesRuntimeSource, /message: userMessage/);
    assert.match(hermesRuntimeSource, /active_source_id: activeSourceId/);
    assert.match(hermesRuntimeSource, /hermes\.cmo\.tool_response\.v1/);
    assert.match(hermesRuntimeSource, /tool_read/);
    assert.match(hermesRuntimeSource, /tool_name/);
    assert.match(hermesRuntimeSource, /tool_result/);
    assert.match(hermesRuntimeSource, /used_live_tool_read/);
    assert.match(hermesRuntimeSource, /normalizeToolResponseActivitySummary/);
    assert.match(hermesRuntimeSource, /activity_summary_invalid:missing_activity_events/);
    assert.match(hermesRuntimeSource, /unsafe_tool_trace_summary/);
    assert.match(hermesRuntimeSource, /allowToolCapableCmoSource/);
    assert.match(hermesRuntimeSource, /source_invalid:mode=/);
    assert.match(hermesRuntimeSource, /cmo\.tool_capable/);
    assert.match(hermesRuntimeSource, /side_effects/);
    assert.match(hermesRuntimeSource, /data_unsafe:\$\{String\(eventType\)\} key=/);
    assert.match(hermesRuntimeSource, /context_pack_present/);
    assert.match(hermesRuntimeSource, /answer_basis_mode/);
    assert.match(hermesRuntimeSource, /safe_metadata_only/);
    assert.match(hermesRuntimeSource, /delegations_count/);
    assert.match(hermesRuntimeSource, /tool_family/);
    assert.match(hermesRuntimeSource, /bytes_read/);
    assert.match(hermesRuntimeSource, /source_text\.\*/);

    const hermesClientSource = await readFile(path.join(cmoDir, "hermes-client.ts"), "utf8");
    assert.match(hermesClientSource, /\/agents\/surf\/execute/);
    assert.match(hermesClientSource, /hermes-surf-traces/);
    assert.match(hermesClientSource, /surfTraceRequestPayload/);
    assert.match(hermesClientSource, /surfTraceResponsePayload/);
    assert.match(hermesClientSource, /safe_reason/);
    assert.match(hermesClientSource, /error_code/);

    const delegationExecutorSource = await readFile(path.join(cmoDir, "hermes-cmo-delegation-executor.ts"), "utf8");
    assert.match(delegationExecutorSource, /workspace_id: input\.workspaceId/);
    assert.match(delegationExecutorSource, /app_id: input\.appId/);
    assert.match(delegationExecutorSource, /user_question: input\.userMessage/);
    assert.match(delegationExecutorSource, /research_objective: delegation\.objective/);
    assert.match(delegationExecutorSource, /active_source_url: sourceUrl/);
    assert.match(delegationExecutorSource, /expected_output_format: expectedOutputFormat/);
    assert.match(delegationExecutorSource, /no_source_auto_save: true/);
    assert.match(delegationExecutorSource, /no_knowledge_promotion: true/);
    assert.match(delegationExecutorSource, /no_gbrain_mutation: true/);

    const appChatStoreSource = await readFile(path.join(cmoDir, "app-chat-store.ts"), "utf8");
    assert.match(appChatStoreSource, /cmo\.session_local_research_result\.v1/);
    assert.match(appChatStoreSource, /sessionLocalResearchResultFromHermesResult/);
    assert.match(appChatStoreSource, /mergeSessionLocalResearchResults/);
    assert.match(appChatStoreSource, /sessionLocalResearchResults/);

    const mapperSource = await readFile(path.join(cmoDir, "hermes-cmo-chat-mapper.ts"), "utf8");
    assert.match(mapperSource, /sessionLocalResearchResultArtifacts/);
    assert.match(mapperSource, /research_context/);
    assert.match(mapperSource, /research_followup_requested/);

    const workspaceTypesSource = await readFile(path.join(cmoDir, "app-workspace-types.ts"), "utf8");
    assert.match(workspaceTypesSource, /sourceMode\?: "cmo\.default" \| "cmo\.tool_capable" \| HermesCmoExecutableMode/);
    assert.match(workspaceTypesSource, /CmoSessionLocalResearchResult/);

    const replaySource = await readFile(path.join(rootDir, "scripts", "cmo-hermes-cmo-replay-trace.mjs"), "utf8");
    assert.match(replaySource, /rootCauseClassification/);
    assert.match(replaySource, /request_present/);
    assert.match(replaySource, /productRenderSource/);
    assert.match(replaySource, /productFallbackReason/);
    assert.match(replaySource, /findSessionPathByRequest/);
    assert.match(replaySource, /sessionTraceMatch/);
    assert.match(replaySource, /selectedHermesEndpoint/);
    assert.match(replaySource, /requestUserMessage/);
    assert.match(replaySource, /resolved_user_message_present/);
    assert.match(replaySource, /missing user_message\/message\/input\.user_message\/intent\.user_message/);
    assert.match(replaySource, /tool_read_events/);
    assert.match(replaySource, /answer_basis_mode/);
    assert.match(replaySource, /side_effects_summary/);
    assert.match(replaySource, /tools_used/);
    assert.match(replaySource, /side_effects/);
    assert.match(replaySource, /timeoutConfig/);
    assert.match(replaySource, /cmoHermesTimeoutMs/);
    assert.match(replaySource, /cmoLiveAppTurnTimeoutMs/);
    assert.match(replaySource, /cmoFallbackFastAfterMs/);
    assert.match(replaySource, /supportsLongRunningSurfExternalResearchMs/);
    assert.match(replaySource, /product_live_success/);
    assert.match(replaySource, /execute_request_missing_user_message/);
    assert.match(replaySource, /external_research_surf_execution_blocked/);
    assert.match(replaySource, /external_research_expected_surf_allowed/);
    assert.match(replaySource, /research_followup_artifact_missing/);
    assert.match(replaySource, /CMO Engine rendered a valid live Hermes CMO response/);
    assert.match(replaySource, /D_validator_rejected_valid_or_new_shape/);
    assert.match(replaySource, /A_request_context_missing/);
    assert.match(replaySource, /B_hermes_classification_or_answer_mismatch/);
    assert.match(replaySource, /C_hermes_invalid_or_boundary_rejected/);
    assert.match(replaySource, /D_cmo_engine_mapping_or_fallback/);

    console.log(
      JSON.stringify(
        {
          ok: true,
          flagOffHermesSelected: false,
          canaryHermesSelected: true,
          nonCanaryHermesSelected: false,
          mappedExistingChatShape: true,
          forbiddenCounterFallbackRequired: true,
          delegationsMode: "proposals_only",
          hermesWriteCounters: forbiddenZeroCounters,
        },
        null,
        2,
      ),
    );
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
} catch (error) {
  console.error(
    JSON.stringify(
      {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      },
      null,
      2,
    ),
  );
  process.exitCode = 1;
}
