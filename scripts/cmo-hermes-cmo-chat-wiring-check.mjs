import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
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

const readTraceFile = async (directory, suffix) => {
  const files = (await readdir(directory)).filter((file) => file.endsWith(`_${suffix}.json`)).sort();

  assert.ok(files.length > 0, `expected ${suffix} trace file in ${directory}`);

  return JSON.parse(await readFile(path.join(directory, files.at(-1)), "utf8"));
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
  const appRoutingIntentOut = path.join(tmpDir, "app-routing-intent.js");
  const routerOut = path.join(tmpDir, "hermes-cmo-chat-router.js");
  const mapperOut = path.join(tmpDir, "hermes-cmo-chat-mapper.js");
  const chatV11Out = path.join(tmpDir, "hermes-cmo-chat-v11.js");
  const sessionWorkingMemoryOut = path.join(tmpDir, "session-working-memory.js");

  await transpile(path.join(cmoDir, "config.ts"), configOut);
  await transpile(path.join(cmoDir, "app-routing-intent.ts"), appRoutingIntentOut);
  await transpile(path.join(cmoDir, "session-working-memory.ts"), sessionWorkingMemoryOut);
  await transpile(path.join(cmoDir, "hermes-cmo-chat-router.ts"), routerOut, (output) =>
    output
      .replace('require("@/lib/cmo/config")', 'require("./config.js")')
      .replace('require("@/lib/cmo/app-routing-intent")', 'require("./app-routing-intent.js")'),
  );
  await transpile(path.join(cmoDir, "hermes-cmo-chat-mapper.ts"), mapperOut);
  await transpile(path.join(cmoDir, "hermes-cmo-chat-v11.ts"), chatV11Out);

  const requireFromTmp = createRequire(routerOut);

  return {
    tmpDir,
    router: requireFromTmp(routerOut),
    mapper: requireFromTmp(mapperOut),
    chatV11: requireFromTmp(chatV11Out),
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
  const { tmpDir, router, mapper, chatV11 } = await loadCompiledModules();

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

    await withEnv(
      {
        CMO_HERMES_CMO_CHAT_V11_ENABLED: "true",
        CMO_HERMES_CMO_CHAT_V11_CANARY_APPS: "hold-pay",
        CMO_HERMES_CMO_CHAT_V11_FALLBACK_ENABLED: "true",
      },
      async () => {
        assert.equal(
          router.shouldUseHermesCmoChatV11("hold-pay"),
          true,
          "v1.1 canary flag is intentionally independent from legacy CMO_HERMES_CMO_CHAT_ENABLED",
        );

        const holdPayMarketResearch = router.resolveHermesCmoChatRoute({
          appId: "hold-pay",
          message: "Research the merchant payout API market and tell me where Hold Pay should focus.",
        });
        assert.equal(holdPayMarketResearch.endpoint, "/agents/cmo/chat", "Hold Pay normal market research must route to /agents/cmo/chat");
        assert.equal(holdPayMarketResearch.endpointKind, "agent_chat");

        const holdPayCasual = router.resolveHermesCmoChatRoute({
          appId: "hold-pay",
          message: "What should CMO do next for the Hold Pay onboarding funnel?",
        });
        assert.equal(holdPayCasual.endpoint, "/agents/cmo/chat", "Hold Pay casual canary chat must route to /agents/cmo/chat");
        assert.equal(holdPayCasual.endpointKind, "agent_chat");
        assert.equal(holdPayCasual.fallbackEnabled, true);

        const nonCanary = router.resolveHermesCmoChatRoute({
          appId: "holdstation-mini-app",
          message: "What should CMO do next?",
        });
        assert.equal(nonCanary.endpoint, "/agents/cmo/execute", "non-canary normal chat must route to deterministic /execute fallback");
        assert.equal(nonCanary.endpointKind, "execute");

        const sourceTool = router.resolveHermesCmoChatRoute({
          appId: "hold-pay",
          message: "Use the active source artifact to answer this.",
          hasSourceOrToolTask: true,
        });
        assert.equal(sourceTool.endpoint, "/agents/cmo/tool-execute", "explicit source/tool task must route to /tool-execute");
        assert.equal(sourceTool.endpointKind, "tool_execute");

        const surfResearchIntent = router.resolveHermesCmoChatRoute({
          appId: "hold-pay",
          message: "/surf Research merchant payout API positioning for Hold Pay",
        });
        assert.equal(surfResearchIntent.endpoint, "/agents/cmo/chat", "routeIntent surf_research must not override Hold Pay v1.1 canary chat");
        assert.equal(surfResearchIntent.endpointKind, "agent_chat");

        const forcedFallback = router.resolveHermesCmoChatRoute({
          appId: "hold-pay",
          message: "What should CMO do next?",
          forceFallback: true,
        });
        assert.equal(forcedFallback.endpoint, "/agents/cmo/execute", "forceFallback must route to /execute");
        assert.equal(forcedFallback.endpointKind, "execute");
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

    const chatV11Request = chatV11.buildHermesCmoChatV11Request({
      ...sampleTurnInput,
      sessionId: "session_h6",
      userMessageId: "msg_001",
      createdAt: "2026-05-28T11:00:00.000Z",
      userIdentity: {
        userId: "user_h6",
        userEmail: "jay@example.com",
      },
      sessionSummary: "Prior session summary: activation proof was the bottleneck.",
      sessionArtifacts: [{ type: "prior_artifact", artifact_id: "artifact_1", summary: "Prior artifact survives across turns." }],
      vaultContext: {
        schema_version: "cmo.vault_context_pack.runtime.v1",
        status: "completed",
        source_count: 1,
      },
    });
    assert.equal(chatV11Request.schema_version, "hermes.cmo.chat.request.v1_1");
    assert.equal(chatV11Request.tenant_id, "holdstation");
    assert.equal(chatV11Request.workspace_id, "holdstation-mini-app");
    assert.equal(chatV11Request.user_id, "user_h6");
    assert.equal(chatV11Request.intent.user_message, "Review activation plan.");
    assert.ok(Array.isArray(chatV11Request.messages) && chatV11Request.messages.length >= 2, "/chat request must include recent messages");
    assert.ok(chatV11Request.messages.length <= 20, "/chat request messages must be capped");
    assert.equal(chatV11Request.context_pack.session_summary.schema_version, "cmo.session_summary.v1");
    assert.match(chatV11Request.context_pack.session_summary.summary, /activation proof/);
    assert.deepEqual(chatV11Request.context_pack.session_summary.active_subjects, []);
    assert.deepEqual(chatV11Request.context_pack.session_summary.decisions, []);
    assert.deepEqual(chatV11Request.context_pack.session_summary.open_questions, []);
    assert.deepEqual(chatV11Request.context_pack.session_summary.comparison_sets, []);
    assert.deepEqual(chatV11Request.context_pack.session_summary.user_corrections, []);
    assert.deepEqual(chatV11Request.context_pack.session_summary.source_refs, []);
    assert.deepEqual(chatV11Request.context_pack.session_summary.artifact_refs, []);
    assert.deepEqual(chatV11Request.context_pack.session_summary.vault_refs, []);
    assert.ok(chatV11Request.context_pack.artifacts_in.some((artifact) => artifact.type === "prior_artifact"));
    assert.equal(chatV11Request.context_pack.vault_context.status, "completed");
    assert.equal(chatV11Request.options.mode, "cmo.normal_chat");
    assert.equal(chatV11Request.tool_policy.allow_vault_write, false);
    assert.equal(chatV11Request.tool_policy.allow_memory_mutation, false);
    assert.equal(chatV11Request.tool_policy.allow_surf_delegation, false);
    assert.equal(chatV11Request.tool_policy.read_web_allowed, true);
    assert.equal(chatV11Request.tool_policy.read_browser_allowed, true);

    const chatV11NullSummaryRequest = chatV11.buildHermesCmoChatV11Request({
      ...sampleTurnInput,
      history: [],
      sessionId: "session_empty_summary",
      userMessageId: "msg_empty_summary",
      createdAt: "2026-05-28T11:00:00.000Z",
      userIdentity: {
        userId: "user_h6",
        userEmail: "jay@example.com",
      },
      sessionSummary: undefined,
      sessionArtifacts: [],
      vaultContext: null,
    });
    assert.equal(chatV11NullSummaryRequest.context_pack.session_summary, null);

    const chatV11Mapped = chatV11.mapHermesCmoChatV11ToChatResult(chatV11Request, {
      schema_version: "hermes.cmo.chat.response.v1_1",
      mode: "cmo.chat",
      status: "completed",
      answer: { content: "Hermes chat v1.1 answer." },
      artifacts_out: [{ type: "analysis", artifact_id: "artifact_2", summary: "Stored in session only." }],
      suggested_session_summary_update: "CMO recommended tightening onboarding proof.",
      suggested_vault_updates: [{ type: "session_summary", statement: "Draft only; do not persist to Vault." }],
      vault_context_usage: { used: true, source_count: 1 },
      contract_warnings: ["artifact_refs_missing:using_artifacts_out_fallback"],
      artifacts_out_count: 1,
      artifact_refs_count: 2,
      decisions_count: 3,
      suggested_vault_updates_count: 1,
      state_contract: {
        schema_version: "cmo.chat.state_contract.v1",
        artifact_refs: ["artifact_2", "artifact_3"],
        decisions: ["Decision metadata only."],
        content: "This raw-looking field must not persist.",
      },
      side_effects: {
        vault_write: false,
        memory_mutation: false,
        gbrain_mutation: false,
        supabase_mutation: false,
        session_mutation: false,
        raw_capture: false,
        repo_mutation: false,
        publishing: false,
        knowledge_promotion: false,
        source_auto_save: false,
      },
    });
    assert.equal(chatV11Mapped.answer, "Hermes chat v1.1 answer.");
    assert.equal(chatV11Mapped.metadata.endpoint_kind, "agent_chat");
    assert.equal(chatV11Mapped.metadata.runtime_kind, "ai_agent");
    assert.equal(chatV11Mapped.metadata.requested_endpoint, "/agents/cmo/chat");
    assert.equal(chatV11Mapped.metadata.fallback_used, false);
    assert.equal(chatV11Mapped.metadata.side_effects.vault_write, false);
    assert.equal(chatV11Mapped.metadata.vault_context_usage.used, true);
    assert.deepEqual(chatV11Mapped.metadata.contract_warnings, ["artifact_refs_missing:using_artifacts_out_fallback"]);
    assert.equal(chatV11Mapped.metadata.contract_warnings_count, 1);
    assert.equal(chatV11Mapped.metadata.artifacts_out_count, 1);
    assert.equal(chatV11Mapped.metadata.artifact_refs_count, 2);
    assert.equal(chatV11Mapped.metadata.decisions_count, 3);
    assert.equal(chatV11Mapped.metadata.session_summary_update_present, true);
    assert.equal(chatV11Mapped.metadata.suggested_vault_updates_count, 1);
    assert.equal(chatV11Mapped.metadata.state_contract.schema_version, "cmo.chat.state_contract.v1");
    assert.equal(chatV11Mapped.metadata.state_contract.content, undefined, "state_contract raw content must not persist");

    const baseChatV11Response = {
      schema_version: "hermes.cmo.chat.response.v1_1",
      mode: "cmo.chat",
      status: "completed",
      answer: { content: "Accepted v1.1 response." },
      artifacts_out: [],
      suggested_vault_updates: [],
    };
    const fullSideEffectsFalse = chatV11.normalizeHermesCmoChatV11Response({
      ...baseChatV11Response,
      side_effects: {
        executed_echo: false,
        executed_surf: false,
        executed_vault_agent: false,
        vault_context_retrieval: false,
        vault_write: false,
        memory_mutation: false,
        gbrain_mutation: false,
        source_auto_save: false,
        knowledge_promotion: false,
        supabase_mutation: false,
        session_mutation: false,
        raw_capture: false,
        repo_mutation: false,
        kanban: false,
        openclaw: false,
        publishing: false,
      },
    }, chatV11Request);
    assert.equal(fullSideEffectsFalse.side_effects.vault_write, false, "full side_effects=false object must be accepted");
    assert.equal(fullSideEffectsFalse.side_effects.executed_surf, false);

    const partialLegacySideEffects = chatV11.normalizeHermesCmoChatV11Response({
      ...baseChatV11Response,
      side_effects: {
        vault_write: false,
        memory_mutation: false,
        supabase_mutation: false,
        session_mutation: false,
        raw_capture: false,
      },
    }, chatV11Request);
    assert.equal(partialLegacySideEffects.side_effects.gbrain_mutation, false, "missing gbrain_mutation must normalize to false");
    assert.equal(partialLegacySideEffects.side_effects.repo_mutation, false, "missing repo_mutation must normalize to false");
    assert.equal(partialLegacySideEffects.side_effects.source_auto_save, false, "missing source_auto_save must normalize to false");
    assert.equal(partialLegacySideEffects.side_effects.knowledge_promotion, false, "missing knowledge_promotion must normalize to false");

    const falseSideEffects = chatV11.normalizeHermesCmoChatV11Response({
      ...baseChatV11Response,
      side_effects: false,
    }, chatV11Request);
    assert.equal(falseSideEffects.side_effects.publishing, false, "side_effects=false must normalize to full false superset");

    const warningWithFalseSideEffects = chatV11.normalizeHermesCmoChatV11Response({
      ...baseChatV11Response,
      contract_warnings: [
        "artifact_refs_missing:using_artifacts_out_fallback",
        " ".repeat(4),
        "x".repeat(500),
      ],
      artifacts_out_count: 7,
      artifact_refs_count: 3,
      decisions_count: 2,
      suggested_vault_updates_count: 4,
      state_contract: {
        schema_version: "cmo.chat.state_contract.v1",
        artifact_refs: ["artifact_2"],
        decisions: ["Decision metadata only."],
        raw: "do not persist",
      },
      side_effects: false,
    }, chatV11Request);
    assert.notEqual(warningWithFalseSideEffects, "unsafe_response:side_effects", "warnings with side_effects=false must be accepted");
    assert.deepEqual(
      warningWithFalseSideEffects.contract_warnings.slice(0, 2),
      ["artifact_refs_missing:using_artifacts_out_fallback", `${"x".repeat(237)}...`],
      "contract warnings must be sanitized and capped as short strings",
    );
    assert.equal(warningWithFalseSideEffects.contract_warnings_count, 2);
    assert.equal(warningWithFalseSideEffects.artifacts_out_count, 7);
    assert.equal(warningWithFalseSideEffects.artifact_refs_count, 3);
    assert.equal(warningWithFalseSideEffects.decisions_count, 2);
    assert.equal(warningWithFalseSideEffects.suggested_vault_updates_count, 4);
    assert.equal(warningWithFalseSideEffects.state_contract.schema_version, "cmo.chat.state_contract.v1");
    assert.equal(warningWithFalseSideEffects.state_contract.raw, undefined, "unsafe state_contract keys must be omitted");

    const emptyWarnings = chatV11.normalizeHermesCmoChatV11Response({
      ...baseChatV11Response,
      contract_warnings: [],
      side_effects: false,
    }, chatV11Request);
    assert.deepEqual(emptyWarnings.contract_warnings, [], "empty contract_warnings must be accepted");
    assert.equal(emptyWarnings.contract_warnings_count, 0);

    const unsafeVaultWrite = chatV11.normalizeHermesCmoChatV11Response({
      ...baseChatV11Response,
      contract_warnings: ["warning must not hide unsafe mutation"],
      side_effects: {
        vault_write: true,
      },
    }, chatV11Request);
    assert.equal(unsafeVaultWrite, "unsafe_response:side_effects", "vault_write=true must be rejected");

    const unsafeSurfExecution = chatV11.normalizeHermesCmoChatV11Response({
      ...baseChatV11Response,
      side_effects: {
        executed_surf: true,
      },
    }, chatV11Request);
    assert.equal(unsafeSurfExecution, "unsafe_response:side_effects", "executed_surf=true must be rejected for v1.1 normal chat");

    const oldHermesResponse = chatV11.normalizeHermesCmoChatV11Response({
      schema_version: "hermes.cmo.response.v1",
      request_id: chatV11Request.request_id,
      session_id: chatV11Request.session_id,
      turn_id: chatV11Request.turn_id,
      status: "completed",
      answer: { content: "Old contract shape should not be accepted as /chat v1.1." },
      side_effects: false,
    }, chatV11Request);
    assert.equal(oldHermesResponse, "malformed_response:contract", "old hermes.cmo.response.v1 must not be accepted by /chat v1.1 normalizer");

    const mergedArtifacts = chatV11.mergeHermesCmoChatV11Artifacts(
      chatV11Request.context_pack.artifacts_in,
      chatV11Mapped.artifactsOut,
    );
    assert.ok(mergedArtifacts.some((artifact) => artifact.artifact_id === "artifact_2"), "artifacts_out must be storable in session");
    assert.match(
      chatV11.mergeHermesCmoChatV11SessionSummary("Existing summary.", chatV11Mapped.suggestedSessionSummaryUpdate),
      /tightening onboarding proof/,
      "suggested_session_summary_update must merge into Product-owned session_summary",
    );
    const mergedSummaryDelta = chatV11.mergeHermesCmoChatV11SessionSummary("Existing summary.", {
      summary_delta: "Hold Pay should compare payout API competitors.",
      decisions: ["Keep read-only Hermes chat for normal research."],
      open_questions: ["Which fiat rails are in scope?"],
      active_subjects: ["Hold Pay", "merchant payout API"],
      comparison_sets: ["Stripe Connect vs PayPal Payouts"],
      artifact_refs: ["artifact_2"],
      vault_refs: ["vault://hold-pay/positioning"],
    });
    assert.match(mergedSummaryDelta, /Hold Pay should compare payout API competitors/);
    assert.match(mergedSummaryDelta, /Decisions: Keep read-only Hermes chat for normal research/);
    assert.match(mergedSummaryDelta, /Open questions: Which fiat rails are in scope/);
    assert.match(mergedSummaryDelta, /Active subjects: Hold Pay; merchant payout API/);
    assert.match(mergedSummaryDelta, /Comparison sets: Stripe Connect vs PayPal Payouts/);
    assert.match(mergedSummaryDelta, /Artifact refs: artifact_2/);
    assert.match(mergedSummaryDelta, /Vault refs: vault:\/\/hold-pay\/positioning/);
    assert.equal(chatV11Mapped.suggestedVaultUpdates.length, 1, "suggested_vault_updates must remain draft/proposal data");

    const fallbackTrace = chatV11.fallbackHermesCmoChatV11Metadata(chatV11Request.request_id, "http_500");
    assert.equal(fallbackTrace.fallback_used, true);
    assert.equal(fallbackTrace.fallback_from, "/agents/cmo/chat");
    assert.equal(fallbackTrace.fallback_to, "/agents/cmo/execute");

    const chatV11RunInput = (overrides = {}) => ({
      ...sampleTurnInput,
      sessionId: "session_h6",
      userMessageId: "msg_trace_success",
      createdAt: "2026-05-28T11:00:00.000Z",
      userIdentity: {
        userId: "user_h6",
        userEmail: "jay@example.com",
      },
      sessionSummary: "Prior trace summary.",
      sessionArtifacts: [],
      vaultContext: null,
      ...overrides,
    });
    const originalFetch = globalThis.fetch;

    try {
      const successTraceDir = await mkdtemp(path.join(os.tmpdir(), "hermes-cmo-chat-v11-success-trace-"));

      try {
        await withEnv(
          {
            CMO_HERMES_BASE_URL: "https://hermes.test",
            CMO_HERMES_API_KEY: "trace-key",
            CMO_HERMES_CMO_TRACE_DIR: successTraceDir,
          },
          async () => {
            globalThis.fetch = async (url, init) => {
              assert.equal(url, "https://hermes.test/agents/cmo/chat");
              const body = JSON.parse(init.body);

              return new Response(JSON.stringify({
                schema_version: "hermes.cmo.chat.response.v1_1",
                mode: "cmo.chat",
                request_id: body.request_id,
                session_id: body.session_id,
                turn_id: body.turn_id,
                status: "completed",
                answer: { content: "Traced v1.1 success." },
                artifacts_out: [{ type: "trace_artifact", artifact_id: "trace_artifact_1", summary: "Trace artifact." }],
                suggested_session_summary_update: { summary_delta: "Trace summary delta." },
                suggested_vault_updates: [{ type: "draft", summary: "Draft only." }],
                vault_context_usage: { used: false },
                contract_warnings: ["state_contract_warning"],
                artifacts_out_count: 11,
                artifact_refs_count: 5,
                decisions_count: 4,
                suggested_vault_updates_count: 2,
                state_contract: {
                  schema_version: "cmo.chat.state_contract.v1",
                  artifact_refs: ["trace_artifact_1"],
                  raw: "must be omitted from state_contract summary",
                },
                raw_capture: {
                  body: "raw payload must not appear in trace",
                },
                content: "top-level content-like payload must be redacted",
                side_effects: {
                  executed_echo: false,
                  executed_surf: false,
                  executed_vault_agent: false,
                  vault_context_retrieval: false,
                  vault_write: false,
                  memory_mutation: false,
                  gbrain_mutation: false,
                  source_auto_save: false,
                  knowledge_promotion: false,
                  supabase_mutation: false,
                  session_mutation: false,
                  raw_capture: false,
                  repo_mutation: false,
                  kanban: false,
                  openclaw: false,
                  publishing: false,
                },
              }), { status: 200, headers: { "content-type": "application/json" } });
            };

            const result = await chatV11.runHermesCmoChatV11(chatV11RunInput());
            assert.equal(result.ok, true, "successful v1.1 run must return ok=true");
            assert.deepEqual(result.metadata.contract_warnings, ["state_contract_warning"]);
            assert.equal(result.metadata.contract_warnings_count, 1);
            assert.equal(result.metadata.artifacts_out_count, 11);
            assert.equal(result.metadata.artifact_refs_count, 5);
            assert.equal(result.metadata.decisions_count, 4);
            assert.equal(result.metadata.suggested_vault_updates_count, 2);
            assert.equal(result.metadata.state_contract.raw, undefined);

            const requestTrace = await readTraceFile(successTraceDir, "request");
            assert.equal(requestTrace.schema_version, "hermes.cmo.chat.request.v1_1");
            assert.equal(requestTrace.endpoint_kind, "agent_chat");
            assert.equal(requestTrace.runtime_kind, "ai_agent");
            assert.equal(requestTrace.requested_endpoint, "/agents/cmo/chat");
            assert.equal(requestTrace.request.schema_version, "hermes.cmo.chat.request.v1_1");
            assert.equal(requestTrace.request.intent.user_message, "Review activation plan.");
            assert.equal(requestTrace.side_effects.vault_write, false);
            assert.equal(requestTrace.artifacts_out_count, 0);
            assert.equal(requestTrace.session_summary_update_present, false);
            assert.equal(requestTrace.suggested_vault_updates_count, 0);

            const responseTrace = await readTraceFile(successTraceDir, "response");
            assert.equal(responseTrace.schema_version, "hermes.cmo.chat.request.v1_1");
            assert.equal(responseTrace.endpoint_kind, "agent_chat");
            assert.equal(responseTrace.runtime_kind, "ai_agent");
            assert.equal(responseTrace.requested_endpoint, "/agents/cmo/chat");
            assert.equal(responseTrace.fallback_used, false);
            assert.equal(responseTrace.side_effects.vault_write, false);
            assert.equal(responseTrace.side_effects.executed_surf, false);
            assert.equal(responseTrace.side_effects.raw_capture, false, "side_effects.raw_capture=false must remain a boolean in traces");
            assert.equal(responseTrace.response.side_effects.raw_capture, false, "nested response side_effects.raw_capture=false must remain a boolean");
            assert.equal(responseTrace.response.raw_capture, "[redacted]", "raw_capture payload outside side_effects must still be redacted");
            assert.equal(responseTrace.response.content, "[redacted]", "content-like fields outside side_effects must still be redacted");
            assert.deepEqual(responseTrace.contract_warnings, ["state_contract_warning"]);
            assert.equal(responseTrace.contract_warnings_count, 1);
            assert.equal(responseTrace.artifacts_out_count, 11);
            assert.equal(responseTrace.artifact_refs_count, 5);
            assert.equal(responseTrace.decisions_count, 4);
            assert.equal(responseTrace.session_summary_update_present, true);
            assert.equal(responseTrace.suggested_vault_updates_count, 2);
            assert.equal(responseTrace.state_contract.schema_version, "cmo.chat.state_contract.v1");
            assert.equal(responseTrace.state_contract.raw, undefined);
          },
        );
      } finally {
        await rm(successTraceDir, { recursive: true, force: true });
      }

      const fallbackTraceDir = await mkdtemp(path.join(os.tmpdir(), "hermes-cmo-chat-v11-fallback-trace-"));

      try {
        await withEnv(
          {
            CMO_HERMES_BASE_URL: "https://hermes.test",
            CMO_HERMES_API_KEY: "trace-key",
            CMO_HERMES_CMO_TRACE_DIR: fallbackTraceDir,
          },
          async () => {
            globalThis.fetch = async () =>
              new Response(JSON.stringify({ error: "Hermes crashed before answer." }), { status: 500, headers: { "content-type": "application/json" } });

            const result = await chatV11.runHermesCmoChatV11(chatV11RunInput({ userMessageId: "msg_trace_fallback" }));
            assert.equal(result.ok, false, "HTTP 500 v1.1 run must fail before fallback");
            assert.equal(result.fallbackEligible, true, "HTTP 500 v1.1 failure must be fallback eligible");

            const errorTrace = await readTraceFile(fallbackTraceDir, "error");
            assert.equal(errorTrace.schema_version, "hermes.cmo.chat.request.v1_1");
            assert.equal(errorTrace.endpoint_kind, "agent_chat");
            assert.equal(errorTrace.requested_endpoint, "/agents/cmo/chat");
            assert.equal(errorTrace.fallback_used, false);
            assert.equal(errorTrace.fallback_eligible, true);
            assert.match(errorTrace.fallback_reason, /^http_500/);
            assert.equal(errorTrace.side_effects.vault_write, false);
            assert.equal(errorTrace.artifacts_out_count, 0);
            assert.equal(errorTrace.session_summary_update_present, false);
            assert.equal(errorTrace.suggested_vault_updates_count, 0);

            await chatV11.writeHermesCmoChatV11FallbackTrace(result.request, {
              fallbackReason: result.fallbackReason,
              fallbackResponse: {
                schema_version: "hermes.cmo.response.v1",
                status: "completed",
                answer: { body: "Legacy /execute fallback answer." },
              },
              sideEffects: {
                vault_write: false,
                memory_mutation: false,
                gbrain_mutation: false,
                supabase_mutation: false,
                session_mutation: false,
                raw_capture: false,
                repo_mutation: false,
                publishing: false,
                knowledge_promotion: false,
                source_auto_save: false,
              },
            });

            const productFallbackTrace = await readTraceFile(fallbackTraceDir, "fallback");
            assert.equal(productFallbackTrace.fallback_used, true);
            assert.match(productFallbackTrace.fallback_reason, /^http_500/);
            assert.equal(productFallbackTrace.fallback_from, "/agents/cmo/chat");
            assert.equal(productFallbackTrace.fallback_to, "/agents/cmo/execute");
            assert.equal(productFallbackTrace.response.schema_version, "hermes.cmo.response.v1");
            assert.equal(productFallbackTrace.side_effects.vault_write, false);
          },
        );
      } finally {
        await rm(fallbackTraceDir, { recursive: true, force: true });
      }

      const noFallbackTraceDir = await mkdtemp(path.join(os.tmpdir(), "hermes-cmo-chat-v11-no-fallback-trace-"));

      try {
        await withEnv(
          {
            CMO_HERMES_BASE_URL: "https://hermes.test",
            CMO_HERMES_API_KEY: "trace-key",
            CMO_HERMES_CMO_TRACE_DIR: noFallbackTraceDir,
          },
          async () => {
            globalThis.fetch = async () =>
              new Response(JSON.stringify({ error: "Bad request." }), { status: 400, headers: { "content-type": "application/json" } });

            const result = await chatV11.runHermesCmoChatV11(chatV11RunInput({ userMessageId: "msg_trace_no_fallback" }));
            assert.equal(result.ok, false, "HTTP 400 v1.1 run must fail");
            assert.equal(result.fallbackEligible, false, "HTTP 400 v1.1 failure must not be fallback eligible");

            const errorTrace = await readTraceFile(noFallbackTraceDir, "error");
            assert.equal(errorTrace.schema_version, "hermes.cmo.chat.request.v1_1");
            assert.equal(errorTrace.endpoint_kind, "agent_chat");
            assert.equal(errorTrace.runtime_kind, "ai_agent");
            assert.equal(errorTrace.requested_endpoint, "/agents/cmo/chat");
            assert.equal(errorTrace.fallback_used, false);
            assert.equal(errorTrace.fallback_eligible, false);
            assert.match(errorTrace.fallback_reason, /^http_400/);
            assert.equal(errorTrace.side_effects.vault_write, false);
            assert.equal(errorTrace.artifacts_out_count, 0);
            assert.equal(errorTrace.session_summary_update_present, false);
            assert.equal(errorTrace.suggested_vault_updates_count, 0);

            const files = await readdir(noFallbackTraceDir);
            assert.equal(files.some((file) => file.endsWith("_fallback.json")), false, "no fallback trace should be written when fallback does not happen");
          },
        );
      } finally {
        await rm(noFallbackTraceDir, { recursive: true, force: true });
      }
    } finally {
      globalThis.fetch = originalFetch;
    }

    const researchFollowupInput = JSON.parse(JSON.stringify(sampleTurnInput));
    researchFollowupInput.message = "Ok lập bảng so 5 bên cho mình xem thử";
    researchFollowupInput.contextPackage.userMessage = researchFollowupInput.message;
    researchFollowupInput.contextPackage.sessionLocalResearchResults = [
      {
        type: "session_local_research_result",
        schema_version: "cmo.session_local_research_result.v1",
        tenant_id: "holdstation",
        workspace_id: "holdstation-mini-app",
        app_id: "holdstation-mini-app",
        user_id: "user_h6",
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
      userIdentity: {
        userId: "user_h6",
        userEmail: "jay@example.com",
      },
    });
    const researchArtifact = researchFollowupRequest.context_pack.artifacts_in.find((artifact) => artifact.type === "session_local_research_result");
    assert.ok(researchArtifact, "research follow-up must pass completed Surf result as session-local research artifact");
    assert.equal(researchArtifact.schema_version, "cmo.session_local_research_result.v1");
    assert.equal(researchArtifact.truth_status, "session_only");
    assert.equal(researchArtifact.saved_to_vault, false);
    assert.equal(researchArtifact.no_auto_promote, true);
    assert.equal(researchArtifact.artifact_id, "research_surf_competitors");
    assert.equal(researchArtifact.subject, "Holdstation Mini App");
    assert.deepEqual(researchArtifact.comparison_set, ["PayPal Payouts", "Stripe Connect"]);
    assert.equal(researchArtifact.scope_validated_by_product, true);
    assert.equal(researchFollowupRequest.context_pack.research_context.artifact_count, 1);
    assert.equal(researchFollowupRequest.context_pack.session_working_memory.schema_version, "cmo.session_working_memory.v1");
    assert.equal(researchFollowupRequest.context_pack.session_working_memory.scope_validated_by_product, true);
    assert.equal(researchFollowupRequest.context_pack.session_working_memory.active_contexts.length, 1);
    assert.equal(researchFollowupRequest.context_pack.session_working_memory.active_contexts[0].kind, "session_local_research_result");
    assert.equal(researchFollowupRequest.context_pack.session_working_memory.active_contexts[0].artifact_id, "research_surf_competitors");
    assert.equal(researchFollowupRequest.context_pack.session_working_memory.active_contexts[0].scope.validated_by_product, true);
    assert.equal(researchFollowupRequest.source_acquisition.research_followup_requested, undefined);
    assert.equal(researchFollowupRequest.source_acquisition.research_followup_has_session_artifact, true);
    assert.equal(researchFollowupRequest.source_acquisition.research_followup_missing_session_artifact, false);
    assert.equal(researchFollowupRequest.source_acquisition.research_followup_action, undefined);
    assert.equal(researchFollowupRequest.source_acquisition.active_context_kind, undefined);
    assert.equal(researchFollowupRequest.source_acquisition.should_call_surf, undefined);
    assert.equal(researchFollowupRequest.source_acquisition.scoped_session_research_artifact_available, true);
    assert.equal(researchFollowupRequest.source_acquisition.scope_validated_by_product, true);

    const advantageFollowupInput = JSON.parse(JSON.stringify(researchFollowupInput));
    advantageFollowupInput.message = "Hmmm vậy mình có lợi thế gì hơn so với 5 bên đó nhỉ";
    advantageFollowupInput.contextPackage.userMessage = advantageFollowupInput.message;
    const advantageFollowupRequest = mapper.mapCmoChatToHermesCmoRequest({
      ...advantageFollowupInput,
      sessionId: "session_h6",
      userMessageId: "msg_research_followup_advantage",
      createdAt: "2026-06-01T00:00:30.000Z",
      userIdentity: {
        userId: "user_h6",
        userEmail: "jay@example.com",
      },
    });
    assert.equal(advantageFollowupRequest.source_acquisition.research_followup_requested, undefined);
    assert.equal(advantageFollowupRequest.source_acquisition.research_followup_has_session_artifact, true);
    assert.equal(advantageFollowupRequest.source_acquisition.research_followup_action, undefined);
    assert.equal(advantageFollowupRequest.source_acquisition.active_context_kind, undefined);
    assert.equal(advantageFollowupRequest.source_acquisition.should_call_surf, undefined);
    assert.equal(advantageFollowupRequest.context_pack.session_working_memory.active_contexts[0].kind, "session_local_research_result");
    assert.ok(
      advantageFollowupRequest.context_pack.artifacts_in.some((artifact) => artifact.type === "session_local_research_result"),
      "semantic advantage follow-up must carry the scoped session-local research artifact for Hermes-owned resolution",
    );

    const scopeMismatchInput = JSON.parse(JSON.stringify(researchFollowupInput));
    scopeMismatchInput.contextPackage.sessionLocalResearchResults[0].user_id = "other_user";
    const scopeMismatchRequest = mapper.mapCmoChatToHermesCmoRequest({
      ...scopeMismatchInput,
      sessionId: "session_h6",
      userMessageId: "msg_research_followup_scope_mismatch",
      createdAt: "2026-06-01T00:00:45.000Z",
      userIdentity: {
        userId: "user_h6",
        userEmail: "jay@example.com",
      },
    });
    assert.equal(scopeMismatchRequest.source_acquisition.research_followup_requested, false);
    assert.equal(scopeMismatchRequest.source_acquisition.research_followup_has_session_artifact, false);
    assert.equal(scopeMismatchRequest.source_acquisition.research_followup_missing_session_artifact, true);
    assert.deepEqual(scopeMismatchRequest.context_pack.session_working_memory.active_contexts, []);
    assert.ok(
      !scopeMismatchRequest.context_pack.artifacts_in.some((artifact) => artifact.type === "session_local_research_result"),
      "scope-mismatched research artifacts must be dropped before Hermes",
    );

    const casualNativeInput = JSON.parse(JSON.stringify(researchFollowupInput));
    casualNativeInput.message = "Ok thanks bro";
    casualNativeInput.contextPackage.userMessage = casualNativeInput.message;
    const casualNativeRequest = mapper.mapCmoChatToHermesCmoRequest({
      ...casualNativeInput,
      sessionId: "session_h6",
      userMessageId: "msg_research_followup_native",
      createdAt: "2026-06-01T00:00:50.000Z",
      userIdentity: {
        userId: "user_h6",
        userEmail: "jay@example.com",
      },
    });
    assert.equal(casualNativeRequest.source_acquisition.research_followup_requested, undefined);
    assert.equal(casualNativeRequest.source_acquisition.active_context_kind, undefined);
    assert.equal(casualNativeRequest.source_acquisition.should_call_surf, undefined);
    assert.equal(casualNativeRequest.source_acquisition.research_followup_has_session_artifact, true);

    const newResearchInput = JSON.parse(JSON.stringify(researchFollowupInput));
    newResearchInput.message = "Tìm thêm 5 bên khác nữa đi";
    newResearchInput.contextPackage.userMessage = newResearchInput.message;
    const newResearchRequest = mapper.mapCmoChatToHermesCmoRequest({
      ...newResearchInput,
      sessionId: "session_h6",
      userMessageId: "msg_research_followup_new_research",
      createdAt: "2026-06-01T00:00:55.000Z",
      userIdentity: {
        userId: "user_h6",
        userEmail: "jay@example.com",
      },
    });
    assert.equal(newResearchRequest.source_acquisition.research_followup_requested, undefined);
    assert.equal(newResearchRequest.source_acquisition.active_context_kind, undefined);
    assert.equal(newResearchRequest.source_acquisition.should_call_surf, undefined);
    assert.equal(newResearchRequest.source_acquisition.research_followup_has_session_artifact, true);

    const sourceDocsInput = JSON.parse(JSON.stringify(researchFollowupInput));
    sourceDocsInput.message = "FAQ nói gì về KYC?";
    sourceDocsInput.contextPackage.userMessage = sourceDocsInput.message;
    const sourceDocsRequest = mapper.mapCmoChatToHermesCmoRequest({
      ...sourceDocsInput,
      sessionId: "session_h6",
      userMessageId: "msg_source_docs_question",
      createdAt: "2026-06-01T00:00:58.000Z",
      userIdentity: {
        userId: "user_h6",
        userEmail: "jay@example.com",
      },
    });
    assert.equal(sourceDocsRequest.source_acquisition.research_followup_requested, undefined);
    assert.equal(sourceDocsRequest.source_acquisition.active_context_kind, undefined);
    assert.equal(sourceDocsRequest.source_acquisition.should_call_surf, undefined);
    assert.equal(sourceDocsRequest.context_pack.source_answer_context.schema_version, "cmo.source_answer_context.v1");

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
    assert.equal(missingResearchRequest.source_acquisition.research_followup_requested, false);
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
          schema_version: "cmo.answer_basis.v1",
          mode: "session_research_artifact",
          missing_inputs: [],
          assumptions_used: [],
          user_can_override: true,
          suggested_user_inputs: [],
        },
        context_resolution: {
          schema_version: "cmo.context_resolution.v1",
          status: "resolved",
          semantic_intent: {
            primary: "research_followup",
            subtype: "advantage_differentiation",
            requires_surf: false,
          },
          used_live_surf: false,
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
    assert.equal(researchFollowupMapped.hermesCmoMetadata.context_resolution.status, "resolved");
    assert.equal(researchFollowupMapped.hermesCmoMetadata.context_resolution.semantic_intent.subtype, "advantage_differentiation");
    assert.equal(researchFollowupMapped.hermesCmoMetadata.answer_basis.mode, "session_research_artifact");
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
    assert.match(source, /resolveHermesCmoChatRoute\(\{/);
    assert.match(source, /const hermesCmoChatV11Requested = hermesCmoRoute\.endpointKind === "agent_chat"/);
    assert.match(source, /const hermesCmoLegacyRequested = legacyHermesCmoChatRequested \|\| hermesCmoRoute\.endpointKind === "tool_execute"/);
    assert.match(source, /shouldUseHermesCmoChat\(request\.appId\)/);
    assert.match(source, /runHermesCmoChatV11\(\{/);
    assert.match(source, /runHermesCmoRuntime\(hermesRequest\)/);
    assert.match(source, /const hermesFallbackRequest = mapCmoChatToHermesCmoRequest\(\{/);
    assert.match(source, /const hermesFallbackResult = await runHermesCmoRuntime\(hermesFallbackRequest\)/);
    assert.match(source, /answer = mappedHermesFallbackResult\.answer/);
    assert.match(source, /fallback_used: true/);
    assert.match(source, /fallback_from: fallbackTrace\.fallback_from/);
    assert.match(source, /fallback_to: fallbackTrace\.fallback_to/);
    assert.match(source, /writeHermesCmoChatV11FallbackTrace\(chatResult\.request/);
    assert.match(source, /answer = mappedChat\.answer/);
    assert.match(source, /answer = mappedHermesResult\.answer/);
    assert.match(source, /productRenderSource = "hermes_cmo"/);
    assert.match(source, /if \(!usedHermesCmoChat\)/);
    assert.match(source, /productRenderSource = hermesCmoChatRequested \? "fallback_after_hermes_failure"/);
    assert.match(source, /productFallbackReason = hermesCmoChatRequested/);
    assert.match(source, /durableSideEffectsSuppressed = hermesCmoChatV11Attempted/);
    assert.match(source, /skipped_hermes_cmo_chat_v11_no_auto_save/);
    assert.match(source, /skipped_hermes_cmo_chat_v11_no_supabase_mutation/);
    assert.match(source, /suggestedVaultUpdates/);
    assert.match(source, /mergeSuggestedVaultUpdates/);
    assert.match(source, /suggestedVaultUpdates = mergeSuggestedVaultUpdates\(suggestedVaultUpdates, mappedChat\.suggestedVaultUpdates\)/);
    assert.match(source, /cmo\.vault_update_approval\.v1/);
    assert.match(source, /updateSuggestedVaultUpdateReview/);
    assert.match(source, /source_endpoint: "\/agents\/cmo\/chat"/);
    assert.match(source, /vault_write_performed: false/);
    assert.match(source, /approval_events_count/);
    assert.match(source, /latest_approval_action/);
    assert.match(source, /MAX_SUGGESTED_VAULT_UPDATES_SESSION/);
    assert.match(source, /MAX_VAULT_UPDATE_APPROVAL_EVENTS/);
    assert.match(source, /MAX_VAULT_UPDATE_DRY_RUN_RESULTS/);
    assert.match(source, /MAX_VAULT_UPDATE_WRITE_RESULTS/);
    assert.match(source, /VAULT_AGENT_APPROVED_WRITE_DRY_RUN_ENDPOINT = "\/agents\/vault-agent\/approved-write-dry-run"/);
    assert.match(source, /VAULT_AGENT_APPROVED_WRITE_ENDPOINT = "\/agents\/vault-agent\/approved-write"/);
    assert.match(source, /getCmoHermesBaseUrl/);
    assert.match(source, /getCmoHermesApiKey/);
    assert.match(source, /getCmoHermesTimeoutMs/);
    assert.match(source, /candidate_key/);
    assert.match(source, /createHash\("sha256"\)/);
    assert.match(source, /truth_status: "draft"/);
    assert.match(source, /requires_user_or_product_approval: true/);
    assert.match(source, /vault_write_performed: false/);
    assert.doesNotMatch(source, /requires_user_or_product_approval:\s*value\.requires_user_or_product_approval/);
    assert.match(source, /review_status: action/);
    assert.match(source, /reviewed_update: reviewedUpdate/);
    assert.match(source, /action === "approved" \? \{ approved_update: reviewedUpdate \} : \{\}/);
    assert.match(source, /action === "rejected" \? \{ rejected_update: reviewedUpdate \} : \{\}/);
    assert.match(source, /action === "deferred" \? \{ deferred_update: reviewedUpdate \} : \{\}/);
    assert.doesNotMatch(source, /approved_update: approvedUpdate/);
    assert.match(source, /throw new Error\("Suggested Vault update candidate was not found\."\)/);
    assert.match(source, /runSuggestedVaultUpdateDryRun/);
    assert.match(source, /approvalEvent\.action !== "approved" \|\| approvalEvent\.review_status !== "approved"/);
    assert.match(source, /!approvalEvent\.approved_update/);
    assert.match(source, /callVaultAgentApprovedWriteDryRun/);
    assert.match(source, /approved-write-dry-run/);
    assert.match(source, /approvedUpdateSummaryForDryRun/);
    assert.match(source, /candidateString\(approvedUpdate, \["summary"\]/);
    assert.match(source, /candidateString\(approvedUpdate, \["decision"\]/);
    assert.match(source, /candidateString\(approvedUpdate, \["rationale"\]/);
    assert.match(source, /candidateString\(approvedUpdate, \["subject"\]/);
    assert.match(source, /candidateString\(approvedUpdate, \["title"\]/);
    assert.match(source, /candidateString\(approvedUpdate, \["name"\]/);
    assert.match(source, /\`\$\{decision\}\\n\\nRationale: \$\{rationale\}\`/);
    assert.match(source, /dryRunApprovalEventEnvelope/);
    assert.match(source, /\.\.\.approvalEvent\.approved_update/);
    assert.match(source, /const generatedSummary = approvedUpdateSummaryForDryRun\(approvalEvent\.approved_update\)/);
    assert.match(source, /const title = candidateString\(approvalEvent\.approved_update, \["title"\]/);
    assert.match(source, /const subject = candidateString\(approvalEvent\.approved_update, \["subject"\]/);
    assert.match(source, /const updateType = candidateString\(approvalEvent\.approved_update, \["type"\]/);
    assert.match(source, /const updateKind = candidateString\(approvalEvent\.approved_update, \["kind"\]/);
    assert.match(source, /\.\.\(!updateType && updateKind \? \{ type: updateKind \} : \{\}\)/);
    assert.match(source, /\.\.\(!updateKind && updateType \? \{ kind: updateType \} : \{\}\)/);
    assert.match(source, /\.\.\(generatedSummary \? \{ summary: generatedSummary \} : \{\}\)/);
    assert.match(source, /\.\.\(!subject && title \? \{ subject: title \} : \{\}\)/);
    assert.doesNotMatch(source, /summary: approvedUpdateSummaryForDryRun\(approvalEvent\.approved_update\)/);
    assert.match(source, /approval_payload_hash/);
    assert.match(source, /idempotency_key/);
    assert.match(source, /dry_run: true/);
    assert.match(source, /write_allowed: value\.write_allowed === true && errors\.length === 0/);
    assert.match(source, /target_preview/);
    assert.match(source, /frontmatter_preview/);
    assert.match(source, /body_preview/);
    assert.match(source, /unsafe_vault_write_performed/);
    assert.match(source, /value\.vault_write_performed !== undefined && value\.vault_write_performed !== false/);
    assert.match(source, /unsafe_side_effect:\$\{key\}/);
    assert.match(source, /"vault_write"/);
    assert.match(source, /dryRunConflictResult/);
    assert.match(source, /previous_approval_payload_hash/);
    assert.match(source, /latest_approval_payload_hash/);
    assert.match(source, /write_allowed: false/);
    assert.match(source, /vaultUpdateDryRunResults/);
    assert.match(source, /CmoVaultApprovedWriteResult/);
    assert.match(source, /normalizeVaultApprovedWriteResult/);
    assert.match(source, /item === false/);
    assert.match(source, /write_side_effects/);
    assert.match(source, /vault_agent\.approved_write_result\.v1/);
    assert.match(source, /callVaultAgentApprovedWrite/);
    assert.match(source, /runSuggestedVaultUpdateWrite/);
    assert.match(source, /writeRequestEnvelope/);
    assert.match(source, /expected_approval_payload_hash: dryRunResult\.approval_payload_hash/);
    assert.match(source, /dryRunResult\.write_allowed !== true/);
    assert.match(source, /dryRunResult\.vault_write_performed !== false/);
    assert.match(source, /!dryRunResult\.product_approval_payload_hash \|\| dryRunResult\.product_approval_payload_hash !== currentProductPayloadHash/);
    assert.match(source, /Approved Vault update requires a successful dry-run before write/);
    assert.match(source, /Approved Vault update dry-run is not write-eligible/);
    assert.match(source, /Only approved Vault update approval events can be written/);
    assert.match(source, /writeConflictResult/);
    assert.match(source, /approval_payload_hash_conflict/);
    assert.match(source, /vaultUpdateWriteResults/);
    assert.match(source, /write_results_count/);
    assert.match(source, /latest_write_status/);
    assert.match(source, /latest_write_approval_id/);
    assert.match(source, /latest_vault_path/);
    assert.match(source, /requested_endpoint: VAULT_AGENT_APPROVED_WRITE_ENDPOINT/);
    assert.match(source, /write_source_endpoint: "\/agents\/cmo\/chat"/);
    assert.match(source, /vault_agent_write: true/);
    assert.match(source, /write_side_effects: latest\.side_effects/);
    assert.doesNotMatch(source, /(?<!write_)side_effects: latest\.side_effects/);
    assert.match(source, /vault_write_performed: vaultWritePerformed/);
    assert.match(source, /receiptClaimsWrite && !vaultPath \? \["missing_vault_path"\]/);
    assert.match(source, /receiptClaimsWrite && !contentHash \? \["missing_content_hash"\]/);
    assert.match(source, /receiptClaimsWrite && Boolean\(vaultPath\) && Boolean\(contentHash\)/);
    assert.match(source, /key !== "vault_write"/);
    assert.match(source, /key !== "executed_vault_agent"/);
    assert.match(source, /const existingWriteSucceeded/);
    assert.match(source, /existingWrite\.vault_write_performed === true \|\| existingWrite\.deduped === true \|\| existingWrite\.status === "completed" \|\| existingWrite\.status === "deduped"/);
    assert.match(source, /dry_run_results_count/);
    assert.match(source, /latest_dry_run_status/);
    assert.match(source, /latest_dry_run_approval_id/);
    assert.match(source, /latest_dry_run_write_allowed/);
    assert.match(source, /writeVaultApprovedWriteDryRunTrace/);
    assert.match(source, /writeVaultApprovedWriteTrace/);
    assert.match(source, /sessionArtifacts/);
    assert.match(source, /mergeHermesCmoChatV11SessionSummary/);
    assert.match(source, /withSessionSourceRoutingMetadata/);
    assert.match(source, /fallbackContextPackage/);
    assert.match(source, /failed_then_existing_fallback/);
    assert.match(source, /guardrail_violation_then_existing_fallback/);
    assert.doesNotMatch(source, /Source Review:|What I Read|CMO Read/);

    const suggestedVaultReviewRouteSource = await readFile(
      path.join(rootDir, "src", "app", "api", "cmo", "sessions", "suggested-vault-updates", "review", "route.ts"),
      "utf8",
    );
    assert.match(suggestedVaultReviewRouteSource, /updateSuggestedVaultUpdateReview/);
    assert.match(suggestedVaultReviewRouteSource, /value === "approved" \|\| value === "rejected" \|\| value === "deferred"/);
    assert.match(suggestedVaultReviewRouteSource, /appId, sessionId, candidateKey, and action are required/);
    assert.doesNotMatch(suggestedVaultReviewRouteSource, /VaultAgent|runVaultAgent|autoCapture|save-to-vault|capture-save/);
    assert.doesNotMatch(suggestedVaultReviewRouteSource, /indexChat|Supabase|supabase|gbrain|memory_mutation|vault_write/);

    const suggestedVaultDryRunRouteSource = await readFile(
      path.join(rootDir, "src", "app", "api", "cmo", "sessions", "suggested-vault-updates", "dry-run", "route.ts"),
      "utf8",
    );
    assert.match(suggestedVaultDryRunRouteSource, /runSuggestedVaultUpdateDryRun/);
    assert.match(suggestedVaultDryRunRouteSource, /appId, sessionId, and approvalId are required/);
    assert.doesNotMatch(suggestedVaultDryRunRouteSource, /approved-write(?!-dry-run)|write-turn-log|write_remote|autoCapture|save-to-vault|capture-save/);
    assert.doesNotMatch(suggestedVaultDryRunRouteSource, /indexChat|Supabase|supabase|gbrain|memory_mutation|vault_write/);

    const suggestedVaultWriteRouteSource = await readFile(
      path.join(rootDir, "src", "app", "api", "cmo", "sessions", "suggested-vault-updates", "write", "route.ts"),
      "utf8",
    );
    assert.match(suggestedVaultWriteRouteSource, /runSuggestedVaultUpdateWrite/);
    assert.match(suggestedVaultWriteRouteSource, /appId, sessionId, and approvalId are required/);
    assert.doesNotMatch(suggestedVaultWriteRouteSource, /approved-write-dry-run|write-turn-log|write_remote|autoCapture|save-to-vault|capture-save/);
    assert.doesNotMatch(suggestedVaultWriteRouteSource, /indexChat|Supabase|supabase|gbrain|memory_mutation/);

    const cmoChatPanelSource = await readFile(path.join(rootDir, "src", "components", "cmo-apps", "cmo-chat-panel.tsx"), "utf8");
    assert.match(cmoChatPanelSource, /Suggested Vault Updates/);
    assert.match(cmoChatPanelSource, /Approve/);
    assert.match(cmoChatPanelSource, /Reject/);
    assert.match(cmoChatPanelSource, /Defer/);
    assert.match(cmoChatPanelSource, /Preview Vault Write/);
    assert.match(cmoChatPanelSource, /Write to Vault/);
    assert.match(cmoChatPanelSource, /Already written/);
    assert.match(cmoChatPanelSource, /writeVaultUpdate/);
    assert.match(cmoChatPanelSource, /\/api\/cmo\/sessions\/suggested-vault-updates\/write/);
    assert.match(cmoChatPanelSource, /\/api\/cmo\/sessions\/suggested-vault-updates\/review/);
    assert.match(cmoChatPanelSource, /\/api\/cmo\/sessions\/suggested-vault-updates\/dry-run/);
    assert.match(cmoChatPanelSource, /suggestedVaultUpdates: response\.suggestedVaultUpdates/);
    assert.match(cmoChatPanelSource, /vaultUpdateApprovalEvents: response\.vaultUpdateApprovalEvents/);
    assert.match(cmoChatPanelSource, /vaultUpdateDryRunResults: response\.vaultUpdateDryRunResults/);
    assert.match(cmoChatPanelSource, /vaultUpdateWriteResults: response\.vaultUpdateWriteResults/);
    assert.match(cmoChatPanelSource, /latestApprovedEventForCandidate/);
    assert.match(cmoChatPanelSource, /dryRunResultForApproval/);
    assert.match(cmoChatPanelSource, /writeResultForApproval/);
    assert.match(cmoChatPanelSource, /dryRunResult\.write_allowed === true/);
    assert.match(cmoChatPanelSource, /dryRunResult\.vault_write_performed === false/);
    assert.match(cmoChatPanelSource, /!writeResult\?\.conflict/);
    assert.match(cmoChatPanelSource, /target_preview/);
    assert.match(cmoChatPanelSource, /frontmatter_preview/);
    assert.match(cmoChatPanelSource, /body_preview/);
    assert.match(cmoChatPanelSource, /dry_run=true/);
    assert.match(cmoChatPanelSource, /vault_write_performed=false/);
    assert.match(cmoChatPanelSource, /const planAllowed = result\.write_allowed && !\(result\.errors\?\.length\)/);
    assert.match(cmoChatPanelSource, /write_allowed=\{String\(planAllowed\)\}/);
    assert.match(cmoChatPanelSource, /vault_path/);
    assert.match(cmoChatPanelSource, /content_hash/);
    assert.match(cmoChatPanelSource, /gbrain_index=false/);
    assert.match(cmoChatPanelSource, /promotion_performed=false/);
    assert.match(cmoChatPanelSource, /recordString\(candidate, \["kind", "type"\]\)/);
    assert.match(cmoChatPanelSource, /recordString\(candidate, \["subject", "title", "name"\]\)/);
    assert.match(cmoChatPanelSource, /recordString\(candidate, \["summary", "statement", "description"\]\)/);

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

    const hermesChatV11Source = await readFile(path.join(cmoDir, "hermes-cmo-chat-v11.ts"), "utf8");
    assert.match(hermesChatV11Source, /hermes-cmo-traces/);
    assert.match(hermesChatV11Source, /writeHermesCmoChatV11Trace\(request, "request"/);
    assert.match(hermesChatV11Source, /writeHermesCmoChatV11Trace\(request, "response"/);
    assert.match(hermesChatV11Source, /writeHermesCmoChatV11Trace\(request, "error"/);
    assert.match(hermesChatV11Source, /writeHermesCmoChatV11FallbackTrace/);

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
    assert.match(workspaceTypesSource, /sideEffects\?: false \| Record<string, false>/);
    assert.match(workspaceTypesSource, /side_effects\?: false \| Record<string, false>/);
    assert.match(workspaceTypesSource, /write_side_effects\?: false \| Record<string, boolean>/);
    assert.match(workspaceTypesSource, /requested_endpoint\?: string/);
    assert.match(workspaceTypesSource, /write_source_endpoint\?: "\/agents\/cmo\/chat"/);
    assert.match(workspaceTypesSource, /vault_agent_write\?: boolean/);
    assert.match(workspaceTypesSource, /review_status: CmoVaultUpdateReviewAction/);
    assert.match(workspaceTypesSource, /reviewed_update: Record<string, unknown>/);
    assert.match(workspaceTypesSource, /approved_update\?: Record<string, unknown>/);
    assert.match(workspaceTypesSource, /rejected_update\?: Record<string, unknown>/);
    assert.match(workspaceTypesSource, /deferred_update\?: Record<string, unknown>/);
    assert.match(workspaceTypesSource, /CmoVaultApprovedWriteDryRunResult/);
    assert.match(workspaceTypesSource, /schema_version: "vault_agent\.approved_write_dry_run\.v1"/);
    assert.match(workspaceTypesSource, /approval_payload_hash: string/);
    assert.match(workspaceTypesSource, /dry_run: true/);
    assert.match(workspaceTypesSource, /vault_write_performed: false/);
    assert.match(workspaceTypesSource, /vaultUpdateDryRunResults\?: CmoVaultApprovedWriteDryRunResult\[\]/);
    assert.match(workspaceTypesSource, /CmoVaultApprovedWriteResult/);
    assert.match(workspaceTypesSource, /schema_version: "vault_agent\.approved_write_result\.v1"/);
    assert.match(workspaceTypesSource, /vault_path\?: string/);
    assert.match(workspaceTypesSource, /content_hash\?: string/);
    assert.match(workspaceTypesSource, /deduped\?: boolean/);
    assert.match(workspaceTypesSource, /gbrain_index\?: false/);
    assert.match(workspaceTypesSource, /promotion_performed\?: false/);
    assert.match(workspaceTypesSource, /vaultUpdateWriteResults\?: CmoVaultApprovedWriteResult\[\]/);

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
