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
    workspaceId: "holdstation",
    appId: "holdstation-mini-app",
    sourceId: "holdstation:holdstation-mini-app",
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
    workspaceId: "holdstation",
    sourceId: "holdstation:holdstation-mini-app",
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
    workspaceId: "holdstation",
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
  mode: "review_only",
  tenant_id: "holdstation",
  workspace_id: "holdstation-mini-app",
  user_id: "user_h6",
  session_id: "session_h6",
  request_id: "msg_001",
  source: {
    source_id: "source_review_fixture",
    source_type: "url",
    source_title: "Fixture source",
  },
  extraction: {
    status: "completed",
    content_hash: "hash_fixture",
    source_text: "Fixture source text",
    extracted_summary: "Fixture source summary",
    detected_language: "en",
    warnings: [],
    errors: [],
  },
  safety: {
    read_only: true,
    vault_mutation: false,
    gbrain_mutation: false,
    no_promotion: true,
  },
};
sampleTurnInput.contextPack.sourceReviewContext = sampleTurnInput.contextPackage.sourceReviewContext;

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
    assert.equal(hermesRequest.context_pack.source_review_context.safety.vault_mutation, false);
    assert.equal(hermesRequest.context_pack.source_review_context.safety.gbrain_mutation, false);
    assert.ok(hermesRequest.context_pack.artifacts_in.some((artifact) => artifact.type === "source_review_context"), "source review context must be passed as a read-only artifact");
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
    assert.equal(hermesRequest.constraints.delegations_mode, "proposals_only");
    assert.deepEqual(hermesRequest.constraints.allowed_agents, ["echo", "surf"]);

    const mapped = mapper.mapHermesCmoResponseToChatResult(makeRuntimeResult());
    assert.equal(mapped.runtimeStatus, "live");
    assert.equal(mapped.runtimeMode, "live");
    assert.equal(mapped.runtimeProvider, "hermes");
    assert.equal(mapped.runtimeAgent, "cmo");
    assert.equal(mapped.calledHermesCmo, true);
    assert.equal(mapped.hermesCmoMetadata.runtimeMode, "hermes_cmo");
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
    assert.match(source, /shouldUseHermesCmoChat\(request\.appId\)/);
    assert.match(source, /runHermesCmoRuntime\(hermesRequest\)/);
    assert.match(source, /failed_then_existing_fallback/);
    assert.match(source, /guardrail_violation_then_existing_fallback/);

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
