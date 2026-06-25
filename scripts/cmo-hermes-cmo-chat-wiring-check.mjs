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
  const outboundSanitizerOut = path.join(tmpDir, "hermes-outbound-payload-sanitizer.js");
  const creativeAgentOut = path.join(tmpDir, "creative-agent.js");
  const creativeDraftStateOut = path.join(tmpDir, "creative-draft-state.js");
  const sessionWorkingMemoryOut = path.join(tmpDir, "session-working-memory.js");
  const userMetadataOut = path.join(tmpDir, "user-metadata.js");

  await transpile(path.join(cmoDir, "config.ts"), configOut);
  await transpile(path.join(cmoDir, "app-routing-intent.ts"), appRoutingIntentOut);
  await transpile(path.join(cmoDir, "creative-draft-state.ts"), creativeDraftStateOut);
  await transpile(path.join(cmoDir, "creative-agent.ts"), creativeAgentOut);
  await transpile(path.join(cmoDir, "session-working-memory.ts"), sessionWorkingMemoryOut);
  await transpile(path.join(cmoDir, "user-metadata.ts"), userMetadataOut);
  await transpile(path.join(cmoDir, "hermes-outbound-payload-sanitizer.ts"), outboundSanitizerOut);
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
    outboundSanitizer: requireFromTmp(outboundSanitizerOut),
    creativeAgent: requireFromTmp(creativeAgentOut),
    creativeDraftState: requireFromTmp(creativeDraftStateOut),
    userMetadata: requireFromTmp(userMetadataOut),
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
  const { tmpDir, router, mapper, chatV11, outboundSanitizer, creativeAgent, creativeDraftState, userMetadata } = await loadCompiledModules();
  const rolloutWorkspaceIds = ["holdstation-mini-app", "aion", "feeback", "winance", "hold-pay", "holdstation-wallet"];
  let rollingReplaySmoke = null;
  let longSessionStressSmoke = null;
  let toolOrchestrationSmoke = null;
  let allWorkspaceToolChatRoutes = null;
  let runtimeUserIdentitySmoke = null;

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
        for (const appId of rolloutWorkspaceIds) {
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
        CMO_HERMES_CMO_CHAT_ENABLED: "true",
        CMO_HERMES_CMO_CANARY_APPS: "hold-pay",
        CMO_HERMES_CMO_TOOL_EXECUTE_ENABLED: "true",
        CMO_HERMES_CMO_CHAT_V11_ENABLED: "true",
        CMO_HERMES_CMO_CHAT_V11_CANARY_APPS: "hold-pay",
        CMO_HERMES_CMO_CHAT_V11_FALLBACK_ENABLED: "true",
        CMO_HERMES_CMO_TOOL_CHAT_ENABLED: "false",
        CMO_HERMES_CMO_TOOL_CHAT_CANARY_APPS: undefined,
      },
      async () => {
        assert.equal(
          router.shouldUseHermesCmoChatV11("hold-pay"),
          true,
          "v1.1 canary flag is intentionally independent from legacy CMO_HERMES_CMO_CHAT_ENABLED",
        );

        const normalChatWithoutToolCanary = router.resolveHermesCmoChatRoute({
          appId: "hold-pay",
          message: "Research the merchant payout API market and tell me where Hold Pay should focus.",
        });
        assert.equal(normalChatWithoutToolCanary.endpoint, "/agents/cmo/chat", "Hold Pay normal chat without tool-chat canary must route to /agents/cmo/chat");
        assert.equal(normalChatWithoutToolCanary.endpointKind, "agent_chat");

        const holdPayCasual = router.resolveHermesCmoChatRoute({
          appId: "hold-pay",
          message: "What should CMO do next for the Hold Pay onboarding funnel?",
        });
        assert.equal(holdPayCasual.endpoint, "/agents/cmo/chat", "Hold Pay casual canary chat must route to /agents/cmo/chat");
        assert.equal(holdPayCasual.endpointKind, "agent_chat");
        assert.equal(holdPayCasual.fallbackEnabled, true);

        const toolChatDisabledByDefault = router.resolveHermesCmoChatRoute({
          appId: "hold-pay",
          message: "Viết giúp mình 3 biến thể notification ngắn cho Hold Pay.",
        });
        assert.equal(toolChatDisabledByDefault.endpoint, "/agents/cmo/chat", "tool-chat route must stay disabled until its own flag is enabled");
        assert.equal(toolChatDisabledByDefault.reason, "v11_canary_chat");

        const creativeExecution = router.resolveHermesCmoChatRoute({
          appId: "hold-pay",
          message: "Generate a square PNG image for Hold Pay merchant onboarding.",
        });
        assert.equal(creativeExecution.endpoint, "/agents/cmo/execute", "Creative generation must route to the execution endpoint, not source-reader tool-execute");
        assert.equal(creativeExecution.endpointKind, "execute");
        assert.equal(creativeExecution.reason, "creative_execution");

        const activeCreativeState = {
          active_asset_id: "creative_uploaded_primary",
          drafts: [],
          assets: [{ asset_id: "creative_uploaded_primary" }],
        };
        const creativeReviewConversation = router.resolveHermesCmoChatRoute({
          appId: "hold-pay",
          message: "Critique the current visual for landing-page conversion, no image edits yet.",
          hasCreativeWorkingState: true,
          creativeWorkingState: activeCreativeState,
        });
        assert.equal(creativeReviewConversation.endpoint, "/agents/cmo/execute");
        assert.equal(creativeReviewConversation.reason, "creative_session");
        assert.equal(creativeReviewConversation.routeIntent, "creative_session");

        const creativePromptOnly = router.resolveHermesCmoChatRoute({
          appId: "hold-pay",
          message: "Write a stronger edit prompt for this direction only, do not generate a new image.",
          hasCreativeWorkingState: true,
          creativeWorkingState: activeCreativeState,
        });
        assert.equal(creativePromptOnly.reason, "creative_session");

        const creativeChannelAdvice = router.resolveHermesCmoChatRoute({
          appId: "hold-pay",
          message: "How should this same visual be used differently across web, social, and community channels?",
          hasCreativeWorkingState: true,
          creativeWorkingState: activeCreativeState,
        });
        assert.equal(creativeChannelAdvice.reason, "creative_session");

        const creativeAcknowledgement = router.resolveHermesCmoChatRoute({
          appId: "hold-pay",
          message: "Ok, keep it as-is for now.",
          hasCreativeWorkingState: true,
          creativeWorkingState: activeCreativeState,
        });
        assert.equal(creativeAcknowledgement.reason, "creative_session");

        const creativeExplicitEdit = router.resolveHermesCmoChatRoute({
          appId: "hold-pay",
          message: "Apply that stronger reward direction to the current image.",
          hasCreativeWorkingState: true,
          creativeWorkingState: activeCreativeState,
        });
        assert.equal(creativeExplicitEdit.reason, "creative_session");

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
        assert.equal(surfResearchIntent.endpoint, "/agents/cmo/chat", "routeIntent surf_research must stay on v1.1 chat until tool-chat canary is enabled");
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

    await withEnv(
      {
        CMO_HERMES_CMO_CHAT_V11_ENABLED: "true",
        CMO_HERMES_CMO_CHAT_V11_CANARY_APPS: "hold-pay",
        CMO_HERMES_CMO_TOOL_CHAT_ENABLED: "true",
        CMO_HERMES_CMO_TOOL_CHAT_CANARY_APPS: "hold-pay",
      },
      async () => {
        assert.equal(router.shouldUseHermesCmoToolChat("hold-pay"), true, "Hold Pay must be eligible for tool-capable CMO chat canary");
        assert.equal(router.shouldUseHermesCmoToolChat("aion"), false, "non-canary apps must not enter tool-capable CMO chat");

        const researchToolChat = router.resolveHermesCmoChatRoute({
          appId: "hold-pay",
          message: "So sánh giúp mình 3 tín hiệu thị trường gần đây liên quan đến cash-in/cash-out hoặc P2P UX.",
        });
        assert.equal(researchToolChat.endpoint, "/agents/cmo/tool-execute");
        assert.equal(researchToolChat.endpointKind, "tool_execute");
        assert.equal(researchToolChat.reason, "tool_chat_canary");

        const copyToolChat = router.resolveHermesCmoChatRoute({
          appId: "hold-pay",
          message: "Viết giúp mình 3 biến thể notification ngắn để onboarding merchant cho Hold Pay.",
        });
        assert.equal(copyToolChat.endpoint, "/agents/cmo/tool-execute");
        assert.equal(copyToolChat.endpointKind, "tool_execute");
        assert.equal(copyToolChat.reason, "tool_chat_canary");

        const creativeToolCanaryBypass = router.resolveHermesCmoChatRoute({
          appId: "hold-pay",
          message: "Create an image banner asset for Hold Pay onboarding.",
        });
        assert.equal(creativeToolCanaryBypass.endpoint, "/agents/cmo/execute");
        assert.equal(creativeToolCanaryBypass.endpointKind, "execute");
        assert.equal(creativeToolCanaryBypass.reason, "creative_execution");

        const strategyToolChat = router.resolveHermesCmoChatRoute({
          appId: "hold-pay",
          message: "Dựa trên bối cảnh hiện tại thôi, không cần kiểm chứng thị trường mới: Hold Pay nên ưu tiên merchant payout UX hay consumer P2P UX trước?",
        });
        assert.equal(strategyToolChat.endpoint, "/agents/cmo/tool-execute");
        assert.equal(strategyToolChat.endpointKind, "tool_execute");
        assert.equal(strategyToolChat.reason, "tool_chat_canary");

        const explicitSourceTool = router.resolveHermesCmoChatRoute({
          appId: "hold-pay",
          message: "Use the active source artifact to answer this.",
          hasSourceOrToolTask: true,
        });
        assert.equal(explicitSourceTool.endpoint, "/agents/cmo/tool-execute");
        assert.equal(explicitSourceTool.reason, "source_or_tool_task");

        const forcedFallback = router.resolveHermesCmoChatRoute({
          appId: "hold-pay",
          message: "What should CMO do next?",
          forceFallback: true,
        });
        assert.equal(forcedFallback.endpoint, "/agents/cmo/execute");
        assert.equal(forcedFallback.reason, "forced_fallback");

        const nonCanary = router.resolveHermesCmoChatRoute({
          appId: "aion",
          message: "Viết notification onboarding merchant.",
        });
        assert.equal(nonCanary.endpoint, "/agents/cmo/execute");
        assert.equal(nonCanary.reason, "v11_disabled_or_non_canary");
      },
    );

    await withEnv(
      {
        CMO_HERMES_CMO_CHAT_V11_ENABLED: "true",
        CMO_HERMES_CMO_CHAT_V11_CANARY_APPS: "*",
        CMO_HERMES_CMO_TOOL_CHAT_ENABLED: "true",
        CMO_HERMES_CMO_TOOL_CHAT_CANARY_APPS: "*",
      },
      async () => {
        allWorkspaceToolChatRoutes = {};
        for (const appId of rolloutWorkspaceIds) {
          assert.equal(router.shouldUseHermesCmoToolChat(appId), true, `tool-chat wildcard must enable ${appId}`);
          const route = router.resolveHermesCmoChatRoute({
            appId,
            message: "So sanh giup minh 3 tin hieu thi truong gan day va rut ra uu tien chien luoc.",
          });
          assert.equal(route.endpoint, "/agents/cmo/tool-execute", `${appId} must route to tool-capable CMO under wildcard rollout`);
          assert.equal(route.reason, "tool_chat_canary");
          allWorkspaceToolChatRoutes[appId] = route.endpoint;
        }
      },
    );

    await withEnv(
      {
        CMO_HERMES_CMO_CHAT_V11_ENABLED: "true",
        CMO_HERMES_CMO_CHAT_V11_CANARY_APPS: "*",
        CMO_HERMES_CMO_TOOL_CHAT_ENABLED: "false",
        CMO_HERMES_CMO_TOOL_CHAT_CANARY_APPS: "*",
      },
      async () => {
        const route = router.resolveHermesCmoChatRoute({
          appId: "aion",
          message: "Viet 3 bien the notification onboarding merchant.",
        });
        assert.equal(route.endpoint, "/agents/cmo/chat", "disabled tool-chat flag must keep normal v1.1 chat route");
        assert.equal(route.reason, "v11_canary_chat");
      },
    );

    await withEnv(
      {
        CMO_HERMES_CMO_CHAT_V11_ENABLED: "true",
        CMO_HERMES_CMO_CHAT_V11_CANARY_APPS: "*",
        CMO_HERMES_CMO_TOOL_CHAT_ENABLED: "true",
        CMO_HERMES_CMO_TOOL_CHAT_CANARY_APPS: "hold-pay",
      },
      async () => {
        const route = router.resolveHermesCmoChatRoute({
          appId: "aion",
          message: "Viet 3 bien the notification onboarding merchant.",
        });
        assert.equal(route.endpoint, "/agents/cmo/chat", "non-tool canary app must not route to /tool-execute");
        assert.equal(route.reason, "v11_canary_chat");
      },
    );

    const profileJayDisplayName = userMetadata.cmoRuntimeUserDisplayNameFromProfile({
      profileDisplayName: "Jay",
      email: "lequockhuong0601@gmail.com",
      userId: "04acf682-0067-4a8c-8a42-3520a30f8ccf",
    });
    assert.equal(profileJayDisplayName, "Jay");
    assert.equal(
      userMetadata.cmoRuntimeUserSlugFromProfile({
        profileDisplayName: profileJayDisplayName,
        email: "lequockhuong0601@gmail.com",
        userId: "04acf682-0067-4a8c-8a42-3520a30f8ccf",
      }),
      "jay",
      "profile display_name Jay must derive canonical user_slug jay",
    );

    const emailDerivedDisplayName = userMetadata.cmoRuntimeUserDisplayNameFromProfile({
      email: "alice@example.com",
      userId: "11111111-2222-4333-8444-555555555555",
    });
    assert.equal(emailDerivedDisplayName, "Alice");
    assert.equal(
      userMetadata.cmoRuntimeUserSlugFromProfile({
        profileDisplayName: emailDerivedDisplayName,
        email: "alice@example.com",
        userId: "11111111-2222-4333-8444-555555555555",
      }),
      "alice",
      "missing display_name with email alice@example.com must derive slug alice",
    );

    assert.equal(
      userMetadata.cmoRuntimeUserDisplayNameFromProfile({
        profileDisplayName: "alice@example.com",
        metadataDisplayName: "Alice Nguyen",
        email: "alice@example.com",
      }),
      "Alice Nguyen",
      "email-like profile display_name must be ignored in favor of safe metadata name",
    );
    assert.equal(
      userMetadata.cmoRuntimeUserDisplayNameFromProfile({
        userId: "04acf682-0067-4a8c-8a42-3520a30f8ccf",
      }),
      "User 04acf682",
      "missing profile/email must derive a safe display name from short UUID",
    );
    assert.equal(
      userMetadata.normalizeCmoRuntimeUserIdentity({
        authMode: "supabase",
        userId: "04acf682-0067-4a8c-8a42-3520a30f8ccf",
        userDisplayName: "Jay",
      }).user_slug,
      "jay-04acf682",
      "display-name-only runtime identity with user id must include short id suffix",
    );
    assert.equal(
      userMetadata.normalizeCmoRuntimeUserIdentity({
        authMode: "supabase",
        organizationId: "holdstation",
      }).user_slug,
      "unknown_user",
      "runtime identity must not fall back to organization/tenant/workspace names",
    );
    for (const workspaceId of rolloutWorkspaceIds) {
      const rawRuntimePath = userMetadata.buildCmoRuntimeUserPath({
        kind: "raw_activity",
        workspaceId,
        userIdentity: {
          authMode: "supabase",
          userId: "04acf682-0067-4a8c-8a42-3520a30f8ccf",
          userEmail: "lequockhuong0601@gmail.com",
          userDisplayName: "Jay",
          userSlug: "jay",
        },
        now: "2026-06-05T01:02:03.000Z",
      });
      assert.equal(rawRuntimePath, `90 Runtime/Raw Activity/${workspaceId}/jay/2026-06-05/`);
      assert.doesNotMatch(rawRuntimePath, /holdstation\/jay|user_jay|04acf682-0067-4a8c-8a42-3520a30f8ccf/);
    }
    runtimeUserIdentitySmoke = {
      profileJayDisplayName,
      profileJaySlug: "jay",
      emailDerivedDisplayName,
      emailDerivedSlug: "alice",
      duplicateDisplayNameFallbackSlug: "jay-04acf682",
      missingIdentitySlug: "unknown_user",
      rawRuntimePaths: Object.fromEntries(
        rolloutWorkspaceIds.map((workspaceId) => [
          workspaceId,
          userMetadata.buildCmoRuntimeUserPath({
            kind: "raw_activity",
            workspaceId,
            userIdentity: {
              authMode: "supabase",
              userId: "04acf682-0067-4a8c-8a42-3520a30f8ccf",
              userEmail: "lequockhuong0601@gmail.com",
              userDisplayName: "Jay",
              userSlug: "jay",
            },
            now: "2026-06-05T01:02:03.000Z",
          }),
        ]),
      ),
    };

    const hermesRequest = mapper.mapCmoChatToHermesCmoRequest({
      ...sampleTurnInput,
      sessionId: "session_h6",
      userMessageId: "msg_001",
      createdAt: "2026-05-28T11:00:00.000Z",
      userIdentity: {
        userId: "04acf682-0067-4a8c-8a42-3520a30f8ccf",
        userEmail: "jay@example.com",
        userDisplayName: "Jay",
        userSlug: "jay",
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

    const eggsMissingProjectContextItem = {
      id: "eggs-vault-project-context",
      kind: "project_context",
      title: "Accepted Project Context",
      source: {
        sourceId: "eggs-vault__eggs-vault",
        type: "vault_bundle",
        label: "12 Knowledge/Workspace Lessons/eggs-vault",
        path: "12 Knowledge/Workspace Lessons/eggs-vault",
      },
      inclusionReason: "Accepted workspace project context is included from the active workspace only.",
      exists: false,
      content: "",
      contentPreview: "No accepted project context found at 12 Knowledge/Workspace Lessons/eggs-vault.",
      contextQuality: "missing",
      tokenEstimate: 0,
      truncated: false,
      itemCount: 0,
    };
    const eggsMissingProjectContextRef = {
      id: "eggs-vault-project-context",
      title: "Accepted Project Context",
      path: "12 Knowledge/Workspace Lessons/eggs-vault",
      type: "vault_bundle",
      reason: "Accepted workspace project context is missing.",
      exists: false,
      contentPreview: "No accepted project context found at 12 Knowledge/Workspace Lessons/eggs-vault.",
      contextQuality: "missing",
    };
    const eggsContextQualitySummary = {
      selectedCount: 0,
      existingCount: 0,
      missingCount: 1,
      confirmedCount: 0,
      draftCount: 0,
      placeholderCount: 0,
      placeholderOrDraftCount: 0,
    };
    const eggsCreativeInput = JSON.parse(JSON.stringify(sampleTurnInput));
    eggsCreativeInput.message = "Tạo 1 key visual square PNG cho Eggs Vault, tone premium black/gold, futuristic, chỉ 1 variant.";
    eggsCreativeInput.request.workspaceId = "eggs-vault";
    eggsCreativeInput.request.appId = "eggs-vault";
    eggsCreativeInput.request.appName = "Eggs Vault";
    eggsCreativeInput.contextPack.workspaceId = "eggs-vault";
    eggsCreativeInput.contextPack.appId = "eggs-vault";
    eggsCreativeInput.contextPack.sourceId = "eggs-vault__eggs-vault";
    eggsCreativeInput.contextPack.items = [eggsMissingProjectContextItem];
    eggsCreativeInput.contextPack.contextQualitySummary = eggsContextQualitySummary;
    eggsCreativeInput.contextPackage.workspaceId = "eggs-vault";
    eggsCreativeInput.contextPackage.sourceId = "eggs-vault__eggs-vault";
    eggsCreativeInput.contextPackage.app.id = "eggs-vault";
    eggsCreativeInput.contextPackage.app.name = "Eggs Vault";
    eggsCreativeInput.contextPackage.selectedContext = [];
    eggsCreativeInput.contextPackage.missingContext = [eggsMissingProjectContextRef];
    eggsCreativeInput.contextPackage.contextQualitySummary = eggsContextQualitySummary;
    eggsCreativeInput.contextUsed = [];
    eggsCreativeInput.missingContext = [eggsMissingProjectContextRef];
    eggsCreativeInput.contextPackage.sessionLocalSources = [];
    eggsCreativeInput.contextPackage.activeSourceId = undefined;
    eggsCreativeInput.contextPackage.sourceReviewContext = undefined;
    eggsCreativeInput.contextPackage.sourceAnswerContext = undefined;
    const eggsCreativeRequest = mapper.mapCmoChatToHermesCmoRequest({
      ...eggsCreativeInput,
      sessionId: "session_eggs_creative",
      userMessageId: "msg_eggs_creative",
      createdAt: "2026-06-20T10:00:00.000Z",
      userIdentity: { userId: "user_eggs", userEmail: "jay@example.com" },
    });
    assert.equal(eggsCreativeRequest.intent.explicit_command, "creative.generate_image");
    assert.equal(eggsCreativeRequest.input.creative_execution_intent.direct_user_prompt_is_sufficient_execution_input, true);
    assert.equal(eggsCreativeRequest.input.creative_execution_intent.accepted_project_context_required, false);
    assert.equal(eggsCreativeRequest.constraints.missing_accepted_context_blocks_creative_execution, false);
    assert.equal(eggsCreativeRequest.tool_policy.missing_accepted_context_blocks_creative_execution, false);
    assert.equal(eggsCreativeRequest.context_pack.missing_context.length, 0);
    assert.equal(eggsCreativeRequest.context_pack.optional_context_gaps.length, 1);
    assert.equal(eggsCreativeRequest.context_pack.context_quality_summary.creative_execution_direct_prompt_sufficient, true);
    assert.match(JSON.stringify(eggsCreativeRequest.input.creative_execution_intent.factual_claim_guardrails), /Do not invent unsupported product mechanics/);
    assert.doesNotMatch(JSON.stringify(eggsCreativeRequest), /No accepted project context found at 12 Knowledge\/Workspace Lessons\/eggs-vault/);

    const eggsStrategyInput = JSON.parse(JSON.stringify(eggsCreativeInput));
    eggsStrategyInput.message = "What should Eggs Vault strategy prioritize this week?";
    const eggsStrategyRequest = mapper.mapCmoChatToHermesCmoRequest({
      ...eggsStrategyInput,
      sessionId: "session_eggs_strategy",
      userMessageId: "msg_eggs_strategy",
      createdAt: "2026-06-20T10:01:00.000Z",
      userIdentity: { userId: "user_eggs", userEmail: "jay@example.com" },
    });
    assert.equal(eggsStrategyRequest.intent.explicit_command, null);
    assert.match(JSON.stringify(eggsStrategyRequest), /No accepted project context found at 12 Knowledge\/Workspace Lessons\/eggs-vault/);

    const creativeReferenceInput = JSON.parse(JSON.stringify(sampleTurnInput));
    creativeReferenceInput.message = "Make the current image brighter but keep composition.";
    creativeReferenceInput.request.workspaceId = "eggs-vault";
    creativeReferenceInput.request.appId = "eggs-vault";
    creativeReferenceInput.request.appName = "Eggs Vault";
    creativeReferenceInput.contextPackage.workspaceId = "eggs-vault";
    creativeReferenceInput.contextPackage.app.id = "eggs-vault";
    creativeReferenceInput.contextPackage.app.name = "Eggs Vault";
    const creativeReferenceRequest = mapper.mapCmoChatToHermesCmoRequest({
      ...creativeReferenceInput,
      sessionId: "session_eggs_creative_reference",
      userMessageId: "msg_eggs_creative_reference",
      createdAt: "2026-06-20T10:02:00.000Z",
      userIdentity: { userId: "user_eggs", userEmail: "jay@example.com" },
      creativeWorkingState: {
        active_draft_id: "draft_eggs_reference",
        active_asset_id: "creative_uploaded_primary",
        drafts: [
          {
            draft_id: "draft_eggs_reference",
            kind: "image",
            prompt: "Make the current image brighter but keep composition.",
            status: "draft",
          },
        ],
        assets: [
          {
            asset_id: "creative_uploaded_primary",
            kind: "image",
            status: "stored",
            mime_type: "image/png",
            bytes: 123456,
            sha256: "abababababababababababababababababababababababababababababababab",
            width: 1536,
            height: 864,
            format: "16:9",
            visual_summary: "Premium black landing hero with teal reward focal point.",
            visual_inspection: {
              status: "success",
              summary: "The hero image is readable and has one clear focal point.",
              composition: "Centered product object with CTA-side negative space.",
              palette: "Black, teal, white.",
              text_readability: "Short labels remain legible.",
              crop_channel_fit: {
                landing: "Safe for 16:9 landing hero.",
                x_post: "Keep CTA away from the right edge.",
                telegram: "Readable in square preview.",
              },
              defects: [],
            },
            dominant_palette: ["#020617", "#14b8a6", "#f8fafc"],
            detected_text: ["OPEN"],
            safe_crop_notes: { landing: "Keep the product centered." },
            render_url: "https://gestlbswqvibztqcidis.supabase.co/storage/v1/object/sign/cmo-creative-assets/path.png?token=redacted",
          },
        ],
      },
      creativeSessionFollowupDetected: true,
      activeCreativeAssetResolutionSource: "creativeWorkingState",
    });
    assert.equal(creativeReferenceRequest.intent.explicit_command, null, "CMO-native creative sessions must not force explicit Creative generation");
    assert.equal(creativeReferenceRequest.creativeSession, true);
    assert.equal(creativeReferenceRequest.cmoOwnsCreativeDecision, true);
    assert.equal(creativeReferenceRequest.creativeDecisionOwnerWhenLive, "hermes_cmo");
    assert.equal(creativeReferenceRequest.reference_assets.length, 1);
    assert.equal(creativeReferenceRequest.referenceAssets.length, 1);
    assert.equal(creativeReferenceRequest.reference_assets[0].asset_id, "creative_uploaded_primary");
    assert.equal(creativeReferenceRequest.reference_assets[0].kind, "image");
    assert.equal(creativeReferenceRequest.reference_assets[0].role, "source_image");
    assert.equal(creativeReferenceRequest.reference_assets[0].mime_type, "image/png");
    assert.equal(creativeReferenceRequest.reference_assets[0].sha256, "abababababababababababababababababababababababababababababababab");
    assert.equal(creativeReferenceRequest.reference_assets[0].bytes, 123456);
    assert.equal(creativeReferenceRequest.reference_assets[0].width, 1536);
    assert.equal(creativeReferenceRequest.reference_assets[0].height, 864);
    assert.equal(
      creativeReferenceRequest.reference_assets[0].fetch_url,
      "https://cmo.jayju.cloud/api/cmo/apps/eggs-vault/creative/assets/creative_uploaded_primary/download",
    );
    assert.equal(creativeReferenceRequest.reference_assets[0].fetchUrl, creativeReferenceRequest.reference_assets[0].fetch_url);
    assert.equal(creativeReferenceRequest.referenceAssets[0].assetId, "creative_uploaded_primary");
    assert.equal(creativeReferenceRequest.referenceAssets[0].mimeType, "image/png");
    assert.equal(creativeReferenceRequest.referenceAssets[0].authRef, "cmo_creative_artifact_read_key");
    assert.equal(creativeReferenceRequest.referenceAssets[0].authHeader, "x-cmo-creative-artifact-key");
    assert.equal(creativeReferenceRequest.reference_assets[0].auth_ref, "cmo_creative_artifact_read_key");
    assert.equal(creativeReferenceRequest.reference_assets[0].auth_header, "x-cmo-creative-artifact-key");
    assert.equal(creativeReferenceRequest.creative_working_state.active_asset_id, "creative_uploaded_primary");
    assert.equal(creativeReferenceRequest.creative_working_state.assets[0].asset_id, "creative_uploaded_primary");
    assert.equal(creativeReferenceRequest.creative_working_state.assets[0].visual_inspection.status, "success");
    assert.equal(creativeReferenceRequest.creative_working_state.assets[0].width, 1536);
    assert.equal(creativeReferenceRequest.creative_working_state.assets[0].height, 864);
    assert.equal(creativeReferenceRequest.creativeWorkingState.activeAssetId, "creative_uploaded_primary");
    assert.equal(creativeReferenceRequest.creativeWorkingState.assets[0].visualInspection.crop_channel_fit.x_post, "Keep CTA away from the right edge.");
    assert.equal(creativeReferenceRequest.creativeWorkingState.assets[0].width, 1536);
    assert.equal(creativeReferenceRequest.creativeWorkingState.assets[0].height, 864);
    assert.doesNotMatch(JSON.stringify(creativeReferenceRequest.reference_assets), /CMO_CREATIVE_ARTIFACT_READ_KEY|token=redacted|\/tmp|\[hermes_local_artifact_path_redacted\]/);
    assert.doesNotMatch(creativeReferenceRequest.reference_assets[0].fetch_url, /storage\/v1\/object\/sign/, "Primary fetch URL must not be a Supabase signed URL");

    const hermesPostGenerationResponse = {
      schema_version: "hermes.cmo.response.v1",
      status: "completed",
      answer_basis: { mode: "creative_execution" },
      answer: {
        format: "markdown",
        title: "Creative Asset",
        summary: "Generated campaign hero.",
        decision: "",
        body: "Generated campaign hero.",
      },
      creative_assets: [
        {
          asset_id: "creative_asset_visual_post_qa",
          kind: "image",
          status: "stored",
          mime_type: "image/png",
          transport_status: "uploaded",
          render_url: "https://product.example/assets/post-generation.png",
          sha256: "cdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcd",
          bytes: 222333,
          width: 1536,
          height: 864,
          format: "16:9",
          visual_summary: "Generated hero with clear teal reward accent.",
          visual_inspection: {
            status: "success",
            summary: "Post-generation QA found no visible defects.",
            composition: "Single focal point with uncluttered edges.",
            palette: "Black, teal, white.",
            text_readability: "Readable at campaign preview size.",
            crop_channel_fit: {
              landing: "Fits 16:9 landing crop.",
              x_post: "Crop around center focal point.",
              telegram: "Square crop keeps the egg visible.",
            },
            defects: [],
          },
          dominant_palette: ["#020617", "#14b8a6"],
          detected_text: ["OPEN"],
          safe_crop_notes: { x_post: "Keep product away from left edge." },
        },
      ],
    };
    const postGenerationArtifacts = creativeAgent.extractCreativeAssetsFromHermesResponse(hermesPostGenerationResponse, {
      tenantId: "tenant_eggs",
      workspaceId: "eggs-vault",
      appId: "eggs-vault",
      jobId: "creative_msg_visual_post_qa",
      createdAt: "2026-06-20T10:02:30.000Z",
    });
    assert.equal(postGenerationArtifacts[0].visual_inspection.status, "success", "Hermes post-generation visual inspection must stay on the returned creative asset");
    assert.equal(postGenerationArtifacts[0].width, 1536, "Hermes post-generation width must stay on the returned creative asset");
    assert.equal(postGenerationArtifacts[0].height, 864, "Hermes post-generation height must stay on the returned creative asset");
    const postGenerationState = creativeDraftState.applyCreativeAssetStateUpdate(undefined, postGenerationArtifacts);
    assert.equal(postGenerationState.assets[0].visual_inspection.summary, "Post-generation QA found no visible defects.", "Product session state must store Hermes visual inspection");
    const postGenerationReplayRequest = mapper.mapCmoChatToHermesCmoRequest({
      ...creativeReferenceInput,
      sessionId: "session_eggs_creative_post_generation_replay",
      userMessageId: "msg_eggs_creative_post_generation_replay",
      createdAt: "2026-06-20T10:02:45.000Z",
      userIdentity: { userId: "user_eggs", userEmail: "jay@example.com" },
      message: "Review the generated hero for channel fit.",
      creativeWorkingState: postGenerationState,
      creativeSessionFollowupDetected: true,
      activeCreativeAssetResolutionSource: "creativeWorkingState",
    });
    assert.equal(postGenerationReplayRequest.creative_working_state.assets[0].visual_inspection.summary, "Post-generation QA found no visible defects.", "Next Hermes request must replay visual inspection in creative_working_state");
    assert.equal(postGenerationReplayRequest.creative_working_state.assets[0].width, 1536, "Next Hermes request must replay post-generation width");
    assert.equal(postGenerationReplayRequest.creative_working_state.assets[0].height, 864, "Next Hermes request must replay post-generation height");
    assert.equal(postGenerationReplayRequest.reference_assets[0].fetch_url, "https://cmo.jayju.cloud/api/cmo/apps/eggs-vault/creative/assets/creative_asset_visual_post_qa/download", "Post-generation replay must keep Product S2S fetch URL primary");

    const activeAssetUrlFallbackRequest = mapper.mapCmoChatToHermesCmoRequest({
      ...creativeReferenceInput,
      sessionId: "session_eggs_creative_url_fallback",
      userMessageId: "msg_eggs_creative_url_fallback",
      createdAt: "2026-06-20T10:02:50.000Z",
      userIdentity: { userId: "user_eggs", userEmail: "jay@example.com" },
      message: "Review this active creative asset.",
      creativeWorkingState: {
        active_asset_id: "creative_asset_video_fallback",
        drafts: [],
        assets: [
          {
            asset_id: "creative_asset_video_fallback",
            kind: "video",
            status: "stored",
            mime_type: "video/mp4",
            transport_status: "uploaded",
            fetch_url: "https://product.example/api/cmo/apps/eggs-vault/creative/assets/creative_asset_video_fallback/download",
            render_url: "https://product.example/assets/video-fallback.mp4",
            signed_url: "https://product.example/assets/video-fallback.mp4?token=placeholder",
            sha256: "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
            bytes: 987654,
          },
        ],
      },
      creativeSessionFollowupDetected: true,
      activeCreativeAssetResolutionSource: "creativeWorkingState",
    });
    assert.equal((activeAssetUrlFallbackRequest.reference_assets ?? []).length, 0, "non-image active assets should not get source_image reference_assets");
    assert.equal(activeAssetUrlFallbackRequest.creative_working_state.assets[0].fetch_url, "https://product.example/api/cmo/apps/eggs-vault/creative/assets/creative_asset_video_fallback/download");
    assert.equal(activeAssetUrlFallbackRequest.creative_working_state.assets[0].render_url, "https://product.example/assets/video-fallback.mp4");
    assert.equal(activeAssetUrlFallbackRequest.creativeWorkingState.assets[0].fetchUrl, "https://product.example/api/cmo/apps/eggs-vault/creative/assets/creative_asset_video_fallback/download");

    const creativeConversationInput = {
      ...creativeReferenceInput,
      creativeWorkingState: creativeReferenceRequest.creative_working_state,
      creativeSessionFollowupDetected: true,
      activeCreativeAssetResolutionSource: "creativeWorkingState",
      sessionId: "session_eggs_creative_review",
      userMessageId: "msg_eggs_creative_review",
      createdAt: "2026-06-20T10:03:00.000Z",
      userIdentity: { userId: "user_eggs", userEmail: "jay@example.com" },
    };
    const creativeReviewRequest = mapper.mapCmoChatToHermesCmoRequest({
      ...creativeConversationInput,
      message: "Review the current visual if we use it as a campaign hero; what are the biggest marketing risks?",
    });
    assert.equal(creativeReviewRequest.intent.creative_conversation_only, true);
    assert.equal(creativeReviewRequest.intent.creative_followup_intent_class, "asset_review");
    assert.equal(creativeReviewRequest.intent.execution_allowed, false);
    assert.equal(creativeReviewRequest.intent.mutation_allowed, false);
    assert.equal(creativeReviewRequest.intent.draft_update_allowed, false);
    assert.equal(creativeReviewRequest.intent.expected_response, "text");
    assert.equal(creativeReviewRequest.constraints.execution_allowed, false);
    assert.equal(creativeReviewRequest.constraints.expected_response, "text");
    assert.equal(creativeReviewRequest.constraints.creative_side_effects_allowed, false);
    assert.equal(creativeReviewRequest.constraints.creative_mutation_permitted_this_turn, false);
    assert.equal(creativeReviewRequest.tool_policy.creative_execution_may_be_requested_by_cmo, false);
    assert.equal(creativeReviewRequest.tool_policy.execution_allowed, false);
    assert.equal(creativeReviewRequest.tool_policy.creative_side_effects_allowed, false);
    assert.equal(creativeReviewRequest.capabilities.creative.canExecuteImageGeneration, false);
    assert.equal(creativeReviewRequest.capabilities.creative.canUpdateDraftState, false);
    assert.equal(creativeReviewRequest.capabilities.creative.canProposeDraft, false);
    assert.equal(creativeReviewRequest.reference_assets[0].asset_id, "creative_uploaded_primary");

    const creativeReviewWithUseAsRequest = mapper.mapCmoChatToHermesCmoRequest({
      ...creativeConversationInput,
      sessionId: "session_eggs_creative_review_use_as",
      userMessageId: "msg_eggs_creative_review_use_as",
      message: "Review visual nay neu dung lam landing hero: rui ro marketing lon nhat la gi?",
    });
    assert.equal(creativeReviewWithUseAsRequest.intent.creative_followup_intent_class, "asset_review");
    assert.equal(creativeReviewWithUseAsRequest.intent.execution_allowed, false);
    assert.equal(creativeReviewWithUseAsRequest.intent.mutation_allowed, false);

    const creativePromptOnlyRequest = mapper.mapCmoChatToHermesCmoRequest({
      ...creativeConversationInput,
      sessionId: "session_eggs_creative_prompt_only",
      userMessageId: "msg_eggs_creative_prompt_only",
      message: "Write a stronger edit prompt for this direction only, do not generate a new image.",
    });
    assert.equal(creativePromptOnlyRequest.intent.creative_prompt_proposal_only, true);
    assert.equal(creativePromptOnlyRequest.intent.creative_followup_intent_class, "prompt_proposal");
    assert.equal(creativePromptOnlyRequest.intent.execution_allowed, false);
    assert.equal(creativePromptOnlyRequest.intent.draft_update_allowed, false);
    assert.equal(creativePromptOnlyRequest.intent.expected_response, "text_prompt");
    assert.equal(creativePromptOnlyRequest.intent.creative_no_execute_modifier_detected, true);
    assert.equal(creativePromptOnlyRequest.constraints.creative_side_effects_allowed, false);
    assert.equal(creativePromptOnlyRequest.constraints.execution_allowed, false);
    assert.equal(creativePromptOnlyRequest.constraints.expected_response, "text_prompt");

    const creativeChannelAdviceRequest = mapper.mapCmoChatToHermesCmoRequest({
      ...creativeConversationInput,
      sessionId: "session_eggs_creative_channel_advice",
      userMessageId: "msg_eggs_creative_channel_advice",
      message: "Cung visual nay neu dung lam landing page, X post, va Telegram community announcement thi angle nen khac nhau the nao?",
    });
    assert.equal(creativeChannelAdviceRequest.intent.creative_conversation_only, true);
    assert.equal(creativeChannelAdviceRequest.intent.creative_followup_intent_class, "channel_advisory");
    assert.equal(creativeChannelAdviceRequest.intent.execution_allowed, false);
    assert.equal(creativeChannelAdviceRequest.intent.expected_response, "text");
    assert.equal(creativeChannelAdviceRequest.constraints.creative_side_effects_allowed, false);
    assert.equal(creativeChannelAdviceRequest.constraints.execution_allowed, false);

    const creativeAckRequest = mapper.mapCmoChatToHermesCmoRequest({
      ...creativeConversationInput,
      sessionId: "session_eggs_creative_ack",
      userMessageId: "msg_eggs_creative_ack",
      message: "Ok, keep it as-is for now.",
    });
    assert.equal(creativeAckRequest.intent.creative_noop_acknowledgement, true);
    assert.equal(creativeAckRequest.intent.creative_followup_intent_class, "ack_noop");
    assert.equal(creativeAckRequest.intent.execution_allowed, false);
    assert.equal(creativeAckRequest.intent.draft_update_allowed, false);
    assert.equal(creativeAckRequest.intent.expected_response, "native_ack");
    assert.equal(creativeAckRequest.constraints.creative_side_effects_allowed, false);
    assert.equal(creativeAckRequest.constraints.execution_allowed, false);

    const creativeEditRequest = mapper.mapCmoChatToHermesCmoRequest({
      ...creativeConversationInput,
      sessionId: "session_eggs_creative_edit",
      userMessageId: "msg_eggs_creative_edit",
      message: "Apply that stronger reward direction to the current image.",
    });
    assert.equal(creativeEditRequest.intent.creative_mutation_requested, true);
    assert.equal(creativeEditRequest.intent.creative_followup_intent_class, "explicit_mutation");
    assert.equal(creativeEditRequest.intent.execution_allowed, true);
    assert.equal(creativeEditRequest.intent.mutation_allowed, true);
    assert.equal(creativeEditRequest.intent.expected_response, "asset");
    assert.equal(creativeEditRequest.constraints.creative_side_effects_allowed, true);
    assert.equal(creativeEditRequest.constraints.execution_allowed, true);
    assert.equal(creativeEditRequest.tool_policy.creative_execution_may_be_requested_by_cmo, true);
    assert.equal(creativeEditRequest.capabilities.creative.canExecuteImageGeneration, true);

    const outboundReplayPollutionPattern =
      /\[hermes_local_artifact_path_redacted\]|hermes_local_artifact_path_redacted|\.png_redact|\/(?:tmp|Users|home|var|mnt|private|Volumes)\b|(?:^|[^A-Za-z0-9])[A-Za-z]:[\\/]|conversion_h_|creative-agent-images|cmo-creative-execute|Creative image asset Refine|redacted (?:prompt|brief|content|answer)|(?:prompt|brief|content|answer) redacted/i;
    const pollutedReplayRequest = mapper.mapCmoChatToHermesCmoRequest({
      ...creativeConversationInput,
      sessionId: "session_eggs_creative_polluted_replay",
      userMessageId: "msg_eggs_creative_polluted_replay",
      message: "Use the clean prompt direction now for the current image.",
      contextPackage: {
        ...creativeConversationInput.contextPackage,
        selectedContext: [
          {
            ...creativeConversationInput.contextPackage.selectedContext[0],
            content: "[hermes_local_artifact_path_redacted]/brand_identity_notes.md.png_redact",
            qualityReason: "redacted content from a prior Creative trace",
          },
        ],
        contextPack: {
          ...creativeConversationInput.contextPackage.contextPack,
          items: [
            {
              ...creativeConversationInput.contextPackage.contextPack.items[0],
              content: "[hermes_local_artifact_path_redacted]/brand_identity_context.md.png_redact",
              contentPreview: "Creative image asset Refine the existing generated asset with machine-wrapper context.",
            },
            {
              ...creativeConversationInput.contextPackage.contextPack.items[1],
              content: "Clean activation context should survive.",
              contentPreview: "Clean activation context should survive.",
            },
          ],
        },
      },
      contextUsed: [
        {
          ...creativeConversationInput.contextUsed[0],
          contentPreview: "[hermes_local_artifact_path_redacted]/context_used_preview.png_redact",
        },
      ],
      missingContext: [
        {
          id: "dirty_missing_context",
          title: "Missing Creative Context",
          path: "[hermes_local_artifact_path_redacted]/missing_context.md",
          type: "vault_note",
          exists: false,
          contentPreview: "/home/cmo/creative-agent-images/missing_context.png_redact",
          contextQuality: "missing",
          qualityReason: "redacted answer from prior trace",
        },
      ],
      history: [
        ...creativeConversationInput.history,
        {
          id: "assistant_redacted_path",
          role: "assistant",
          content: "[hermes_local_artifact_path_redacted]/accent_teal_quanh_egg_v_CTA_area._x.png_redact",
          createdAt: "2026-06-20T10:04:00.000Z",
        },
        {
          id: "assistant_machine_wrapper",
          role: "assistant",
          content: "Creative image asset Refine the existing generated asset with brand_identity details.",
          createdAt: "2026-06-20T10:05:00.000Z",
        },
        {
          id: "assistant_product_block",
          role: "assistant",
          content: "Product blocked this Creative follow-up because old workspace/session context still contains redacted artifact text.",
          createdAt: "2026-06-20T10:05:30.000Z",
          hermesCmoMetadata: {
            product_outbound_payload_blocked: true,
          },
        },
        {
          id: "assistant_blank_ack",
          role: "assistant",
          content: " ",
          createdAt: "2026-06-20T10:05:45.000Z",
          hermesCmoMetadata: {
            creative_noop_acknowledgement: true,
          },
        },
        {
          id: "assistant_dirty_decision",
          role: "assistant",
          content: "Review: keep the composition clean and add only one sharper reward focal point.",
          createdAt: "2026-06-20T10:05:50.000Z",
          creativeDecision: {
            action: "present_draft",
            answer: "[hermes_local_artifact_path_redacted]/redacted_answer.png_redact",
          },
        },
        {
          id: "assistant_clean_prompt",
          role: "assistant",
          content: "Prompt proposal: add a subtle teal reward glow around the crystal egg while keeping the premium clean background.",
          createdAt: "2026-06-20T10:06:00.000Z",
        },
      ],
      creativeWorkingState: {
        ...creativeConversationInput.creativeWorkingState,
        active_draft_id: "draft_dirty",
        drafts: [
          {
            draft_id: "draft_dirty",
            kind: "image",
            title: "[hermes_local_artifact_path_redacted]/brand_identity_title",
            brief: "Creative image asset Refine the existing generated asset with machine wrapper text.",
            prompt: "[hermes_local_artifact_path_redacted]/accent_teal_prompt.png_redact",
            negative_prompt: "/tmp/local_negative_prompt.txt",
            format: "16:9",
          },
        ],
        assets: [
          {
            asset_id: "creative_asset_req_h6_msg_polluted_001",
            kind: "image",
            mime_type: "image/png",
            status: "stored",
            transport_status: "uploaded",
            storage_path: "apps/eggs/creative_asset_req_h6_msg_polluted_001.png",
            prompt: "[hermes_local_artifact_path_redacted]/asset_prompt",
            visual_summary: "Creative image asset Refine the existing generated asset wrapper.",
          },
        ],
      },
    });
    const pollutedReplayJson = JSON.stringify({
      messages: pollutedReplayRequest.messages,
      selected_context: pollutedReplayRequest.context_pack.selected_context,
      recent_session_summary: pollutedReplayRequest.context_pack.recent_session_summary,
      all_context_items: pollutedReplayRequest.context_pack.all_context_items,
      missing_context: pollutedReplayRequest.context_pack.missing_context,
      context_used: pollutedReplayRequest.context_pack.context_used,
      creative_working_state: pollutedReplayRequest.creative_working_state,
      creativeWorkingState: pollutedReplayRequest.creativeWorkingState,
    });
    assert.doesNotMatch(pollutedReplayJson, outboundReplayPollutionPattern);
    assert.doesNotMatch(JSON.stringify(pollutedReplayRequest), outboundReplayPollutionPattern);
    assert.ok(pollutedReplayRequest.messages.some((message) => message.role === "assistant" && message.content.includes("Prompt proposal: add a subtle teal reward glow")));
    assert.ok(
      pollutedReplayRequest.context_pack.all_context_items.some((item) => item.content === "Clean activation context should survive."),
      "Clean context item content must remain available after dirty replay fields are removed",
    );
    assert.equal(pollutedReplayRequest.reference_assets[0].auth_ref, "cmo_creative_artifact_read_key");

    const multiTurnCreativeHygieneRequest = mapper.mapCmoChatToHermesCmoRequest({
      ...creativeConversationInput,
      sessionId: "session_eggs_creative_hygiene_sequence",
      userMessageId: "msg_eggs_creative_hygiene_sequence",
      message: "Given the latest prompt proposal and channel advice, what should we do next?",
      history: [
        {
          id: "assistant_create_asset",
          role: "assistant",
          content: "Creative image asset Refine the existing generated asset with /tmp/cmo-creative-execute/conversion_h_001/render.png_redact",
          createdAt: "2026-06-20T10:00:00.000Z",
        },
        {
          id: "user_review",
          role: "user",
          content: "Review this visual from a marketing angle.",
          createdAt: "2026-06-20T10:01:00.000Z",
        },
        {
          id: "assistant_review",
          role: "assistant",
          content: "Review: the clean premium direction is usable, but the reward signal needs one sharper focal accent.",
          createdAt: "2026-06-20T10:02:00.000Z",
        },
        {
          id: "user_prompt",
          role: "user",
          content: "Write a stronger prompt proposal only.",
          createdAt: "2026-06-20T10:03:00.000Z",
        },
        {
          id: "assistant_prompt",
          role: "assistant",
          content: "Prompt proposal: keep the premium black background, add a single teal reward glow, and sharpen the CTA-side contrast.",
          createdAt: "2026-06-20T10:04:00.000Z",
        },
        {
          id: "user_channel",
          role: "user",
          content: "How should this vary across landing, social, and community?",
          createdAt: "2026-06-20T10:05:00.000Z",
        },
        {
          id: "assistant_channel",
          role: "assistant",
          content: "Channel advice: landing should emphasize trust, social should emphasize the reward hook, and community should invite feedback.",
          createdAt: "2026-06-20T10:06:00.000Z",
        },
        {
          id: "assistant_contract_violation",
          role: "assistant",
          content: "Creative contract violation: Product blocked execution.",
          createdAt: "2026-06-20T10:07:00.000Z",
          hermesCmoMetadata: {
            product_contract_violation: true,
          },
        },
      ],
    });
    assert.doesNotMatch(JSON.stringify(multiTurnCreativeHygieneRequest), outboundReplayPollutionPattern);
    assert.ok(
      multiTurnCreativeHygieneRequest.messages.some((message) => message.content.includes("Prompt proposal: keep the premium black background")),
      "Prompt proposal text should stay replayable when it is clean",
    );
    assert.ok(
      multiTurnCreativeHygieneRequest.messages.some((message) => message.content.includes("Channel advice: landing should emphasize trust")),
      "Channel advice should stay replayable when it is clean",
    );
    assert.ok(
      !multiTurnCreativeHygieneRequest.messages.some((message) => /contract violation|Creative image asset/i.test(message.content)),
      "Machine-wrapper and Product-local failure turns must not pollute future replay",
    );

    const outboundForbiddenValuePattern =
      /(\[hermes_local_artifact_path_redacted\]|hermes_local_artifact_path_redacted|file:|\/(?:tmp|Users|home|var|mnt|private|Volumes)\/|(?:^|[^A-Za-z0-9])[A-Za-z]:[\\/]|conversion_h_|creative-agent-images|cmo-creative-execute|\.(?:png_redact|png|jpe?g|webp|mp4|webm)(?:\b|_|$))/i;
    const collectForbiddenStringValues = (value, fields = [], pathParts = []) => {
      if (typeof value === "string") {
        if (outboundForbiddenValuePattern.test(value)) {
          fields.push(pathParts.join("."));
        }
        return fields;
      }

      if (Array.isArray(value)) {
        value.forEach((item, index) => collectForbiddenStringValues(item, fields, [...pathParts, String(index)]));
        return fields;
      }

      if (value && typeof value === "object") {
        Object.entries(value).forEach(([key, item]) => collectForbiddenStringValues(item, fields, [...pathParts, key]));
      }

      return fields;
    };
    const pollutedCreativeRequest = JSON.parse(JSON.stringify(creativeReferenceRequest));
    pollutedCreativeRequest.messages = [
      {
        role: "assistant",
        content: "[hermes_local_artifact_path_redacted]/_crystal_egg_21x9.png_redact",
        message_id: "assistant_polluted",
        created_at: "2026-06-20T10:01:00.000Z",
      },
      {
        role: "user",
        content: "Nhìn hướng này có bị hiền quá không?",
        message_id: "user_followup",
        created_at: "2026-06-20T10:02:00.000Z",
      },
    ];
    pollutedCreativeRequest.context_pack.selected_context = [
      {
        content: "file:///private/cmo/pearl_m_t_qu_tr_ng.txt",
        full_content: "/tmp/cmo-creative-execute/conversion_h_123/reference_assets/image.jpg",
      },
    ];
    pollutedCreativeRequest.context_pack.recent_session_summary =
      "assistant: [hermes_local_artifact_path_redacted]/accent_teal_quanh_egg_v_CTA_area.png";
    pollutedCreativeRequest.context_pack.all_context_items = [
      {
        content: "[hermes_local_artifact_path_redacted]/Content_Notes.md_Quality_missing.png_redact",
        contentPreview: "/home/cmo/creative-agent-images/card.jpeg",
      },
      {
        content: "C:\\cmo-creative-execute\\conversion_h_123\\local.webp",
        contentPreview: "/var/tmp/cmo-creative-execute/card.png_redact",
      },
    ];
    pollutedCreativeRequest.context_pack.missing_context = [
      {
        contentPreview: "missing context points at /mnt/data/cmo-creative-execute/output.webp",
      },
    ];
    pollutedCreativeRequest.context_pack.context_used = [
      {
        contentPreview: "local preview [hermes_local_artifact_path_redacted]/codex-imagen-123.png_redact",
      },
    ];
    pollutedCreativeRequest.creative_working_state.assets[0].preview_url = "[hermes_local_artifact_path_redacted]/preview.png_redact";
    pollutedCreativeRequest.creative_working_state.assets[0].signed_url = "/tmp/cmo-creative-execute/signed.png";
    pollutedCreativeRequest.creativeWorkingState.assets[0].renderUrl = "[hermes_local_artifact_path_redacted]/render.png";
    pollutedCreativeRequest.creativeWorkingState.assets[0].signedUrl = "/Users/admin/creative-agent-images/signed.webp";
    pollutedCreativeRequest.input.creative_working_state.assets[0].render_url = "[hermes_local_artifact_path_redacted]/nested.png";
    pollutedCreativeRequest.context_pack.creative_working_state.assets[0].render_url = "[hermes_local_artifact_path_redacted]/context.png";
    pollutedCreativeRequest.reference_assets[0].preview_url = "[hermes_local_artifact_path_redacted]/reference-preview.png";
    pollutedCreativeRequest.referenceAssets[0].renderUrl = "/tmp/cmo-creative-execute/reference-render.jpg";
    const sanitizedCreativeRequest = outboundSanitizer.sanitizeOutboundHermesPayload(pollutedCreativeRequest, { creativeRoute: true });
    assert.equal(sanitizedCreativeRequest.diagnostics.outbound_hermes_payload_sanitized, true);
    assert.equal(sanitizedCreativeRequest.diagnostics.outbound_hermes_payload_path_like_blocked, false);
    assert.ok(sanitizedCreativeRequest.diagnostics.outbound_sanitized_field_count >= 12);
    assert.equal(sanitizedCreativeRequest.diagnostics.workspace_fallback_suppressed_for_creative, true);
    assert.ok(
      sanitizedCreativeRequest.diagnostics.outbound_sanitized_fields_preview.includes("messages.0.content"),
      "Sanitizer diagnostics must show polluted assistant message content was sanitized",
    );
    assert.ok(
      sanitizedCreativeRequest.diagnostics.outbound_sanitized_fields_preview.includes("context_pack.selected_context.0.content"),
      "Sanitizer diagnostics must show selected context content was sanitized",
    );
    assert.ok(
      sanitizedCreativeRequest.diagnostics.outbound_sanitized_fields_preview.includes("context_pack.recent_session_summary"),
      "Sanitizer diagnostics must show recent session summary was sanitized",
    );
    assert.deepEqual(collectForbiddenStringValues(sanitizedCreativeRequest.payload), []);
    assert.equal(
      sanitizedCreativeRequest.payload.messages[0].content,
      "Creative asset was generated or updated. Use active asset metadata and reference_assets for visual context.",
    );
    assert.equal(sanitizedCreativeRequest.payload.creative_working_state.assets[0].preview_url, null);
    assert.equal(sanitizedCreativeRequest.payload.creative_working_state.assets[0].signed_url, null);
    assert.equal(sanitizedCreativeRequest.payload.creativeWorkingState.assets[0].renderUrl, null);
    assert.equal(sanitizedCreativeRequest.payload.creativeWorkingState.assets[0].signedUrl, null);
    assert.equal(sanitizedCreativeRequest.payload.input.creative_working_state.assets[0].render_url, null);
    assert.equal(sanitizedCreativeRequest.payload.context_pack.creative_working_state.assets[0].render_url, null);
    assert.equal(sanitizedCreativeRequest.payload.reference_assets[0].preview_url, null);
    assert.equal(sanitizedCreativeRequest.payload.referenceAssets[0].renderUrl, null);
    assert.equal(
      sanitizedCreativeRequest.payload.reference_assets[0].fetch_url,
      "https://cmo.jayju.cloud/api/cmo/apps/eggs-vault/creative/assets/creative_uploaded_primary/download",
    );
    assert.equal(sanitizedCreativeRequest.payload.reference_assets[0].auth_ref, "cmo_creative_artifact_read_key");
    assert.equal(sanitizedCreativeRequest.payload.referenceAssets[0].authHeader, "x-cmo-creative-artifact-key");

    const chatV11Request = chatV11.buildHermesCmoChatV11Request({
      ...sampleTurnInput,
      sessionId: "session_h6",
      userMessageId: "msg_001",
      createdAt: "2026-05-28T11:00:00.000Z",
      userIdentity: {
        userId: "04acf682-0067-4a8c-8a42-3520a30f8ccf",
        userEmail: "jay@example.com",
        userDisplayName: "Jay",
        userSlug: "jay",
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
    assert.equal(chatV11Request.user_id, "04acf682-0067-4a8c-8a42-3520a30f8ccf");
    assert.equal(chatV11Request.user_slug, "jay");
    assert.equal(chatV11Request.user_display_name, "Jay");
    assert.equal(chatV11Request.email, "jay@example.com");
    assert.equal(chatV11Request.intent.user_message, "Review activation plan.");
    assert.ok(Array.isArray(chatV11Request.messages) && chatV11Request.messages.length >= 2, "/chat request must include recent messages");
    assert.ok(chatV11Request.messages.length <= 20, "/chat request messages must be capped");
    assert.equal(chatV11Request.context_pack.session_summary.schema_version, "cmo.session_summary.v1");
    assert.match(chatV11Request.context_pack.session_summary.summary, /activation proof/);
    assert.deepEqual(chatV11Request.context_pack.session_summary.active_subjects, []);
    assert.deepEqual(chatV11Request.context_pack.session_summary.decisions, []);
    assert.deepEqual(chatV11Request.context_pack.session_summary.open_questions, []);
    assert.deepEqual(chatV11Request.context_pack.session_summary.comparison_sets, []);
    assert.deepEqual(chatV11Request.context_pack.session_summary.corrections, []);
    assert.deepEqual(chatV11Request.context_pack.session_summary.superseded_items, []);
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
      user_visible: {
        answer: "User-visible answer without storage internals.",
        semantic_state: { save_state: "needs_review" },
        vault_internals_hidden: true,
      },
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
    assert.equal(chatV11Mapped.answer, "User-visible answer without storage internals.");
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

    const chatV11MappedWithoutUserVisible = chatV11.mapHermesCmoChatV11ToChatResult(chatV11Request, {
      schema_version: "hermes.cmo.chat.response.v1_1",
      mode: "cmo.chat",
      status: "completed",
      answer: { content: "Fallback answer content." },
      artifacts_out: [],
      suggested_vault_updates: [],
      contract_warnings: [],
      contract_warnings_count: 0,
      artifacts_out_count: 0,
      artifact_refs_count: 0,
      decisions_count: 0,
      suggested_vault_updates_count: 0,
      side_effects: chatV11Mapped.metadata.side_effects,
    });
    assert.equal(chatV11MappedWithoutUserVisible.answer, "Fallback answer content.");

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
    assert.equal(unsafeVaultWrite, "unsafe_response:side_effects", "vault_write=true without raw_activity_log must be rejected");

    const safeRawRuntimeLogReceipt = {
      schema_version: "vault_agent.raw_activity_log_result.v1",
      status: "completed",
      raw_activity_logged: true,
      vault_write_performed: true,
      vault_path: "90 Runtime/Raw Activity/hold-pay/jay/2026-06-04/turn.json",
      side_effects: {
        vault_write: true,
        raw_runtime_write: true,
        knowledge_write: false,
        accepted_knowledge_write: false,
        gbrain_mutation: false,
        knowledge_promotion: false,
        source_auto_save: false,
        memory_mutation: false,
        supabase_mutation: false,
      },
    };
    const safeRawRuntimeLogging = chatV11.normalizeHermesCmoChatV11Response({
      ...baseChatV11Response,
      raw_activity_log: safeRawRuntimeLogReceipt,
      side_effects: {
        vault_write: true,
        raw_capture: true,
      },
    }, chatV11Request);
    assert.notEqual(safeRawRuntimeLogging, "unsafe_response:side_effects", "safe raw runtime activity logging must be accepted");
    assert.equal(safeRawRuntimeLogging.side_effects.vault_write, true);
    assert.equal(safeRawRuntimeLogging.side_effects.raw_capture, true);
    assert.equal(safeRawRuntimeLogging.side_effects.knowledge_promotion, false);
    assert.equal(safeRawRuntimeLogging.side_effects.source_auto_save, false);
    assert.equal(safeRawRuntimeLogging.side_effects.gbrain_mutation, false);

    const safeRawRuntimeDeduped = chatV11.normalizeHermesCmoChatV11Response({
      ...baseChatV11Response,
      raw_activity_log: {
        schema_version: "vault_agent.raw_activity_log_result.v1",
        status: "completed",
        deduped: true,
        vault_write_performed: false,
        vault_path: "90 Runtime/Raw Activity/hold-pay/jay/2026-06-04/turn.json",
        side_effects: {
          knowledge_write: false,
          accepted_knowledge_write: false,
          gbrain_mutation: false,
          knowledge_promotion: false,
          source_auto_save: false,
          memory_mutation: false,
          supabase_mutation: false,
        },
      },
      side_effects: {
        vault_write: true,
        raw_capture: true,
      },
    }, chatV11Request);
    assert.notEqual(safeRawRuntimeDeduped, "unsafe_response:side_effects", "deduped raw runtime activity logging must be accepted");

    const rawRuntimeLogOutside90Runtime = chatV11.normalizeHermesCmoChatV11Response({
      ...baseChatV11Response,
      raw_activity_log: {
        ...safeRawRuntimeLogReceipt,
        vault_path: "12 Knowledge/Hold Pay/unsafe.md",
      },
      side_effects: {
        vault_write: true,
        raw_capture: true,
      },
    }, chatV11Request);
    assert.equal(rawRuntimeLogOutside90Runtime, "unsafe_response:side_effects", "raw_activity_log outside 90 Runtime/Raw Activity must be rejected");

    for (const unsafeReceiptSideEffect of ["gbrain_mutation", "knowledge_promotion", "source_auto_save", "accepted_knowledge_write"]) {
      const unsafeReceipt = chatV11.normalizeHermesCmoChatV11Response({
        ...baseChatV11Response,
        raw_activity_log: {
          ...safeRawRuntimeLogReceipt,
          side_effects: {
            ...safeRawRuntimeLogReceipt.side_effects,
            [unsafeReceiptSideEffect]: true,
          },
        },
        side_effects: {
          vault_write: true,
          raw_capture: true,
        },
      }, chatV11Request);
      assert.equal(unsafeReceipt, "unsafe_response:side_effects", `raw_activity_log with ${unsafeReceiptSideEffect}=true must be rejected`);
    }

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

    const productComparisonArtifact = {
      type: "comparison_set",
      id: "hold_pay_competitor_set_v1",
      title: "Hold Pay competitor comparison set",
      content: "Comparison set: Binance P2P, Remitano, OKX P2P.",
      metadata: {
        comparison_set: ["Binance P2P", "Remitano", "OKX P2P"],
        table_summary: "Binance P2P vs Remitano vs OKX P2P for Hold Pay similarity.",
      },
    };
    const productArtifactResponse = chatV11.normalizeHermesCmoChatV11Response({
      schema_version: "hermes.cmo.chat.response.v1_1",
      mode: "cmo.chat",
      request_id: chatV11Request.request_id,
      session_id: chatV11Request.session_id,
      turn_id: chatV11Request.turn_id,
      status: "completed",
      answer: { content: "Comparison artifact created." },
      artifacts_out: [productComparisonArtifact],
      suggested_session_summary_update: {
        summary_delta: "Hold Pay comparison set created for Binance P2P, Remitano, OKX P2P.",
        comparison_sets: ["Binance P2P, Remitano, OKX P2P"],
        artifact_refs: ["hold_pay_competitor_set_v1"],
      },
      suggested_vault_updates: [],
      side_effects: false,
    }, chatV11Request);
    assert.notEqual(typeof productArtifactResponse, "string", "Product-shaped artifacts_out response must normalize");
    const productArtifactMapped = chatV11.mapHermesCmoChatV11ToChatResult(chatV11Request, productArtifactResponse);
    const rollingSessionSummary = chatV11.mergeHermesCmoChatV11SessionSummary(undefined, productArtifactMapped.suggestedSessionSummaryUpdate);
    const rollingSessionArtifacts = chatV11.mergeHermesCmoChatV11Artifacts([], productArtifactMapped.artifactsOut);
    assert.equal(productArtifactMapped.artifactsOut[0].id, "hold_pay_competitor_set_v1");
    assert.equal(productArtifactMapped.artifactsOut[0].type, "comparison_set");
    assert.equal(productArtifactMapped.artifactsOut[0].title, "Hold Pay competitor comparison set");
    assert.match(productArtifactMapped.artifactsOut[0].content, /Binance P2P, Remitano, OKX P2P/);
    assert.deepEqual(productArtifactMapped.artifactsOut[0].metadata.comparison_set, ["Binance P2P", "Remitano", "OKX P2P"]);
    assert.match(rollingSessionSummary, /Binance P2P, Remitano, OKX P2P/);
    assert.ok(rollingSessionArtifacts.some((artifact) => artifact.id === "hold_pay_competitor_set_v1"));
    const compressedCorrectionUpdate = {
      summary: "Compressed rolling summary for Hold Pay competitor comparison.",
      active_subjects: ["Hold Pay competitor positioning"],
      decisions: ["Use the corrected comparison set for follow-up answers."],
      open_questions: ["Which competitor is closest to Hold Pay?"],
      artifact_refs: ["hold_pay_competitor_set_v1"],
      vault_refs: ["workspace_context:hold-pay"],
      comparison_sets: [
        "Binance P2P, Remitano, OKX P2P",
        "Binance P2P, Remitano, MoMo crypto rail giả định",
      ],
      corrections: ["Replace OKX P2P with MoMo crypto rail giả định."],
      superseded_items: ["OKX P2P"],
    };
    const compressedSessionSummary = chatV11.mergeHermesCmoChatV11SessionSummary(rollingSessionSummary, compressedCorrectionUpdate);
    let boundedCompressedSessionSummary = compressedSessionSummary;

    for (let index = 0; index < 20; index += 1) {
      boundedCompressedSessionSummary = chatV11.mergeHermesCmoChatV11SessionSummary(boundedCompressedSessionSummary, compressedCorrectionUpdate);
    }

    assert.equal((boundedCompressedSessionSummary.match(/Replace OKX P2P with MoMo crypto rail/g) ?? []).length, 1);
    assert.ok(boundedCompressedSessionSummary.length <= 6_000);
    const compressionReplayRequest = chatV11.buildHermesCmoChatV11Request({
      ...sampleTurnInput,
      message: "vậy trong mấy bên đó, bên nào giống Hold Pay nhất?",
      history: [],
      sessionId: "session_compressed_replay",
      userMessageId: "msg_compressed_replay",
      createdAt: "2026-05-28T13:30:00.000Z",
      sessionSummary: boundedCompressedSessionSummary,
      sessionArtifacts: rollingSessionArtifacts,
      vaultContext: null,
    });
    assert.deepEqual(compressionReplayRequest.context_pack.session_summary.active_subjects, ["Hold Pay competitor positioning"]);
    assert.deepEqual(compressionReplayRequest.context_pack.session_summary.decisions, ["Use the corrected comparison set for follow-up answers."]);
    assert.deepEqual(compressionReplayRequest.context_pack.session_summary.open_questions, ["Which competitor is closest to Hold Pay?"]);
    assert.deepEqual(compressionReplayRequest.context_pack.session_summary.artifact_refs, ["hold_pay_competitor_set_v1"]);
    assert.deepEqual(compressionReplayRequest.context_pack.session_summary.vault_refs, ["workspace_context:hold-pay"]);
    assert.deepEqual(compressionReplayRequest.context_pack.session_summary.corrections, ["Replace OKX P2P with MoMo crypto rail giả định."]);
    assert.deepEqual(compressionReplayRequest.context_pack.session_summary.superseded_items, ["OKX P2P"]);
    assert.deepEqual(compressionReplayRequest.context_pack.session_summary.comparison_sets, ["Binance P2P, Remitano, MoMo crypto rail giả định"]);

    const longSessionHistory = Array.from({ length: 22 }, (_, index) => ({
      id: `long_session_msg_${index}`,
      role: index % 2 === 0 ? "user" : "assistant",
      content: index % 2 === 0 ? `Later unrelated planning question ${index}.` : `Later unrelated planning answer ${index}.`,
      createdAt: `2026-05-28T12:${String(index).padStart(2, "0")}:00.000Z`,
    }));
    const rollingReplayRequest = chatV11.buildHermesCmoChatV11Request({
      ...sampleTurnInput,
      message: "vậy trong mấy bên đó, bên nào giống Hold Pay nhất?",
      history: longSessionHistory,
      sessionId: "session_rolling_replay",
      userMessageId: "msg_rolling_replay",
      createdAt: "2026-05-28T13:00:00.000Z",
      sessionSummary: rollingSessionSummary,
      sessionArtifacts: rollingSessionArtifacts,
      vaultContext: null,
    });
    const rollingRecentMessageText = JSON.stringify(rollingReplayRequest.messages);
    assert.equal(/Binance P2P|Remitano|OKX P2P/.test(rollingRecentMessageText), false, "recent messages should no longer carry the original comparison set");
    assert.match(rollingReplayRequest.context_pack.session_summary.summary, /Binance P2P, Remitano, OKX P2P/);
    assert.ok(
      rollingReplayRequest.context_pack.artifacts_in.some((artifact) =>
        artifact.id === "hold_pay_competitor_set_v1" &&
        artifact.type === "comparison_set" &&
        typeof artifact.content === "string" &&
        artifact.content.includes("OKX P2P") &&
        Array.isArray(artifact.metadata?.comparison_set) &&
        artifact.metadata.comparison_set.includes("OKX P2P"),
      ),
      "artifacts_in must replay the stored comparison set",
    );

    const correctionHistory = [
      {
        id: "correction_user",
        role: "user",
        content: "không, bỏ OKX ra, dùng MoMo crypto rail giả định thay thế",
        createdAt: "2026-05-28T14:00:00.000Z",
      },
      {
        id: "correction_assistant",
        role: "assistant",
        content: "Đã cập nhật phạm vi so sánh trong phiên này.",
        createdAt: "2026-05-28T14:01:00.000Z",
      },
    ];
    const correctionReplayRequest = chatV11.buildHermesCmoChatV11Request({
      ...sampleTurnInput,
      message: "vậy trong mấy bên đó, bên nào giống mình nhất?",
      history: correctionHistory,
      sessionId: "session_rolling_correction",
      userMessageId: "msg_rolling_correction",
      createdAt: "2026-05-28T14:02:00.000Z",
      sessionSummary: rollingSessionSummary,
      sessionArtifacts: rollingSessionArtifacts,
      vaultContext: null,
    });
    assert.match(JSON.stringify(correctionReplayRequest.messages), /MoMo crypto rail giả định/);
    assert.match(correctionReplayRequest.context_pack.session_summary.summary, /OKX P2P/);
    assert.ok(correctionReplayRequest.context_pack.artifacts_in.some((artifact) => artifact.id === "hold_pay_competitor_set_v1"));
    const missingArtifactInput = JSON.parse(JSON.stringify(sampleTurnInput));
    missingArtifactInput.message = "mấy bên đó thì bên nào giống mình nhất?";
    missingArtifactInput.contextPack.items = [];
    missingArtifactInput.contextPack.contextQualitySummary = {
      selectedCount: 0,
      existingCount: 0,
      missingCount: 0,
      confirmedCount: 0,
      draftCount: 0,
      placeholderCount: 0,
      placeholderOrDraftCount: 0,
    };
    missingArtifactInput.contextPackage.selectedContext = [];
    missingArtifactInput.contextPackage.missingContext = [];
    missingArtifactInput.contextPackage.contextQualitySummary = missingArtifactInput.contextPack.contextQualitySummary;
    const missingArtifactRequest = chatV11.buildHermesCmoChatV11Request({
      ...missingArtifactInput,
      history: longSessionHistory,
      sessionId: "session_missing_artifact",
      userMessageId: "msg_missing_artifact",
      createdAt: "2026-05-28T15:00:00.000Z",
      sessionSummary: undefined,
      sessionArtifacts: [],
      vaultContext: null,
    });
    assert.equal(/Binance P2P|Remitano|OKX P2P|MoMo crypto rail/.test(missingArtifactRequest.context_pack.session_summary?.summary ?? ""), false);
    assert.equal(missingArtifactRequest.context_pack.artifacts_in.length, 0);
    assert.equal(/Binance P2P|Remitano|OKX P2P|MoMo crypto rail/.test(JSON.stringify(missingArtifactRequest.messages)), false);
    rollingReplaySmoke = {
      storedSuggestedSessionSummaryUpdate: true,
      mergedSessionSummaryContainsComparisonSet: /Binance P2P, Remitano, OKX P2P/.test(rollingSessionSummary),
      storedArtifactsOutCount: rollingSessionArtifacts.length,
      productArtifactShapeStored: rollingSessionArtifacts.some((artifact) =>
        artifact.id === "hold_pay_competitor_set_v1" &&
        artifact.type === "comparison_set" &&
        artifact.title === "Hold Pay competitor comparison set" &&
        typeof artifact.content === "string" &&
        artifact.content.includes("Binance P2P") &&
        Array.isArray(artifact.metadata?.comparison_set),
      ),
      compressedSummaryBounded: boundedCompressedSessionSummary.length <= 6_000,
      duplicateCorrectionCount: (boundedCompressedSessionSummary.match(/Replace OKX P2P with MoMo crypto rail/g) ?? []).length,
      compressionRequestComparisonSets: compressionReplayRequest.context_pack.session_summary.comparison_sets,
      compressionRequestCorrections: compressionReplayRequest.context_pack.session_summary.corrections,
      compressionRequestSupersededItems: compressionReplayRequest.context_pack.session_summary.superseded_items,
      replayRequestHasSessionSummary: Boolean(rollingReplayRequest.context_pack.session_summary?.summary),
      replayRequestHasArtifactsIn: rollingReplayRequest.context_pack.artifacts_in.some((artifact) => artifact.id === "hold_pay_competitor_set_v1"),
      replayRequestArtifactsInCount: rollingReplayRequest.context_pack.artifacts_in.length,
      recentMessagesContainOriginalSet: /Binance P2P|Remitano|OKX P2P/.test(rollingRecentMessageText),
      missingArtifactRequestHasNoArtifactsIn: missingArtifactRequest.context_pack.artifacts_in.length === 0,
      missingArtifactClarificationExpected: true,
      correctionArtifactStillPresent: correctionReplayRequest.context_pack.artifacts_in.some((artifact) => artifact.id === "hold_pay_competitor_set_v1"),
      correctionRecentMessagePresent: /MoMo crypto rail giả định/.test(JSON.stringify(correctionReplayRequest.messages)),
      expectedCorrectedSet: ["Binance P2P", "Remitano", "MoMo crypto rail giả định"],
    };

    const longStressSeedOptions = ["Binance P2P", "Remitano", "MoMo merchant transfer", "Bank 24/7 transfer"];
    const longStressCorrectedOptions = ["Binance P2P", "Remitano", "MoMo merchant transfer", "ZaloPay merchant payout gia dinh"];
    const longStressTurnInput = JSON.parse(JSON.stringify(sampleTurnInput));
    longStressTurnInput.request = {
      ...longStressTurnInput.request,
      tenantId: "holdstation",
      workspaceId: "hold-pay",
      appId: "hold-pay",
      appName: "Hold Pay",
      message: `Create a Hold Pay comparison artifact for ${longStressSeedOptions.join(", ")}.`,
    };
    longStressTurnInput.message = longStressTurnInput.request.message;
    longStressTurnInput.contextPack = {
      ...longStressTurnInput.contextPack,
      workspaceId: "hold-pay",
      appId: "hold-pay",
      sourceId: "hold-pay__hold-pay",
      logicalAppPath: "02 Apps/Hold Pay",
      appVaultPath: "02 Apps/Hold Pay",
    };
    longStressTurnInput.contextPackage = {
      ...longStressTurnInput.contextPackage,
      workspaceId: "hold-pay",
      sourceId: "hold-pay__hold-pay",
      app: {
        ...longStressTurnInput.contextPackage.app,
        id: "hold-pay",
        name: "Hold Pay",
        logicalAppPath: "02 Apps/Hold Pay",
        appVaultPath: "02 Apps/Hold Pay",
      },
      userMessage: longStressTurnInput.message,
    };
    const longStressIdentity = {
      userId: "04acf682-0067-4a8c-8a42-3520a30f8ccf",
      userEmail: "jay@example.com",
      userDisplayName: "Jay",
      userSlug: "jay",
    };
    const longStressSeedRequest = chatV11.buildHermesCmoChatV11Request({
      ...longStressTurnInput,
      history: [],
      sessionId: "session_long_stress_seed",
      userMessageId: "msg_long_stress_seed",
      createdAt: "2026-06-04T09:00:00.000Z",
      userIdentity: longStressIdentity,
      sessionSummary: undefined,
      sessionArtifacts: [],
      vaultContext: null,
    });
    assert.equal(longStressSeedRequest.workspace_id, "hold-pay");
    assert.equal(longStressSeedRequest.user_id, "04acf682-0067-4a8c-8a42-3520a30f8ccf");
    assert.equal(longStressSeedRequest.user_slug, "jay");
    assert.equal(longStressSeedRequest.user_display_name, "Jay");

    const longStressSeedResponse = chatV11.normalizeHermesCmoChatV11Response({
      schema_version: "hermes.cmo.chat.response.v1_1",
      mode: "cmo.chat",
      request_id: longStressSeedRequest.request_id,
      session_id: longStressSeedRequest.session_id,
      turn_id: longStressSeedRequest.turn_id,
      status: "completed",
      answer: { content: "Comparison artifact created for Hold Pay." },
      artifacts_out: [{
        id: "hold_pay_long_stress_comparison_v1",
        type: "comparison_set",
        title: "Hold Pay long-session comparison set",
        content: `Comparison set: ${longStressSeedOptions.join(", ")}.`,
        metadata: {
          comparison_set: longStressSeedOptions,
          table_summary: "Long-session replay can resolve these Hold Pay benchmark directions from artifacts_in.",
        },
      }],
      suggested_session_summary_update: {
        summary_delta: `Hold Pay comparison directions created: ${longStressSeedOptions.join(", ")}.`,
        active_subjects: ["Hold Pay benchmark directions"],
        comparison_sets: [longStressSeedOptions.join(", ")],
        artifact_refs: ["hold_pay_long_stress_comparison_v1"],
      },
      suggested_vault_updates: [],
      side_effects: false,
    }, longStressSeedRequest);
    assert.notEqual(typeof longStressSeedResponse, "string", "long-session seed response must normalize");
    const longStressSeedMapped = chatV11.mapHermesCmoChatV11ToChatResult(longStressSeedRequest, longStressSeedResponse);
    const longStressSessionArtifacts = chatV11.mergeHermesCmoChatV11Artifacts([], longStressSeedMapped.artifactsOut);
    const longStressSessionSummary = chatV11.mergeHermesCmoChatV11SessionSummary(undefined, longStressSeedMapped.suggestedSessionSummaryUpdate);
    assert.ok(longStressSessionArtifacts.some((artifact) => artifact.id === "hold_pay_long_stress_comparison_v1"));
    assert.match(longStressSessionSummary, /Bank 24\/7 transfer/);

    const longStressFillerHistory = Array.from({ length: 40 }, (_, index) => ({
      id: `long_stress_msg_${index}`,
      role: index % 2 === 0 ? "user" : "assistant",
      content: index % 2 === 0
        ? `Hold Pay unrelated CMO planning turn ${index}: review onboarding copy and activation instrumentation.`
        : `Noted for later; keep the current sprint scoped and avoid changing benchmark assumptions on turn ${index}.`,
      createdAt: `2026-06-04T10:${String(index).padStart(2, "0")}:00.000Z`,
    }));
    const longStressReplayRequest = chatV11.buildHermesCmoChatV11Request({
      ...longStressTurnInput,
      message: "Dua tren may huong do, huong nao giong Hold Pay nhat va vi sao?",
      history: longStressFillerHistory,
      sessionId: "session_long_stress_replay",
      userMessageId: "msg_long_stress_replay",
      createdAt: "2026-06-04T11:00:00.000Z",
      userIdentity: longStressIdentity,
      sessionSummary: longStressSessionSummary,
      sessionArtifacts: longStressSessionArtifacts,
      vaultContext: null,
    });
    const longStressRecentText = JSON.stringify(longStressReplayRequest.messages);
    assert.ok(longStressReplayRequest.messages.length <= 20, "long-session recent messages must be bounded");
    assert.equal(longStressSeedOptions.every((option) => longStressRecentText.includes(option)), false, "recent messages must not carry the full original comparison list");
    assert.ok(longStressReplayRequest.context_pack.session_summary?.summary.includes("Bank 24/7 transfer"));
    assert.ok(longStressReplayRequest.context_pack.artifacts_in.some((artifact) =>
      artifact.id === "hold_pay_long_stress_comparison_v1" &&
      artifact.metadata?.comparison_set?.length === 4,
    ));

    const longStressCorrectionSummary = chatV11.mergeHermesCmoChatV11SessionSummary(longStressSessionSummary, {
      summary_delta: "Correction: remove Bank 24/7 transfer and replace it with ZaloPay merchant payout gia dinh.",
      corrections: ["Remove Bank 24/7 transfer and use ZaloPay merchant payout gia dinh instead."],
      superseded_items: ["Bank 24/7 transfer"],
      comparison_sets: [longStressCorrectedOptions.join(", ")],
      artifact_refs: ["hold_pay_long_stress_comparison_v1"],
    });
    const longStressCorrectionHistory = [
      ...longStressFillerHistory.slice(-14),
      {
        id: "long_stress_correction_user",
        role: "user",
        content: "Khong, bo Bank 24/7 transfer ra, thay bang ZaloPay merchant payout gia dinh.",
        createdAt: "2026-06-04T11:05:00.000Z",
      },
      {
        id: "long_stress_correction_assistant",
        role: "assistant",
        content: "Da cap nhat pham vi benchmark cho phien nay.",
        createdAt: "2026-06-04T11:06:00.000Z",
      },
    ];
    const longStressCorrectionRequest = chatV11.buildHermesCmoChatV11Request({
      ...longStressTurnInput,
      message: "Vay trong may huong do, chon top 2 huong dang benchmark truoc cho Hold Pay.",
      history: longStressCorrectionHistory,
      sessionId: "session_long_stress_correction",
      userMessageId: "msg_long_stress_correction",
      createdAt: "2026-06-04T11:07:00.000Z",
      userIdentity: longStressIdentity,
      sessionSummary: longStressCorrectionSummary,
      sessionArtifacts: longStressSessionArtifacts,
      vaultContext: null,
    });
    assert.deepEqual(longStressCorrectionRequest.context_pack.session_summary.comparison_sets, [longStressCorrectedOptions.join(", ")]);
    assert.deepEqual(longStressCorrectionRequest.context_pack.session_summary.corrections, ["Remove Bank 24/7 transfer and use ZaloPay merchant payout gia dinh instead."]);
    assert.deepEqual(longStressCorrectionRequest.context_pack.session_summary.superseded_items, ["Bank 24/7 transfer"]);
    assert.match(JSON.stringify(longStressCorrectionRequest.messages), /ZaloPay merchant payout gia dinh/);
    const longStressAnswerFixture = "Top 2 nen benchmark truoc: MoMo merchant transfer va ZaloPay merchant payout gia dinh. Binance P2P va Remitano la boi canh P2P, khong phai rail merchant payout sat nhat.";
    assert.match(longStressAnswerFixture, /MoMo merchant transfer/);
    assert.match(longStressAnswerFixture, /ZaloPay merchant payout gia dinh/);
    assert.doesNotMatch(longStressAnswerFixture, /Bank 24\/7 transfer/);

    longSessionStressSmoke = {
      fillerTurns: longStressFillerHistory.length,
      recentMessagesBounded: longStressReplayRequest.messages.length <= 20,
      recentMessagesContainOriginalFullSet: longStressSeedOptions.every((option) => longStressRecentText.includes(option)),
      sessionSummaryPresent: Boolean(longStressReplayRequest.context_pack.session_summary?.summary),
      artifactsInCount: longStressReplayRequest.context_pack.artifacts_in.length,
      artifactReplayPresent: longStressReplayRequest.context_pack.artifacts_in.some((artifact) => artifact.id === "hold_pay_long_stress_comparison_v1"),
      correctedActiveSet: longStressCorrectionRequest.context_pack.session_summary.comparison_sets,
      corrections: longStressCorrectionRequest.context_pack.session_summary.corrections,
      supersededItems: longStressCorrectionRequest.context_pack.session_summary.superseded_items,
      bankActiveAfterCorrection: longStressCorrectionRequest.context_pack.session_summary.comparison_sets.some((item) => /Bank 24\/7 transfer/.test(item)),
      userSlug: longStressReplayRequest.user_slug,
      runtimeRawLogPath: "90 Runtime/Raw Activity/hold-pay/jay/2026-06-04/turn.json",
      runtimeRawLogPathUsesCanonicalUser: true,
      runtimeRawLogPathContainsUuid: false,
      noGbrain: true,
      noPromotion: true,
      noAcceptedKnowledgeWrite: true,
    };

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
            let chatV11FetchCalls = 0;
            globalThis.fetch = async (url, init) => {
              chatV11FetchCalls += 1;
              assert.equal(url, "https://hermes.test/agents/cmo/chat");
              const body = JSON.parse(init.body);
              assert.equal(body.outbound_hermes_payload_guard?.outbound_callsite_guard_version, "context-sanitizer-v2");
              assert.equal(body.outbound_hermes_payload_guard?.outbound_callsite_guard_checked, true);
              assert.equal(body.outbound_hermes_payload_guard?.outbound_callsite_guard_blocked, false);

              if (body.session_id === "session_long_stress_trace") {
                return new Response(JSON.stringify({
                  schema_version: "hermes.cmo.chat.response.v1_1",
                  mode: "cmo.chat",
                  request_id: body.request_id,
                  session_id: body.session_id,
                  turn_id: body.turn_id,
                  status: "completed",
                  answer: { content: "MoMo merchant transfer and ZaloPay merchant payout gia dinh are the closest Hold Pay benchmark directions." },
                  artifacts_out: [],
                  suggested_vault_updates: [],
                  raw_activity_log: {
                    schema_version: "vault_agent.raw_activity_log_result.v1",
                    status: "completed",
                    raw_activity_logged: true,
                    vault_write_performed: true,
                    vault_path: "90 Runtime/Raw Activity/hold-pay/jay/2026-06-04/turn.json",
                    body: "raw runtime body must remain redacted from trace payloads",
                    side_effects: {
                      vault_write: true,
                      raw_runtime_write: true,
                      knowledge_write: false,
                      accepted_knowledge_write: false,
                      gbrain_mutation: false,
                      knowledge_promotion: false,
                      source_auto_save: false,
                      memory_mutation: false,
                      supabase_mutation: false,
                    },
                  },
                  side_effects: {
                    vault_write: true,
                    raw_capture: true,
                    gbrain_mutation: false,
                    knowledge_promotion: false,
                    source_auto_save: false,
                    memory_mutation: false,
                    supabase_mutation: false,
                  },
                }), { status: 200, headers: { "content-type": "application/json" } });
              }

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
            assert.equal(requestTrace.outbound_hermes_payload_guard.outbound_callsite_guard_version, "context-sanitizer-v2");
            assert.equal(requestTrace.outbound_hermes_payload_guard.outbound_callsite_guard_checked, true);
            assert.equal(requestTrace.outbound_hermes_payload_guard.outbound_callsite_guard_blocked, false);
            assert.equal(requestTrace.request.outbound_hermes_payload_guard.outbound_callsite_guard_version, "context-sanitizer-v2");
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
            const fetchCallsBeforeBlockedGuard = chatV11FetchCalls;
            const blockedChatResult = await chatV11.runHermesCmoChatV11(chatV11RunInput({
              sessionId: "session_chat_v11_callsite_guard_blocked",
              userMessageId: "msg_chat_v11_callsite_guard_blocked",
              vaultContext: {
                "[hermes_local_artifact_path_redacted]": true,
                "file:": true,
                polluted_content: "trace-only pollution should expose file:///private/cmo/blocked.png",
              },
            }));
            assert.equal(blockedChatResult.ok, false);
            assert.equal(blockedChatResult.fallbackEligible, false);
            assert.match(blockedChatResult.fallbackReason, /outbound payload still contained path-like Creative artifact text/);
            assert.equal(blockedChatResult.request.outbound_hermes_payload_guard.outbound_callsite_guard_version, "context-sanitizer-v2");
            assert.equal(blockedChatResult.request.outbound_hermes_payload_guard.outbound_callsite_guard_checked, true);
            assert.equal(blockedChatResult.request.outbound_hermes_payload_guard.outbound_callsite_guard_blocked, true);
            assert.ok(
              blockedChatResult.request.outbound_hermes_payload_guard.outbound_callsite_blocked_literals.includes("hermes_local_artifact_path_redacted"),
              "v1.1 blocked diagnostics must name the redacted artifact token",
            );
            assert.ok(
              blockedChatResult.request.outbound_hermes_payload_guard.outbound_callsite_blocked_literals.includes("file:"),
              "v1.1 blocked diagnostics must name the trace-redactor local file token",
            );
            assert.ok(
              blockedChatResult.request.outbound_hermes_payload_guard.outbound_callsite_blocked_sources.includes("fetch_body") ||
              blockedChatResult.request.outbound_hermes_payload_guard.outbound_callsite_blocked_sources.includes("trace_envelope"),
              "v1.1 blocked diagnostics must include the blocked source",
            );
            assert.ok(
              blockedChatResult.request.outbound_hermes_payload_guard.outbound_callsite_blocked_paths.some((fieldPath) => fieldPath.includes("vault_context")),
              "v1.1 blocked diagnostics must include the polluted JSON path",
            );
            assert.ok(
              blockedChatResult.request.outbound_hermes_payload_guard.outbound_callsite_blocked_snippets.some((snippet) => snippet.includes("file:")),
              "v1.1 blocked diagnostics must include a bounded sanitized snippet",
            );
            assert.equal(chatV11FetchCalls, fetchCallsBeforeBlockedGuard, "v1.1 call-site guard must block before fetch");

            const rollingTraceResult = await chatV11.runHermesCmoChatV11(chatV11RunInput({
              sessionId: "session_trace_rolling_replay",
              userMessageId: "msg_trace_rolling_replay",
              message: "vậy trong mấy bên đó, bên nào giống Hold Pay nhất?",
              history: longSessionHistory,
              sessionSummary: boundedCompressedSessionSummary,
              sessionArtifacts: rollingSessionArtifacts,
            }));
            assert.equal(rollingTraceResult.ok, true, "rolling replay trace run must succeed");

            const rollingRequestTrace = await readTraceFile(successTraceDir, "request");
            assert.equal(rollingRequestTrace.request.session_id, "session_trace_rolling_replay");
            assert.match(rollingRequestTrace.request.context_pack.session_summary.summary, /Binance P2P, Remitano, OKX P2P/);
            assert.deepEqual(rollingRequestTrace.request.context_pack.session_summary.comparison_sets, compressionReplayRequest.context_pack.session_summary.comparison_sets);
            assert.deepEqual(rollingRequestTrace.request.context_pack.session_summary.corrections, compressionReplayRequest.context_pack.session_summary.corrections);
            assert.deepEqual(rollingRequestTrace.request.context_pack.session_summary.superseded_items, compressionReplayRequest.context_pack.session_summary.superseded_items);
            assert.ok(
              rollingRequestTrace.request.context_pack.artifacts_in.some((artifact) =>
                artifact.id === "hold_pay_competitor_set_v1" &&
                artifact.type === "comparison_set" &&
                artifact.content === "[redacted]" &&
                Array.isArray(artifact.metadata?.comparison_set) &&
                artifact.metadata.comparison_set.includes("OKX P2P"),
              ),
              "rolling request trace must include artifacts_in comparison set",
            );

            const rollingResponseTrace = await readTraceFile(successTraceDir, "response");
            assert.equal(rollingResponseTrace.side_effects.vault_write, false);
            assert.equal(rollingResponseTrace.side_effects.gbrain_mutation, false);
            assert.equal(rollingResponseTrace.side_effects.knowledge_promotion, false);
            assert.equal(rollingResponseTrace.response.gbrain_mutation, undefined);
            assert.equal(rollingResponseTrace.response.knowledge_promotion, undefined);
            rollingReplaySmoke.traceRequestHasSessionSummary = Boolean(rollingRequestTrace.request.context_pack.session_summary?.summary);
            rollingReplaySmoke.traceRequestArtifactsInCount = rollingRequestTrace.request.context_pack.artifacts_in.length;
            rollingReplaySmoke.traceComparisonSets = rollingRequestTrace.request.context_pack.session_summary.comparison_sets;
            rollingReplaySmoke.traceCorrections = rollingRequestTrace.request.context_pack.session_summary.corrections;
            rollingReplaySmoke.traceSupersededItems = rollingRequestTrace.request.context_pack.session_summary.superseded_items;
            rollingReplaySmoke.traceArtifactsInContentRedacted = rollingRequestTrace.request.context_pack.artifacts_in.some((artifact) =>
              artifact.id === "hold_pay_competitor_set_v1" &&
              artifact.content === "[redacted]",
            );
            rollingReplaySmoke.traceNoVaultWrite = rollingResponseTrace.side_effects.vault_write === false;
            rollingReplaySmoke.traceNoGbrain = rollingResponseTrace.side_effects.gbrain_mutation === false;
            rollingReplaySmoke.traceNoPromotion = rollingResponseTrace.side_effects.knowledge_promotion === false;

            const longStressTraceResult = await chatV11.runHermesCmoChatV11({
              ...longStressTurnInput,
              sessionId: "session_long_stress_trace",
              userMessageId: "msg_long_stress_trace",
              message: "Vay trong may huong do, chon top 2 huong dang benchmark truoc cho Hold Pay.",
              history: longStressCorrectionHistory,
              createdAt: "2026-06-04T11:08:00.000Z",
              userIdentity: longStressIdentity,
              sessionSummary: longStressCorrectionSummary,
              sessionArtifacts: longStressSessionArtifacts,
              vaultContext: null,
            });
            assert.equal(longStressTraceResult.ok, true, "long-session stress trace run must succeed with safe raw runtime logging");

            const longStressRequestTrace = await readTraceFile(successTraceDir, "request");
            assert.equal(longStressRequestTrace.request.session_id, "session_long_stress_trace");
            assert.equal(longStressRequestTrace.request.workspace_id, "hold-pay");
            assert.equal(longStressRequestTrace.request.user_id, "04acf682-0067-4a8c-8a42-3520a30f8ccf");
            assert.equal(longStressRequestTrace.request.user_slug, "jay");
            assert.equal(longStressRequestTrace.request.user_display_name, "Jay");
            assert.ok(longStressRequestTrace.request.messages.length <= 20);
            assert.equal(longStressSeedOptions.every((option) => JSON.stringify(longStressRequestTrace.request.messages).includes(option)), false);
            assert.ok(longStressRequestTrace.request.context_pack.session_summary.summary);
            assert.deepEqual(longStressRequestTrace.request.context_pack.session_summary.comparison_sets, [longStressCorrectedOptions.join(", ")]);
            assert.deepEqual(longStressRequestTrace.request.context_pack.session_summary.corrections, ["Remove Bank 24/7 transfer and use ZaloPay merchant payout gia dinh instead."]);
            assert.deepEqual(longStressRequestTrace.request.context_pack.session_summary.superseded_items, ["Bank 24/7 transfer"]);
            assert.ok(longStressRequestTrace.request.context_pack.artifacts_in.length > 0);
            assert.ok(longStressRequestTrace.request.context_pack.artifacts_in.some((artifact) =>
              artifact.id === "hold_pay_long_stress_comparison_v1" &&
              artifact.content === "[redacted]" &&
              Array.isArray(artifact.metadata?.comparison_set),
            ));

            const longStressResponseTrace = await readTraceFile(successTraceDir, "response");
            assert.equal(longStressResponseTrace.side_effects.vault_write, true);
            assert.equal(longStressResponseTrace.side_effects.raw_capture, true);
            assert.equal(longStressResponseTrace.side_effects.gbrain_mutation, false);
            assert.equal(longStressResponseTrace.side_effects.knowledge_promotion, false);
            assert.equal(longStressResponseTrace.side_effects.source_auto_save, false);
            assert.equal(longStressResponseTrace.runtime_activity_log_status, "completed");
            assert.equal(longStressResponseTrace.runtime_activity_log_path, "90 Runtime/Raw Activity/hold-pay/jay/2026-06-04/turn.json");
            assert.equal(longStressResponseTrace.runtime_activity_logged, true);
            assert.doesNotMatch(longStressResponseTrace.runtime_activity_log_path, /04acf682|holdstation|user_jay/);
            assert.doesNotMatch(JSON.stringify(longStressResponseTrace), /12 Knowledge|13 Sources|accepted_knowledge_write":true|gbrain_mutation":true|knowledge_promotion":true/);
            assert.equal(longStressResponseTrace.response.raw_activity_log, "[redacted]");
            longSessionStressSmoke.traceRequestHasSessionSummary = Boolean(longStressRequestTrace.request.context_pack.session_summary?.summary);
            longSessionStressSmoke.traceArtifactsInCount = longStressRequestTrace.request.context_pack.artifacts_in.length;
            longSessionStressSmoke.traceRecentMessagesBounded = longStressRequestTrace.request.messages.length <= 20;
            longSessionStressSmoke.traceRecentMessagesContainOriginalFullSet = longStressSeedOptions.every((option) => JSON.stringify(longStressRequestTrace.request.messages).includes(option));
            longSessionStressSmoke.traceComparisonSets = longStressRequestTrace.request.context_pack.session_summary.comparison_sets;
            longSessionStressSmoke.traceCorrections = longStressRequestTrace.request.context_pack.session_summary.corrections;
            longSessionStressSmoke.traceSupersededItems = longStressRequestTrace.request.context_pack.session_summary.superseded_items;
            longSessionStressSmoke.traceUserSlug = longStressRequestTrace.request.user_slug;
            longSessionStressSmoke.traceRuntimeRawLogPath = longStressResponseTrace.runtime_activity_log_path;
            longSessionStressSmoke.traceRuntimeRawLogPathUsesCanonicalUser = /90 Runtime\/Raw Activity\/hold-pay\/jay\//.test(longStressResponseTrace.runtime_activity_log_path);
            longSessionStressSmoke.traceRuntimeRawLogPathContainsUuid = /04acf682/.test(longStressResponseTrace.runtime_activity_log_path);
            longSessionStressSmoke.traceNoGbrain = longStressResponseTrace.side_effects.gbrain_mutation === false;
            longSessionStressSmoke.traceNoPromotion = longStressResponseTrace.side_effects.knowledge_promotion === false;
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
    const priorAssistantMessage = hermesRequest.messages.find((message) => message.role === "assistant");
    assert.ok(priorAssistantMessage, "tool-capable request must include prior assistant content in bounded messages");
    assert.match(priorAssistantMessage.content, /POST 2:/);
    const option2ReplayPrompt = "Giữ ý chính của option 2, nhưng sửa tone thân thiện hơn, bớt corporate, vẫn giữ cảm giác đáng tin.";
    const option2ReplayRequest = mapper.mapCmoChatToHermesCmoRequest({
      ...sampleTurnInput,
      message: option2ReplayPrompt,
      history: [
        {
          id: "msg_option_user_1",
          role: "user",
          content: "Viết giúp mình 4 biến thể notification ngắn để onboarding merchant cho Hold Pay.",
          createdAt: "2026-06-04T08:00:00.000Z",
        },
        {
          id: "msg_option_assistant_1",
          role: "assistant",
          content: [
            "1. Hoàn tất thiết lập Hold Pay",
            "Cập nhật thông tin cửa hàng để bắt đầu nhận thanh toán nhanh hơn.",
            "",
            "2. Bắt đầu dùng Hold Pay",
            "Cập nhật thông tin merchant để Hold Pay hỗ trợ quy trình thanh toán cho cửa hàng của bạn.",
            "",
            "3. Sẵn sàng nhận thanh toán",
            "Bổ sung thông tin cần thiết để Hold Pay hỗ trợ cửa hàng vận hành mượt hơn.",
            "",
            "4. Kích hoạt trải nghiệm thanh toán",
            "Hoàn thiện hồ sơ merchant để bắt đầu dùng Hold Pay cho các giao dịch hằng ngày.",
          ].join("\n"),
          createdAt: "2026-06-04T08:00:10.000Z",
          cmoRunStatus: "completed",
        },
        {
          id: "msg_option_user_2",
          role: "user",
          content: option2ReplayPrompt,
          createdAt: "2026-06-04T08:01:00.000Z",
        },
        {
          id: "msg_option_failed_product_guard",
          role: "assistant",
          content: "Creative conversation response was rejected by Product M1 validation.",
          createdAt: "2026-06-04T08:01:05.000Z",
          runtimeErrorReason: "invalid_response",
          hermesCmoErrorReason: "rejected_by_m1_validator=true answer_basis_mode=creative_conversation",
          creativeRejectedByM1Validator: true,
          hermesCmoMetadata: {
            runtimeMode: "hermes_cmo",
            runtimeStatus: "live",
            calledHermesCmo: true,
            creative_conversation_rejected: true,
            rejected_by_m1_validator: true,
          },
        },
        {
          id: "msg_option_pending",
          role: "assistant",
          content: "CMO is working...\n\nResearching signals...\nSynthesizing answer...",
          createdAt: "2026-06-04T08:01:01.000Z",
          cmoRunStatus: "pending",
        },
      ],
      request: {
        ...sampleTurnInput.request,
        message: option2ReplayPrompt,
      },
      sessionId: "session_option_replay",
      userMessageId: "msg_option_user_2",
      createdAt: "2026-06-04T08:01:00.000Z",
      userIdentity: {
        userId: "04acf682-0067-4a8c-8a42-3520a30f8ccf",
        userEmail: "jay@example.com",
        userDisplayName: "Jay",
        userSlug: "jay",
      },
    });
    assert.ok(option2ReplayRequest.messages.length > 0, "option 2 follow-up request must include recent messages");
    assert.ok(option2ReplayRequest.messages.some((message) => message.role === "assistant" && /2\. Bắt đầu dùng Hold Pay/.test(message.content)), "option 2 follow-up request must include previous assistant options");
    assert.ok(option2ReplayRequest.messages.some((message) => message.role === "user" && /Giữ ý chính của option 2/.test(message.content)), "option 2 follow-up request must include current user rewrite request");
    assert.ok(!option2ReplayRequest.messages.some((message) => /CMO is working|Researching signals|Synthesizing answer/.test(message.content)), "pending assistant placeholder must not be replayed as semantic context");
    assert.ok(!option2ReplayRequest.messages.some((message) => /Product M1 validation|rejected_by_m1_validator/i.test(message.content)), "stale failed Product assistant messages must not be replayed as semantic context");
    assert.ok(option2ReplayRequest.context_pack.selected_context.some((item) => item?.kind === "recent_chat_message" && item?.role === "assistant" && /2\. Bắt đầu dùng Hold Pay/.test(item.content)), "selected_context must also carry prior assistant option content");
    assert.ok(!option2ReplayRequest.context_pack.selected_context.some((item) => /Product M1 validation|rejected_by_m1_validator/i.test(item?.content ?? "")), "stale failed Product assistant messages must not be selected as context");
    const creativePromptReplay = "21:9 cinematic onboarding hero for Hold Pay merchant checkout, full-width store counter scene, clear payment moment, modern fintech palette.";
    const creativePromptFollowup = "Ok create the 21:9 image from the prompt you suggested.";
    const creativePromptReplayRequest = mapper.mapCmoChatToHermesCmoRequest({
      ...sampleTurnInput,
      message: creativePromptFollowup,
      history: [
        {
          id: "msg_creative_prompt_user_1",
          role: "user",
          content: "Suggest a Creative prompt for a wide Hold Pay launch visual.",
          createdAt: "2026-06-04T08:10:00.000Z",
        },
        {
          id: "msg_creative_prompt_assistant_1",
          role: "assistant",
          content: "[hermes_local_artifact_path_redacted]/creative/session/msg_creative_prompt_assistant_1/output.png",
          createdAt: "2026-06-04T08:10:10.000Z",
          cmoRunStatus: "completed",
          creativeWorkingState: {
            active_draft_id: "creative_draft_prompt_001",
            drafts: [
              {
                draft_id: "creative_draft_prompt_001",
                kind: "image",
                title: "Hold Pay wide launch visual",
                brief: "Generate a wide campaign image for merchant onboarding.",
                prompt: creativePromptReplay,
                format: "21:9",
                status: "ready",
              },
            ],
          },
        },
        {
          id: "msg_creative_prompt_user_2",
          role: "user",
          content: creativePromptFollowup,
          createdAt: "2026-06-04T08:11:00.000Z",
        },
      ],
      request: {
        ...sampleTurnInput.request,
        message: creativePromptFollowup,
      },
      sessionId: "session_creative_prompt_replay",
      userMessageId: "msg_creative_prompt_user_2",
      createdAt: "2026-06-04T08:11:00.000Z",
      creativeSessionFollowupDetected: true,
      creativeWorkingState: {
        active_draft_id: "creative_draft_prompt_001",
        drafts: [
          {
            draft_id: "creative_draft_prompt_001",
            kind: "image",
            title: "Hold Pay wide launch visual",
            brief: "Generate a wide campaign image for merchant onboarding.",
            prompt: creativePromptReplay,
            format: "21:9",
            status: "ready",
          },
        ],
      },
      userIdentity: {
        userId: "04acf682-0067-4a8c-8a42-3520a30f8ccf",
        userEmail: "jay@example.com",
        userDisplayName: "Jay",
        userSlug: "jay",
      },
    });
    const creativePromptReplayJson = JSON.stringify({
      messages: creativePromptReplayRequest.messages,
      selected_context: creativePromptReplayRequest.context_pack.selected_context,
      recent_session_summary: creativePromptReplayRequest.context_pack.recent_session_summary,
    });
    assert.ok(creativePromptReplayRequest.messages.some((message) => message.role === "assistant" && message.content.includes(creativePromptReplay)), "Creative follow-up replay must recover the prior assistant draft prompt");
    assert.ok(creativePromptReplayRequest.context_pack.selected_context.some((item) => item?.kind === "recent_chat_message" && item?.role === "assistant" && item.content.includes(creativePromptReplay)), "Creative selected_context must recover the prior assistant draft prompt");
    assert.ok(creativePromptReplayRequest.context_pack.recent_session_summary.includes(creativePromptReplay), "Creative recent_session_summary must recover the prior assistant draft prompt");
    assert.doesNotMatch(creativePromptReplayJson, /\[hermes_local_artifact_path_redacted\]/, "redacted local artifact paths must not become canonical replay content");
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

    const cleanCreativeAdvisoryBase = makeRuntimeResult();
    const cleanCreativeAdvisoryMapped = mapper.mapHermesCmoResponseToChatResult({
      ...cleanCreativeAdvisoryBase,
      hermesCmoRouteDecision: "creative_session",
      creativeLongRunningTurn: true,
      request: {
        ...cleanCreativeAdvisoryBase.request,
        constraints: {
          ...cleanCreativeAdvisoryBase.request.constraints,
          creative_session_followup_detected: true,
          creative_working_state_present: true,
        },
      },
      response: {
        ...cleanCreativeAdvisoryBase.response,
        answer_basis: {
          mode: "creative_conversation",
          missing_inputs: [],
          assumptions_used: [],
          user_can_override: true,
          suggested_user_inputs: [],
        },
        answer: {
          format: "markdown",
          title: "Creative advisory",
          summary: "",
          decision: "KEEP",
          body: "Nên thêm glow/accent teal quanh egg và CTA area, nhưng giữ tổng thể sạch để không làm mất cảm giác premium.",
        },
        structured_output: {
          ...cleanCreativeAdvisoryBase.response.structured_output,
          classification: "creative_conversation",
          creative_conversation_response_received: true,
          creative_conversation_mode: "advisory",
          creative_assets_count: 0,
          creative_asset_mutation: false,
          creative_state_mutation: false,
          m1_validation_result: "accepted",
          raw_hermes_response_answer_preview: "Nên thêm glow/accent teal quanh egg và CTA area, nhưng giữ tổng thể sạch để không làm mất cảm giác premium.",
          trace_response_answer_preview: "Nên thêm glow/accent teal quanh egg và CTA area, nhưng giữ tổng thể sạch để không làm mất cảm giác premium.",
          response_trace_redaction_applied: false,
          m1_validation_answer_source: "canonical_answer",
          diagnostic_preview_ignored_for_m1: true,
          reference_asset_fetch_status: "success",
          local_image_path_available: false,
          creative_visual_inspection_attempted: true,
          creative_visual_inspection_used: true,
          creative_visual_inspection_status: "success",
          creative_answer_source: "visual_inspection",
          creative_visual_observations: {
            summary: "Active reference image has a clean premium focal point.",
            crop_channel_fit: {
              landing: "Safe",
              x_post: "Tight but usable",
            },
          },
        },
      },
    });
    assert.match(cleanCreativeAdvisoryMapped.answer, /thêm glow\/accent teal quanh egg và CTA area/i);
    assert.doesNotMatch(cleanCreativeAdvisoryMapped.answer, /\[hermes_local_artifact_path_redacted\]|accent_teal_quanh_egg_v_CTA_area/i);
    assert.equal(cleanCreativeAdvisoryMapped.hermesCmoMetadata.m1_validation_answer_source, "canonical_answer");
    assert.equal(cleanCreativeAdvisoryMapped.hermesCmoMetadata.diagnostic_preview_ignored_for_m1, true);
    assert.equal(cleanCreativeAdvisoryMapped.hermesCmoMetadata.user_visible_answer_source, "raw_hermes_response");
    assert.equal(cleanCreativeAdvisoryMapped.hermesCmoMetadata.response_trace_redaction_applied, false);
    assert.equal(cleanCreativeAdvisoryMapped.hermesCmoMetadata.creative_assets_count, 0, "non-mutating visual-first review must not require returned creative_assets");
    assert.equal(cleanCreativeAdvisoryMapped.hermesCmoMetadata.creative_visual_inspection_used, true);
    assert.equal(cleanCreativeAdvisoryMapped.hermesCmoMetadata.creative_visual_inspection_status, "success");
    assert.deepEqual(cleanCreativeAdvisoryMapped.hermesCmoMetadata.creative_visual_observations.crop_channel_fit.x_post, "Tight but usable");

    const orderedMarkdownBase = makeRuntimeResult();
    const orderedMarkdownBody = [
      "1. First critique point",
      "",
      "   Keep the explanation under the first point readable.",
      "",
      "2. Second critique point",
      "",
      "   Preserve the second paragraph as markdown.",
      "",
      "3. Third critique point",
      "",
      "   Do not flatten this into a single paragraph.",
    ].join("\n");
    const orderedMarkdownMapped = mapper.mapHermesCmoResponseToChatResult({
      ...orderedMarkdownBase,
      response: {
        ...orderedMarkdownBase.response,
        answer: {
          format: "markdown",
          title: "Creative critique",
          summary: "",
          decision: "REVIEW",
          body: orderedMarkdownBody,
        },
      },
    });
    assert.equal(orderedMarkdownMapped.answer, orderedMarkdownBody);
    assert.match(orderedMarkdownMapped.answer, /1\. First critique point\n\n   Keep/);
    assert.match(orderedMarkdownMapped.answer, /2\. Second critique point/);
    assert.match(orderedMarkdownMapped.answer, /3\. Third critique point/);

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
    assert.equal(structuredReviewMapped.answer, "Review body stays structured for explicit review requests.");
    assert.doesNotMatch(structuredReviewMapped.answer, /CMO strategic response|Decision:|REVIEW/);

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

    const toolChatBase = makeRuntimeResult({
      hermesCmoAgentPath: "/agents/cmo/tool-execute",
      hermesCmoEndpointKind: "tool_execute",
      hermesCmoEndpointTimeoutMs: 90000,
      hermesCmoToolEndpointEnabled: true,
      sideEffects: false,
    });
    const toolChatResearchBody = "Ba tin hieu dang chu y: cash-in can nhanh va it buoc, cash-out can minh bach trang thai, va P2P UX can giam ma sat tin cay. Hold Pay nen uu tien merchant payout UX truoc vi sat voi loi hua van hanh va de tao bang chung hon.";
    const toolChatResearchMapped = mapper.mapHermesCmoResponseToChatResult({
      ...toolChatBase,
      response: {
        ...toolChatBase.response,
        schema_version: "hermes.cmo.tool_response.v1",
        mode: "cmo.tool_capable",
        answer_basis: {
          ...toolChatBase.response.answer_basis,
          mode: "external_research",
        },
        answer: {
          format: "markdown",
          title: "Tin hieu thi truong",
          summary: "CMO tong hop tin hieu lien quan cash-in/cash-out va P2P UX.",
          decision: "KEEP",
          body: toolChatResearchBody,
        },
        structured_output: {
          classification: "external_research",
          response_style: "research_answer",
          tool_policy: "cmo_internal_tools",
        },
        tools_used: ["cmo_call_surf"],
      },
      delegationSummary: [
        {
          delegationKey: "surf:cmo_call_surf",
          delegationId: "del_tool_chat_surf",
          targetAgent: "surf",
          mode: "surf.default",
          objective: "Gather recent market signals for Hold Pay.",
          status: "completed",
          summary: "Surf returned market-signal evidence for CMO synthesis.",
          response: {
            schema_version: "surf.response.v1",
            raw_json: { should_not_leak: true },
          },
        },
      ],
      safety_counters: {
        ...toolChatBase.safety_counters,
        surfCalls: 1,
      },
      surfCalls: 1,
      agentsUsed: ["cmo", "surf"],
    });
    assert.equal(toolChatResearchMapped.hermesCmoMetadata.endpoint_kind, "tool_execute");
    assert.equal(toolChatResearchMapped.hermesCmoMetadata.requested_endpoint, "/agents/cmo/tool-execute");
    assert.equal(toolChatResearchMapped.hermesCmoMetadata.tool_capable_cmo, true);
    assert.equal(toolChatResearchMapped.hermesCmoMetadata.cmo_call_surf_used, true);
    assert.deepEqual(toolChatResearchMapped.hermesCmoMetadata.tools_used, ["cmo_call_surf"]);
    assert.equal(toolChatResearchMapped.hermesCmoMetadata.surfCalls, 1);
    assert.equal(toolChatResearchMapped.hermesCmoMetadata.echoCalls, 0);
    assert.deepEqual(toolChatResearchMapped.hermesCmoMetadata.forbiddenCounters, forbiddenZeroCounters);
    assert.equal(toolChatResearchMapped.hermesCmoMetadata.sideEffects, false);
    assert.equal(toolChatResearchMapped.answer, toolChatResearchBody);
    assert.match(toolChatResearchMapped.answer, /Hold Pay nen uu tien merchant payout UX/);
    assert.doesNotMatch(toolChatResearchMapped.answer, /cmo_call_surf|Surf returned|tools_used|raw_json|schema_version|\{|\}/i);

    const toolChatCopyBody = "1. Ket noi merchant voi dong tien vao-ra ro rang trong vai phut.\n2. Theo doi payout cua cua hang minh bach, de xu ly, khong can thao tac thua.\n3. Bat dau nhan va chuyen tien cho merchant nhanh hon voi trai nghiem Hold Pay.";
    const toolChatCopyMapped = mapper.mapHermesCmoResponseToChatResult({
      ...toolChatBase,
      response: {
        ...toolChatBase.response,
        schema_version: "hermes.cmo.tool_response.v1",
        mode: "cmo.tool_capable",
        answer_basis: {
          ...toolChatBase.response.answer_basis,
          mode: "native_conversation",
        },
        answer: {
          format: "markdown",
          title: "Notification variants",
          summary: "Echo-assisted copy variants.",
          decision: "KEEP",
          body: toolChatCopyBody,
        },
        structured_output: {
          classification: "native_conversation",
          response_style: "native_conversation",
          tool_policy: "cmo_internal_tools",
        },
        tools_used: ["cmo_call_echo"],
      },
      delegationSummary: [
        {
          delegationKey: "echo:cmo_call_echo",
          delegationId: "del_tool_chat_echo",
          targetAgent: "echo",
          mode: "echo.default",
          objective: "Draft merchant onboarding notifications.",
          status: "completed",
          summary: "Echo returned notification variants.",
          response: {
            schema_version: "echo.response.v1",
            raw_json: { should_not_leak: true },
          },
        },
      ],
      safety_counters: {
        ...toolChatBase.safety_counters,
        echoCalls: 1,
      },
      echoCalls: 1,
      agentsUsed: ["cmo", "echo"],
    });
    assert.equal(toolChatCopyMapped.hermesCmoMetadata.endpoint_kind, "tool_execute");
    assert.equal(toolChatCopyMapped.hermesCmoMetadata.cmo_call_echo_used, true);
    assert.deepEqual(toolChatCopyMapped.hermesCmoMetadata.tools_used, ["cmo_call_echo"]);
    assert.equal(toolChatCopyMapped.hermesCmoMetadata.surfCalls, 0);
    assert.equal(toolChatCopyMapped.hermesCmoMetadata.echoCalls, 1);
    assert.deepEqual(toolChatCopyMapped.hermesCmoMetadata.forbiddenCounters, forbiddenZeroCounters);
    assert.equal(toolChatCopyMapped.hermesCmoMetadata.sideEffects, false);
    assert.equal(toolChatCopyMapped.answer, toolChatCopyBody);
    assert.match(toolChatCopyMapped.answer, /1\./);
    assert.match(toolChatCopyMapped.answer, /2\./);
    assert.match(toolChatCopyMapped.answer, /3\./);
    assert.deepEqual([...toolChatCopyMapped.answer.matchAll(/(^|\n)(\d+)\./g)].map((match) => match[2]), ["1", "2", "3"]);
    assert.doesNotMatch(toolChatCopyMapped.answer, /cmo_call_echo|Echo returned|tools_used|raw_json|schema_version|\{|\}/i);

    const toolChatStrategyMapped = mapper.mapHermesCmoResponseToChatResult({
      ...toolChatBase,
      response: {
        ...toolChatBase.response,
        schema_version: "hermes.cmo.tool_response.v1",
        mode: "cmo.tool_capable",
        answer_basis: {
          ...toolChatBase.response.answer_basis,
          mode: "fully_grounded",
        },
        answer: {
          format: "markdown",
          title: "Strategic priority",
          summary: "Use current context only.",
          decision: "KEEP",
          body: "Neu chi dua tren boi canh hien tai, Hold Pay nen uu tien merchant payout UX truoc. Huong nay gan voi niem tin van hanh, co the do luong bang thoi gian xu ly va ty le loi, va tao nen ly do ro rang de merchant quay lai.",
        },
        structured_output: {
          classification: "strategy_only",
          response_style: "strategy_answer",
          tool_policy: "none",
        },
        tools_used: [],
      },
      delegationSummary: [],
      safety_counters: { ...expectedCounters },
      surfCalls: 0,
      echoCalls: 0,
      agentsUsed: ["cmo"],
    });
    assert.equal(toolChatStrategyMapped.hermesCmoMetadata.endpoint_kind, "tool_execute");
    assert.equal(toolChatStrategyMapped.hermesCmoMetadata.tool_capable_cmo, true);
    assert.equal(toolChatStrategyMapped.hermesCmoMetadata.cmo_call_surf_used, undefined);
    assert.equal(toolChatStrategyMapped.hermesCmoMetadata.cmo_call_echo_used, undefined);
    assert.equal(toolChatStrategyMapped.hermesCmoMetadata.surfCalls, 0);
    assert.equal(toolChatStrategyMapped.hermesCmoMetadata.echoCalls, 0);
    assert.equal(toolChatStrategyMapped.hermesCmoMetadata.tools_used, undefined);
    assert.deepEqual(toolChatStrategyMapped.hermesCmoMetadata.forbiddenCounters, forbiddenZeroCounters);
    assert.equal(toolChatStrategyMapped.hermesCmoMetadata.sideEffects, false);
    assert.match(toolChatStrategyMapped.answer, /merchant payout UX/);
    assert.doesNotMatch(toolChatStrategyMapped.answer, /cmo_call_surf|cmo_call_echo|tools_used|raw_json|schema_version|\{|\}/i);

    const noForbiddenToolOrchestrationSideEffects = [
      toolChatResearchMapped,
      toolChatCopyMapped,
      toolChatStrategyMapped,
    ].every((result) => Object.entries(forbiddenZeroCounters).every(([key, value]) =>
      result.hermesCmoMetadata.forbiddenCounters?.[key] === value,
    ));
    toolOrchestrationSmoke = {
      routeCanaryEndpoint: "/agents/cmo/tool-execute",
      researchUsesSurf: toolChatResearchMapped.hermesCmoMetadata.cmo_call_surf_used === true,
      copyUsesEcho: toolChatCopyMapped.hermesCmoMetadata.cmo_call_echo_used === true,
      strategyUsesNoSpecialist: toolChatStrategyMapped.hermesCmoMetadata.surfCalls === 0 && toolChatStrategyMapped.hermesCmoMetadata.echoCalls === 0,
      researchAnswerEqualsHermesBody: toolChatResearchMapped.answer === toolChatResearchBody,
      copyAnswerEqualsHermesBody: toolChatCopyMapped.answer === toolChatCopyBody,
      copyNumberedListMarkers: [...toolChatCopyMapped.answer.matchAll(/(^|\n)(\d+)\./g)].map((match) => match[2]),
      researchAnswerHidesToolMechanics: !/cmo_call_surf|tools_used|raw_json|schema_version|\{|\}/i.test(toolChatResearchMapped.answer),
      copyAnswerHidesToolMechanics: !/cmo_call_echo|tools_used|raw_json|schema_version|\{|\}/i.test(toolChatCopyMapped.answer),
      strategyAnswerHidesToolMechanics: !/cmo_call_surf|cmo_call_echo|tools_used|raw_json|schema_version|\{|\}/i.test(toolChatStrategyMapped.answer),
      noForbiddenSideEffects: noForbiddenToolOrchestrationSideEffects,
      rawRuntimePathUsesCanonicalUser: longSessionStressSmoke?.runtimeRawLogPathUsesCanonicalUser === true,
      rawRuntimePathContainsUuid: longSessionStressSmoke?.runtimeRawLogPathContainsUuid === true,
    };
    assert.equal(toolOrchestrationSmoke.noForbiddenSideEffects, true);
    assert.equal(toolOrchestrationSmoke.rawRuntimePathUsesCanonicalUser, true);
    assert.equal(toolOrchestrationSmoke.rawRuntimePathContainsUuid, false);

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
    assert.equal(strategyOnlyReviewMapped.answer, "Legacy strategy_only review body stays structured.");
    assert.doesNotMatch(strategyOnlyReviewMapped.answer, /CMO strategic response|Decision:|REVIEW/);

    const redactedCreativeBodyBase = makeRuntimeResult();
    const redactedCreativeBodyMapped = mapper.mapHermesCmoResponseToChatResult({
      ...redactedCreativeBodyBase,
      request: {
        constraints: {},
        input: {},
      },
      response: {
        ...redactedCreativeBodyBase.response,
        answer_basis: {
          ...redactedCreativeBodyBase.response.answer_basis,
          mode: "creative_session",
        },
        answer: {
          ...redactedCreativeBodyBase.response.answer,
          body: "[hermes_local_artifact_path_redacted]/creative/session/msg_creative_prompt_assistant_1/output.png",
          summary: "",
        },
        suggested_creative_state_update: {
          active_draft_id: "creative_draft_prompt_001",
          drafts_upsert: [
            {
              draft_id: "creative_draft_prompt_001",
              kind: "image",
              prompt: "21:9 cinematic onboarding hero for Hold Pay merchant checkout.",
              status: "ready",
            },
          ],
        },
      },
    });
    assert.match(redactedCreativeBodyMapped.answer, /Prompt: 21:9 cinematic onboarding hero for Hold Pay merchant checkout\./);
    assert.doesNotMatch(redactedCreativeBodyMapped.answer, /\[hermes_local_artifact_path_redacted\]/, "redacted artifact body must not become canonical mapped assistant content");
    const embeddedRedactedAnswer = mapper.sanitizeHermesCmoMappedChatResult({
      ...redactedCreativeBodyMapped,
      answer: [
        "Creative prompt proposal:",
        "Use a wide merchant checkout scene.",
        "[hermes_local_artifact_path_redacted]/creative/session/msg_creative_prompt_assistant_1/output.png",
      ].join("\n"),
    });
    assert.equal(embeddedRedactedAnswer.answer, "Creative prompt proposal:\nUse a wide merchant checkout scene.");
    assert.doesNotMatch(embeddedRedactedAnswer.answer, /\[hermes_local_artifact_path_redacted\]/, "embedded redacted artifact paths must be stripped from canonical assistant content");

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
    assert.match(source, /const hermesCmoCreativeExecutionRequested = hermesCmoRoute\.reason === "creative_execution"/);
    assert.match(source, /hermesCmoRoute\.endpointKind === "tool_execute" \|\|\s*hermesCmoCreativeExecutionRequested/);
    assert.match(source, /shouldUseHermesCmoChat\(request\.appId\)/);
    assert.match(source, /runHermesCmoChatV11\(\{/);
    assert.match(source, /runHermesCmoRuntime\(hermesRequest\)/);
    assert.match(source, /const hermesFallbackRequest = mapCmoChatToHermesCmoRequest\(\{/);
    assert.match(source, /const hermesFallbackResult = await runHermesCmoRuntime\(hermesFallbackRequest\)/);
    assert.match(source, /creativeWorkspaceFallbackSuppressed/);
    assert.match(source, /chatResult\.fallbackEligible && hermesCmoRoute\.fallbackEnabled && !creativeWorkspaceFallbackSuppressed/);
    assert.match(source, /safeBlockedUserVisibleAnswer\(true\)/);
    assert.match(source, /workspace_fallback_suppressed_for_creative: true/);
    assert.match(source, /answer = mappedHermesFallbackResult\.answer/);
    assert.match(source, /fallback_used: true/);
    assert.match(source, /fallback_from: fallbackTrace\.fallback_from/);
    assert.match(source, /fallback_to: fallbackTrace\.fallback_to/);
    assert.match(source, /writeHermesCmoChatV11FallbackTrace\(chatResult\.request/);
    assert.match(source, /answer = mappedChat\.answer/);
    assert.match(source, /answer = creativeContractViolation \? PRODUCT_CREATIVE_CONTRACT_VIOLATION_MESSAGE : mappedHermesResult\.answer/);
    assert.match(source, /userVisibleAnswerPathLike\(answer\)/);
    assert.match(source, /user_visible_answer_guard_triggered: true/);
    assert.match(source, /user_visible_answer_guard_reason: guardReason/);
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
    assert.match(source, /schema_version: dryRunResult\.schema_version/);
    assert.match(source, /approval_id: dryRunResult\.approval_id/);
    assert.match(source, /idempotency_key: dryRunResult\.idempotency_key/);
    assert.match(source, /approval_payload_hash: dryRunResult\.approval_payload_hash/);
    assert.match(source, /write_allowed: dryRunResult\.write_allowed/);
    assert.match(source, /target_preview: dryRunResult\.target_preview/);
    assert.match(source, /frontmatter_preview: dryRunResult\.frontmatter_preview/);
    assert.match(source, /body_preview: dryRunResult\.body_preview/);
    assert.match(source, /side_effects: dryRunResult\.side_effects/);
    assert.match(source, /candidateString\(item, \["message"\]/);
    assert.match(source, /candidateString\(item, \["type"\]/);
    assert.match(source, /JSON\.stringify\(safe\)/);
    assert.match(source, /value\.status === "rejected"/);
    assert.match(source, /completedWithoutWriteProof/);
    assert.match(source, /write_not_performed/);
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
    const assistantMarkdownDisplaySource = await readFile(path.join(cmoDir, "assistant-markdown-display.ts"), "utf8");
    assert.match(cmoChatPanelSource, /Suggested Updates/);
    assert.match(cmoChatPanelSource, /Approve/);
    assert.match(cmoChatPanelSource, /Reject/);
    assert.match(cmoChatPanelSource, /Defer/);
    assert.match(cmoChatPanelSource, /Preview Save/);
    assert.match(cmoChatPanelSource, /Save Draft/);
    assert.match(cmoChatPanelSource, /Preview ready\./);
    assert.match(cmoChatPanelSource, /Saved\./);
    assert.match(cmoChatPanelSource, /Already saved\./);
    assert.match(cmoChatPanelSource, /Save failed\./);
    assert.match(cmoChatPanelSource, /Needs review before saving\./);
    assert.match(cmoChatPanelSource, /Using approved workspace context\./);
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
    assert.match(cmoChatPanelSource, /canWriteVaultUpdate/);
    assert.match(cmoChatPanelSource, /session\?\.vaultUpdateApprovalEvents/);
    assert.match(cmoChatPanelSource, /session\?\.vaultUpdateDryRunResults/);
    assert.match(cmoChatPanelSource, /session\?\.vaultUpdateWriteResults/);
    assert.match(cmoChatPanelSource, /renderDryRunResult\(\{ result: dryRunResult, approvalId, writeResult, canWrite \}\)/);
    assert.match(cmoChatPanelSource, /dryRunResult\.write_allowed === true/);
    assert.match(cmoChatPanelSource, /dryRunResult\.vault_write_performed === false/);
    assert.match(cmoChatPanelSource, /!writeResult\?\.conflict/);
    assert.match(cmoChatPanelSource, /canWrite \? \(/);
    assert.match(cmoChatPanelSource, /dryRunSemanticState/);
    assert.match(cmoChatPanelSource, /writeResultSemanticState/);
    assert.match(cmoChatPanelSource, /const planAllowed = result\.write_allowed && !\(result\.errors\?\.length\)/);
    assert.doesNotMatch(cmoChatPanelSource, /const targetPreview =/);
    assert.doesNotMatch(cmoChatPanelSource, /const frontmatterPreview =/);
    assert.doesNotMatch(cmoChatPanelSource, /const bodyPreview =/);
    assert.doesNotMatch(cmoChatPanelSource, /dry_run=true/);
    assert.doesNotMatch(cmoChatPanelSource, /vault_write_performed=false/);
    assert.doesNotMatch(cmoChatPanelSource, /write_allowed=\{String\(planAllowed\)\}/);
    assert.doesNotMatch(cmoChatPanelSource, /result\.vault_path/);
    assert.doesNotMatch(cmoChatPanelSource, /result\.content_hash/);
    assert.doesNotMatch(cmoChatPanelSource, /result\.gbrain_index/);
    assert.doesNotMatch(cmoChatPanelSource, /result\.promotion_performed/);
    assert.match(cmoChatPanelSource, /assistantDisplayMarkdown/);
    assert.match(assistantMarkdownDisplaySource, /function isBackendContextLine/);
    assert.match(assistantMarkdownDisplaySource, /normalizeRepeatedOrderedListStartsForDisplay/);
    assert.match(assistantMarkdownDisplaySource, /90 Runtime\|sha256:/);
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
    assert.match(hermesRuntimeSource, /toolChatCanaryEnabled \|\| \(toolEndpointEnabled && \(externalResearch \|\| requestIsSourceBackedOrSeeking/);
    assert.match(hermesRuntimeSource, /isCmoHermesCmoToolChatEnabled/);
    assert.match(hermesRuntimeSource, /getCmoHermesCmoToolChatCanaryApps/);
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
    assert.match(hermesChatV11Source, /writeHermesCmoChatV11Trace\(finalOutboundRequest, "request"/);
    assert.match(hermesChatV11Source, /writeHermesCmoChatV11Trace\(finalOutboundRequest, "response"/);
    assert.match(hermesChatV11Source, /writeHermesCmoChatV11Trace\(finalOutboundRequest, "error"/);
    assert.match(hermesChatV11Source, /writeHermesCmoChatV11FallbackTrace/);
    assert.match(hermesChatV11Source, /vault_agent\.raw_activity_log_result\.v1/);
    assert.match(hermesChatV11Source, /90 Runtime\/Raw Activity\//);
    assert.match(hermesChatV11Source, /rawActivityLogReceiptIsSafe/);
    assert.match(hermesChatV11Source, /accepted_knowledge_write/);
    assert.match(hermesChatV11Source, /raw_runtime_write/);

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
    assert.match(appChatStoreSource, /userDisplayName/);
    assert.match(appChatStoreSource, /userSlug/);
    assert.match(
      appChatStoreSource,
      /PRODUCT_OUTBOUND_CREATIVE_CONTEXT_BLOCKED_MESSAGE =\s*\n\s*"Product blocked this Creative follow-up because old workspace\/session context still contains redacted artifact text\. Please retry after context scrub or start a clean session\."/,
      "Product-local outbound guard block must use safe user-facing Creative copy",
    );
    assert.match(
      appChatStoreSource,
      /productOutboundCreativeContextBlocked[\s\S]*hermesRequestSent = false;[\s\S]*workspace_fallback_suppressed_for_creative: true/,
      "Product-local outbound guard block must not report a Hermes request or use workspace fallback",
    );
    assert.match(
      appChatStoreSource,
      /productOutboundCreativeContextBlocked[\s\S]*runtimeLabel = "Product Creative outbound guard"[\s\S]*runtimeProvider = "product"/,
      "Product-local outbound guard block must not be rendered as a Hermes unusable-response failure",
    );
    assert.match(
      appChatStoreSource,
      /creativeContractViolationMetadata[\s\S]*hermes_returned_execution_when_execution_forbidden/,
      "Product must detect Hermes execution responses when the request contract forbids execution",
    );
    assert.match(
      appChatStoreSource,
      /creativeContractViolation \? \[\] : creativeAssetsFromHermesPayload/,
      "Product must not accept Creative assets when Hermes violates a non-mutating request contract",
    );
    assert.match(
      appChatStoreSource,
      /PRODUCT_CREATIVE_CONTRACT_VIOLATION_MESSAGE/,
      "Product must surface a Product-local Creative contract violation instead of showing generated assets",
    );
    assert.match(
      appChatStoreSource,
      /productOutboundCreativeContextBlocked[\s\S]*activeCreativeAssetId \? \{ active_creative_asset_id: activeCreativeAssetId \}/,
      "Product-local outbound guard block must preserve the active Creative asset metadata",
    );

    const userMetadataSource = await readFile(path.join(cmoDir, "user-metadata.ts"), "utf8");
    assert.match(userMetadataSource, /normalizeCmoRuntimeUserIdentity/);
    assert.match(userMetadataSource, /UNKNOWN_RUNTIME_USER_SLUG = "unknown_user"/);
    assert.match(userMetadataSource, /buildCmoRuntimeUserPath/);
    assert.match(userMetadataSource, /90 Runtime\/Raw Activity/);
    assert.match(userMetadataSource, /90 Runtime\/Daily Notes/);
    assert.match(userMetadataSource, /90 Runtime\/Weekly Notes/);
    assert.match(userMetadataSource, /90 Runtime\/Monthly Rollups/);
    assert.match(userMetadataSource, /withoutUserPrefix/);
    assert.match(userMetadataSource, /cmoRuntimeUserDisplayNameFromProfile/);
    assert.match(userMetadataSource, /User \$\{suffix\}/);

    const authSource = await readFile(path.join(cmoDir, "auth.ts"), "utf8");
    assert.match(authSource, /userSlug: string \| null/);
    assert.match(authSource, /\.from\("profiles"\)/);
    assert.match(authSource, /\.select\("id,email,display_name"\)/);
    assert.match(authSource, /profileDisplayName/);
    assert.match(authSource, /metadataDisplayName/);
    assert.match(authSource, /cmoRuntimeUserDisplayNameFromProfile/);
    assert.match(authSource, /cmoRuntimeUserSlugFromProfile/);
    assert.doesNotMatch(authSource, /\.select\("id,email,display_name,slug"\)/);
    assert.match(authSource, /\["full_name", "name", "display_name", "user_display_name"\]/);

    const sourceAcquisitionSource = await readFile(path.join(cmoDir, "source-acquisition", "index.ts"), "utf8");
    assert.match(sourceAcquisitionSource, /normalizeCmoRuntimeUserIdentity/);
    assert.match(sourceAcquisitionSource, /user_slug: runtimeUser\.user_slug/);
    assert.match(sourceAcquisitionSource, /email: runtimeUser\.email/);

    const vaultAutoCaptureSource = await readFile(path.join(cmoDir, "vault-auto-capture.ts"), "utf8");
    assert.match(vaultAutoCaptureSource, /normalizeCmoRuntimeUserIdentity/);
    assert.match(vaultAutoCaptureSource, /userSlug: runtimeUser\.user_slug/);
    assert.match(vaultAutoCaptureSource, /user_display_name: runtimeUser\.user_display_name/);
    assert.match(vaultAutoCaptureSource, /workspaceId:\s*ctx\.request\.workspaceId/);
    assert.doesNotMatch(vaultAutoCaptureSource, /workspaceId:\s*ctx\.request\.appId/);
    assert.doesNotMatch(vaultAutoCaptureSource, /userSlug: ctx\.request\.workspaceId|userSlug: ctx\.request\.appId|userSlug: ctx\.userIdentity\?\.organizationId/);

    const mapperSource = await readFile(path.join(cmoDir, "hermes-cmo-chat-mapper.ts"), "utf8");
    assert.match(mapperSource, /sessionLocalResearchResultArtifacts/);
    assert.match(mapperSource, /research_context/);
    assert.match(mapperSource, /research_followup_requested/);
    assert.match(mapperSource, /cmo_call_surf/);
    assert.match(mapperSource, /cmo_call_echo/);
    assert.match(mapperSource, /tool_capable_cmo/);
    assert.match(mapperSource, /isMachineWrapperCreativeDraftText/);
    assert.match(mapperSource, /metadata\?\.product_contract_violation === true/);
    assert.match(mapperSource, /typeof message\.content !== "string" \|\| !message\.content\.trim\(\)/);

    const configSource = await readFile(path.join(cmoDir, "config.ts"), "utf8");
    assert.match(configSource, /CMO_HERMES_CMO_TOOL_CHAT_ENABLED/);
    assert.match(configSource, /CMO_HERMES_CMO_TOOL_CHAT_CANARY_APPS/);

    const workspaceTypesSource = await readFile(path.join(cmoDir, "app-workspace-types.ts"), "utf8");
    assert.match(workspaceTypesSource, /sourceMode\?: "cmo\.default" \| "cmo\.tool_capable" \| HermesCmoExecutableMode/);
    assert.match(workspaceTypesSource, /CmoSessionLocalResearchResult/);
    assert.match(workspaceTypesSource, /sideEffects\?: false \| Record<string, boolean>/);
    assert.match(workspaceTypesSource, /side_effects\?: false \| Record<string, boolean>/);
    assert.match(workspaceTypesSource, /write_side_effects\?: false \| Record<string, boolean>/);
    assert.match(workspaceTypesSource, /requested_endpoint\?: string/);
    assert.match(workspaceTypesSource, /tool_capable_cmo\?: boolean/);
    assert.match(workspaceTypesSource, /cmo_call_surf_used\?: boolean/);
    assert.match(workspaceTypesSource, /cmo_call_echo_used\?: boolean/);
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
          allWorkspaceToolChatRoutes,
          runtimeUserIdentitySmoke,
          rollingReplaySmoke,
          longSessionStressSmoke,
          toolOrchestrationSmoke,
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
