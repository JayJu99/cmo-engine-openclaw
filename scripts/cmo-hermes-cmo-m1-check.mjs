import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const runtimeSourcePath = path.join(rootDir, "src", "lib", "cmo", "hermes-cmo-runtime.ts");
const executorSourcePath = path.join(rootDir, "src", "lib", "cmo", "hermes-cmo-delegation-executor.ts");
const kernelSourcePath = path.join(rootDir, "src", "lib", "cmo", "hermes-cmo-skill-kernel.ts");

const forbiddenCounters = {
  vaultAgentCalls: 0,
  vaultWrites: 0,
  openclawCalls: 0,
  directSupabaseMutations: 0,
};

const signalTopics = [
  "World App Mini App",
  "World Mini Apps",
  "trading mini app",
  "mini app trading",
  "World Chain trading",
  "Holdstation",
];
const translationSourceMaterial = [
  "POST 1: Build the first activation proof before you scale the campaign.",
  "POST 2: Show the Mini App action that creates value in one step.",
  "POST 3: Keep claims tight until the activation evidence is visible.",
];
const holdPayFaqUrl = "https://docs.holdstation.com/holdstation/holdstation-pay/holdstation-pay-faq";

const sampleRequest = {
  schema_version: "hermes.cmo.request.v1",
  request_id: "req_m1_cmo_001",
  session_id: "session_m1_cmo",
  turn_id: "turn_m1_cmo_001",
  created_at: "2026-05-28T11:00:00+07:00",
  workspace: {
    workspace_id: "world-app-holdstation-mini-app",
    app_id: "holdstation-mini-app",
    app_name: "Holdstation Mini App",
  },
  user: {
    user_id: "server_derived_user_id",
    display_name: "Jay",
  },
  intent: {
    mode: "cmo.default",
    user_message:
      "Research the activation evidence gaps for Holdstation Mini App, then create 3 short X posts based on the safest angle.",
    explicit_command: null,
  },
  context_pack: {
    current_priority: [],
    selected_context: [],
    recent_session_summary: null,
    indexed_context_supplement: [],
    artifacts_in: [],
  },
  constraints: {
    no_direct_vault_write: true,
    no_direct_memory_mutation: true,
    vault_agent_delegation_allowed: false,
    vault_agent_requires_save_intent: true,
    kanban_enabled: false,
    demo_mode: true,
    allowed_agents: ["echo", "surf"],
    allowed_surf_modes: ["surf.default", "surf.x", "surf.trend", "surf.pulse"],
  },
  ui: {
    activity_stream_required: true,
    heartbeat_required: true,
  },
};

const m44dToolEndpointRequest = (requestId) => ({
  ...sampleRequest,
  request_id: requestId,
  session_id: requestId.replace(/^req_/, "session_"),
  turn_id: `${requestId.replace(/^req_/, "turn_")}_001`,
  workspace: {
    ...sampleRequest.workspace,
    workspace_id: "hold-pay",
    app_id: "hold-pay",
    app_name: "Hold Pay",
  },
  intent: {
    ...sampleRequest.intent,
    user_message: `Summarize this source: ${holdPayFaqUrl}`,
  },
  context_pack: {
    ...sampleRequest.context_pack,
    active_source_id: "source_hold_pay_faq",
    artifacts_in: [
      {
        type: "session_local_source",
        schema_version: "cmo.session_local_source.v1",
        workspace_id: "hold-pay",
        source_id: "source_hold_pay_faq",
        source_type: "url",
        source_title: "Holdstation Pay FAQ",
        original_url: holdPayFaqUrl,
        canonical_url: holdPayFaqUrl,
        read_depth: "partial",
        cache_role: "fallback_only",
        nav_heavy: true,
        tool_read_recommended: true,
        saved_to_vault: false,
        no_auto_promote: true,
      },
    ],
  },
  source_acquisition: {
    schema_version: "cmo.source_acquisition_role.v1",
    chat_role: "cache_fallback_context_provider",
    original_url: holdPayFaqUrl,
    canonical_url: holdPayFaqUrl,
    tool_read_recommended: true,
    read_depth: "partial",
    cache_role: "fallback_only",
    nav_heavy: true,
    saved_to_vault: false,
    no_auto_promote: true,
  },
});

const m13CreativeExecutionRequest = (requestId) => ({
  ...sampleRequest,
  request_id: requestId,
  session_id: requestId.replace(/^req_/, "session_"),
  turn_id: `${requestId.replace(/^req_/, "turn_")}_001`,
  workspace: {
    ...sampleRequest.workspace,
    workspace_id: "hold-pay",
    app_id: "hold-pay",
    app_name: "Hold Pay",
  },
  intent: {
    mode: "cmo.default",
    user_message: "Generate a square PNG image for Hold Pay merchant onboarding.",
    explicit_command: "creative.generate_image",
  },
  input: {
    creative_execution_intent: {
      requested: true,
      agent: "creative",
      mode: "creative.generate_image",
      return_local_paths: true,
      include_metadata: true,
    },
  },
  constraints: {
    ...sampleRequest.constraints,
    creative_execution_requested: true,
    creative_execution_mode: "creative.generate_image",
  },
  tool_policy: {
    creative_execution_requested: true,
    creative_execution_mode: "creative.generate_image",
  },
});

const m13CmoOwnedCreativeSessionExecutionRequest = (requestId) => ({
  ...sampleRequest,
  request_id: requestId,
  session_id: requestId.replace(/^req_/, "session_"),
  turn_id: `${requestId.replace(/^req_/, "turn_")}_001`,
  workspace: {
    ...sampleRequest.workspace,
    workspace_id: "hold-pay",
    app_id: "hold-pay",
    app_name: "Hold Pay",
  },
  intent: {
    ...sampleRequest.intent,
    user_message: "Doi tone cam trang va nen sang hon tu anh dang co.",
    explicit_command: null,
  },
  creative_working_state: {
    active_draft_id: "creative_draft_fixture",
    active_asset_id: "creative_source_fixture",
    drafts: [
      {
        draft_id: "creative_draft_fixture",
        kind: "image",
        title: "Fixture draft",
        prompt: "Edit source image with orange and white tone.",
        status: "draft",
      },
    ],
    assets: [
      {
        asset_id: "creative_source_fixture",
        kind: "image",
        status: "stored",
        mime_type: "image/png",
        bytes: 2048,
        sha256: "5656565656565656565656565656565656565656565656565656565656565656",
      },
    ],
  },
  reference_assets: [
    {
      asset_id: "creative_source_fixture",
      kind: "image",
      role: "source_image",
      mime_type: "image/png",
      bytes: 2048,
      sha256: "5656565656565656565656565656565656565656565656565656565656565656",
      fetch_url: "https://cmo.jayju.cloud/api/cmo/apps/hold-pay/creative/assets/creative_source_fixture/download",
    },
  ],
  constraints: {
    ...sampleRequest.constraints,
    creative_execution_requested: false,
    creative_long_running_turn: true,
    creative_working_state_present: true,
    active_creative_asset_id: "creative_source_fixture",
    creative_assets_count: 1,
    cmo_owns_creative_decision: true,
  },
  tool_policy: {
    creative_execution_requested: false,
    creativeDecisionOwnerWhenLive: "hermes_cmo",
  },
  artifact_transport: {
    mode: "product_upload",
    upload_endpoint: "https://cmo.jayju.cloud/api/cmo/apps/hold-pay/creative/artifact-ingest",
    workspace_id: "hold-pay",
    app_id: "hold-pay",
    request_id: requestId,
    accepted_mime_types: ["image/png", "image/jpeg", "image/webp", "video/mp4", "video/webm"],
    max_bytes: 52428800,
  },
});

const m13PollutedCmoOwnedCreativeSessionExecutionRequest = (requestId) => {
  const request = m13CmoOwnedCreativeSessionExecutionRequest(requestId);

  return {
    ...request,
    messages: [
      {
        role: "assistant",
        content: "[hermes_local_artifact_path_redacted]/_crystal_egg_21x9.png_redact",
        message_id: "assistant_polluted",
        created_at: "2026-06-20T00:00:00.000Z",
      },
      {
        role: "user",
        content: "Nhìn hướng này có bị hiền quá không?",
        message_id: "user_followup",
        created_at: "2026-06-20T00:00:01.000Z",
      },
    ],
    context_pack: {
      ...request.context_pack,
      selected_context: [
        {
          content: "[hermes_local_artifact_path_redacted]/pearl_m_t_qu_tr_ng.webp",
          full_content: "/tmp/cmo-creative-execute/conversion_h_123/reference_assets/image.jpg",
        },
      ],
      recent_session_summary: "assistant: [hermes_local_artifact_path_redacted]/accent_teal_quanh_egg_v_CTA_area.png",
      all_context_items: [
        {
          content: "[hermes_local_artifact_path_redacted]/Content_Notes.md_Quality_missing.png_redact",
          contentPreview: "/home/cmo/creative-agent-images/card.jpeg",
        },
        {
          content: "C:\\cmo-creative-execute\\conversion_h_123\\local.webp",
          contentPreview: "/var/tmp/cmo-creative-execute/card.png_redact",
        },
      ],
      missing_context: [
        {
          contentPreview: "missing context points at /mnt/data/cmo-creative-execute/output.webp",
        },
      ],
      context_used: [
        {
          contentPreview: "local preview [hermes_local_artifact_path_redacted]/codex-imagen-123.png_redact",
        },
      ],
      creative_working_state: {
        ...request.creative_working_state,
        assets: request.creative_working_state.assets.map((asset) => ({
          ...asset,
          preview_url: "[hermes_local_artifact_path_redacted]/preview.png_redact",
          render_url: "[hermes_local_artifact_path_redacted]/render.png",
          signed_url: "/tmp/cmo-creative-execute/signed.png",
        })),
      },
    },
    input: {
      ...request.input,
      creative_working_state: {
        ...request.creative_working_state,
        assets: request.creative_working_state.assets.map((asset) => ({
          ...asset,
          render_url: "[hermes_local_artifact_path_redacted]/nested.png",
        })),
      },
    },
    creative_working_state: {
      ...request.creative_working_state,
      assets: request.creative_working_state.assets.map((asset) => ({
        ...asset,
        preview_url: "[hermes_local_artifact_path_redacted]/preview.png_redact",
        render_url: "[hermes_local_artifact_path_redacted]/render.png",
        signed_url: "/tmp/cmo-creative-execute/signed.png",
      })),
    },
    reference_assets: request.reference_assets.map((asset) => ({
      ...asset,
      preview_url: "[hermes_local_artifact_path_redacted]/reference-preview.png",
      render_url: "/tmp/cmo-creative-execute/reference-render.jpg",
    })),
  };
};

const m13CallsiteGuardBlockedCreativeSessionRequest = (requestId) => {
  const request = m13CmoOwnedCreativeSessionExecutionRequest(requestId);

  return {
    ...request,
    context_pack: {
      ...request.context_pack,
      "[hermes_local_artifact_path_redacted]": true,
    },
  };
};

const m13CreativeConversationResponse = (request, action = "advise", body = "This direction is not too soft; keep the softer tone but increase contrast in the headline and product moment.", overrides = {}) => ({
  schema_version: "hermes.cmo.response.v1",
  request_id: request.request_id,
  session_id: request.session_id,
  turn_id: request.turn_id,
  status: "completed",
  response_status: "completed",
  answer_basis: {
    mode: "creative_conversation",
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
    title: "Creative advice",
    summary: "Non-mutating Creative conversation response.",
    decision: action,
    body,
  },
  structured_output: {
    classification: "creative_conversation",
    response_style: "creative_conversation",
  },
  creative_decision: {
    action,
    operation: "creative.answer_about_asset",
  },
  creative_assets_count: 0,
  creative_asset_mutation: false,
  creative_state_mutation: false,
  creative_assets: [],
  artifacts: [],
  delegations: [],
  memory_suggestions: [],
  activity_summary: {
    events_count: 0,
    final_state: "completed",
  },
  ...overrides,
});

const m44eExternalResearchRequest = (requestId, userMessage = "Hiện tại trên thị trường có bên nào làm giống Feeback mình không?") => ({
  ...m44dToolEndpointRequest(requestId),
  workspace: {
    ...sampleRequest.workspace,
    workspace_id: "feeback",
    app_id: "feeback",
    app_name: "Feeback",
  },
  intent: {
    ...sampleRequest.intent,
    user_message: userMessage,
  },
  context_pack: {
    ...m44dToolEndpointRequest(requestId).context_pack,
    active_source_id: "source_feeback_home",
    artifacts_in: [
      {
        type: "session_local_source",
        schema_version: "cmo.session_local_source.v1",
        workspace_id: "feeback",
        source_id: "source_feeback_home",
        source_type: "url",
        source_title: "Feeback home",
        original_url: "https://feeback.org",
        canonical_url: "https://feeback.org",
        read_depth: "partial",
        cache_role: "fallback_only",
        nav_heavy: true,
        tool_read_recommended: true,
        saved_to_vault: false,
        no_auto_promote: true,
      },
    ],
  },
  source_acquisition: {
    schema_version: "cmo.source_acquisition_role.v1",
    chat_role: "cache_fallback_context_provider",
    original_url: "https://feeback.org",
    canonical_url: "https://feeback.org",
    tool_read_recommended: true,
    read_depth: "partial",
    cache_role: "fallback_only",
    nav_heavy: true,
    saved_to_vault: false,
    no_auto_promote: true,
  },
});

const m44e6ResearchFollowupRequest = (requestId, userMessage = "Ok lập bảng so 5 bên cho mình xem thử") => {
  const base = m44eExternalResearchRequest(requestId, userMessage);
  const researchArtifact = {
    type: "session_local_research_result",
    schema_version: "cmo.session_local_research_result.v1",
    artifact_id: "research_del_m44e_feeback_competitors",
    tenant_id: "holdstation",
    workspace_id: "feeback",
    app_id: "feeback",
    user_id: "server_derived_user_id",
    session_id: "session_m44e6_research_followup",
    turn_id: "msg_m44e6_previous",
    created_turn_id: "msg_m44e6_previous",
    research_id: "research_del_m44e_feeback_competitors",
    source_agent: "surf",
    research_type: "competitor_landscape",
    user_question: "Hiện tại trên thị trường có bên nào làm giống Feeback mình không?",
    competitors: [
      { name: "Typeform", category: "form_feedback", fit: "medium" },
      { name: "UserVoice", category: "feedback_management", fit: "high" },
      { name: "Canny", category: "feedback_roadmap", fit: "high" },
      { name: "Hotjar", category: "experience_analytics", fit: "medium" },
      { name: "Survicate", category: "survey_feedback", fit: "medium" },
    ],
    sources_used: ["https://www.typeform.com", "https://canny.io"],
    key_findings: ["Five adjacent products overlap with feedback collection, prioritization, or analytics."],
    evidence_gaps: ["Need pricing and workflow depth checks before final ranking."],
    created_at: "2026-06-01T00:00:00.000Z",
    truth_status: "session_only",
    saved_to_vault: false,
    no_auto_promote: true,
    scope_validated_by_product: true,
    safety: {
      read_only: true,
      vault_mutation: false,
      gbrain_mutation: false,
      promotion_performed: false,
    },
  };

  return {
    ...base,
    session_id: "session_m44e6_research_followup",
    context_pack: {
      ...base.context_pack,
      artifacts_in: [...base.context_pack.artifacts_in, researchArtifact],
      session_working_memory: {
        schema_version: "cmo.session_working_memory.v1",
        scope_validated_by_product: true,
        active_contexts: [
          {
            kind: "session_local_research_result",
            artifact_id: researchArtifact.research_id,
            schema_version: "cmo.session_local_research_result.v1",
            status: "available",
            truth_status: "session_only",
            saved_to_vault: false,
            no_auto_promote: true,
            scope: {
              tenant_id: "holdstation",
              workspace_id: "feeback",
              app_id: "feeback",
              user_id: "server_derived_user_id",
              session_id: "session_m44e6_research_followup",
              validated_by_product: true,
            },
          },
        ],
      },
      research_context: {
        schema_version: "cmo.session_research_context.v1",
        artifact_count: 1,
        truth_status: "session_only",
        saved_to_vault: false,
        no_auto_promote: true,
        artifacts: [researchArtifact],
      },
    },
    source_acquisition: {
      ...base.source_acquisition,
      session_local_research_results_count: 1,
      research_followup_has_session_artifact: true,
      research_followup_missing_session_artifact: false,
      scoped_session_research_artifact_available: true,
      scope_validated_by_product: true,
    },
  };
};

const compileRuntimeModule = async () => {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "hermes-cmo-m1-"));
  const tscPath = path.join(rootDir, "node_modules", "typescript", "bin", "tsc");

  try {
    execFileSync(
      process.execPath,
      [
        tscPath,
        "--target",
        "ES2022",
        "--module",
        "CommonJS",
        "--moduleResolution",
        "Node",
        "--strict",
        "--skipLibCheck",
        "--esModuleInterop",
        "--noEmitOnError",
        "true",
        "--outDir",
        tmpDir,
        runtimeSourcePath,
      ],
      {
        cwd: rootDir,
        stdio: "pipe",
      },
    );
  } catch (error) {
    const stdout = error && typeof error === "object" && "stdout" in error ? String(error.stdout) : "";
    const stderr = error && typeof error === "object" && "stderr" in error ? String(error.stderr) : "";
    await rm(tmpDir, { recursive: true, force: true });
    throw new Error(`Failed to compile M1 runtime module:\n${stdout}\n${stderr}`);
  }

  return {
    tmpDir,
    runtimePath: path.join(tmpDir, "hermes-cmo-runtime.js"),
  };
};

const readRequestBody = (request) =>
  new Promise((resolve, reject) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => resolve(body));
    request.on("error", reject);
  });

const writeJson = (response, statusCode, payload) => {
  response.writeHead(statusCode, { "content-type": "application/json" });
  response.end(JSON.stringify(payload));
};

const outboundForbiddenValuePattern =
  /(\[hermes_local_artifact_path_redacted\]|hermes_local_artifact_path_redacted|\/(?:tmp|Users|home|var|mnt)\/|(?:^|[^A-Za-z0-9])[A-Za-z]:[\\/]|conversion_h_|creative-agent-images|cmo-creative-execute|\.(?:png_redact|png|jpe?g|webp|mp4|webm)(?:\b|_|$))/i;
const outboundCallsiteForbiddenLiterals = [
  "[hermes_local_artifact_path_redacted]",
  "hermes_local_artifact_path_redacted",
  ".png_redact",
  "/tmp/",
  "/Users/",
  "/home/",
  "/var/",
  "/mnt/",
  "conversion_h_",
  "creative-agent-images",
  "cmo-creative-execute",
];

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

const containsOutboundCallsiteForbiddenLiteral = (value) =>
  outboundCallsiteForbiddenLiterals.some((literal) => value.includes(literal));

const activity = (requestBody, seq, type, message) => ({
  ...(seq % 2 === 0 ? { schema_version: "hermes.activity.event.v1" } : {}),
  eventId: `evt_m1_${requestBody.request_id}_${seq}`,
  requestId: requestBody.request_id,
  sessionId: requestBody.session_id,
  turnId: requestBody.turn_id,
  seq,
  createdAt: new Date(Date.parse(requestBody.created_at) + seq * 1000).toISOString(),
  sourceAgent: "cmo",
  sourceMode: "cmo.default",
  type,
  status: type === "cmo.run.completed" ? "completed" : "running",
  userVisible: true,
  message,
  data: {},
});

const cmoPolishActivityEvents = (requestBody) => [
  activity(requestBody, 1, "run.started", "CMO run started."),
  activity(requestBody, 2, "context.loaded", "CMO loaded context."),
  activity(requestBody, 3, "cmo.mode.selected", "Mode selected: REVIEW."),
  activity(requestBody, 4, "cmo.bottleneck.identified", "Main bottleneck identified: activation proof gap."),
  activity(requestBody, 5, "cmo.decision.selected", "Decision selected: TEST."),
  activity(requestBody, 6, "cmo.next_step.selected", "Next step selected: run a proof-led activation copy test."),
  activity(requestBody, 7, "plan.created", "CMO created the plan."),
  activity(requestBody, 8, "cmo.run.completed", "CMO run completed."),
];

const cmoM43SourceActivityEvents = (requestBody, classification) => [
  {
    ...activity(requestBody, 1, "run.started", "CMO run started."),
    status: "completed",
  },
  {
    ...activity(requestBody, 2, "cmo.intent.classified", `CMO classified intent: ${classification}.`),
    status: "completed",
    data: {
      classification,
      uses_session_local_source: true,
      source_context_type: "session_local_source",
      active_source_id: "source_review_fixture",
      speech_act: classification === "source_answer" ? "answer" : "acknowledge",
      target_type: "session_local_source",
      target_ref: "source_review_fixture",
      action: classification === "source_answer" ? "answer_from_source" : classification,
      confidence: 0.94,
      negated_intents: [],
      uses_vault_context_pack: false,
      tool_policy: classification === "source_translate" ? "echo" : "none",
    },
  },
  {
    ...activity(requestBody, 3, "cmo.source_context.loaded", "CMO loaded active session-local source context."),
    status: "completed",
    data: {
      uses_session_local_source: true,
      source_context_type: "session_local_source",
      active_source_id: "source_review_fixture",
      schema_version: "cmo.session_local_source.v1",
    },
  },
  {
    ...activity(requestBody, 4, "cmo.response_style.selected", `CMO selected response style for ${classification}.`),
    status: "completed",
    data: {
      classification,
      response_style:
        classification === "source_answer"
          ? "source_answer"
          : classification === "source_translate"
            ? "source_transform"
            : "native_conversation",
      tool_policy: classification === "source_translate" ? "echo" : "none",
    },
  },
  {
    ...activity(requestBody, 5, "cmo.run.completed", "CMO run completed."),
    status: "completed",
  },
];

const cmoResponse = (requestBody, overrides = {}) => {
  const events = overrides.activity_events ?? cmoPolishActivityEvents(requestBody);

  return {
    response: {
      schema_version: "hermes.cmo.response.v1",
      request_id: requestBody.request_id,
      session_id: requestBody.session_id,
      turn_id: requestBody.turn_id,
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
        title: "M1 Hermes CMO synthesis",
        summary: "CMO diagnosed, delegated bounded evidence/copy work, then synthesized the decision.",
        decision: "TEST",
        body: "TEST the activation angle with proof-led copy. Main bottleneck: activation proof gap.",
      },
      structured_output: {
        strategyMode: "REVIEW",
        mainBottleneck: "activation proof gap",
        decisionLabel: "TEST",
        currentStep: "Run a proof-led activation copy test.",
      },
      delegations: [],
      artifacts: [],
      memory_suggestions: [],
      activity_summary: {
        events_count: events.length,
        final_state: "completed",
      },
      ...overrides.response,
    },
    activity_events: events,
  };
};

const startServer = async () => {
  const calls = {
    cmo: 0,
    surfUnified: 0,
    legacySurfX: 0,
    legacySurfLast30Days: 0,
    echo: 0,
    forbidden: 0,
    unexpected: 0,
    surfRequests: [],
    echoRequests: [],
    cmoRequests: [],
  };
  let serverFailure = null;
  const cmoCallsByRequestId = new Map();

  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      const rawBody = request.method === "POST" ? await readRequestBody(request) : "{}";
      const body = JSON.parse(rawBody);

      assert.equal(request.headers.authorization, "Bearer test-m1-key");

      if (url.pathname === "/agents/cmo/execute" || url.pathname === "/agents/cmo/tool-execute") {
        calls.cmo += 1;
        const cmoCallCount = (cmoCallsByRequestId.get(body.request_id) ?? 0) + 1;
        cmoCallsByRequestId.set(body.request_id, cmoCallCount);
        calls.cmoRequests.push({
          requestId: body.request_id,
          path: url.pathname,
          count: cmoCallCount,
          rawBody,
          body,
          allowedAgents: body.constraints?.allowed_agents,
          delegationsMode: body.constraints?.delegations_mode,
          sourceAcquisition: body.source_acquisition,
          toolEndpoint: body.tool_endpoint,
        });

        if (cmoCallCount === 1) {
          const firstCallProposalsOnly =
            body.request_id === "req_m44e6_research_followup_table" ||
            body.request_id === "req_m44e6_research_followup_rank";
          const firstCallCreativeExecution =
            body.request_id === "req_m13_creative_timeout_default" ||
            body.request_id === "req_m13_creative_top_level_success" ||
            body.request_id === "req_m13_creative_uploaded_asset" ||
            body.request_id === "req_m13_creative_activity_invalid_type" ||
            body.request_id === "req_m13_creative_executed_creative_true" ||
            body.request_id === "req_m13_creative_executed_creative_missing_metadata" ||
            body.request_id === "req_m13_creative_false_only_side_effects" ||
            body.request_id === "req_m13_creative_unsafe_side_effect" ||
            body.request_id === "req_m13_creative_executed_echo_true";
          const firstCallCmoOwnedCreativeExecution =
            body.request_id === "req_m13_cmo_owned_creative_execution_live_shape" ||
            body.request_id === "req_m13_cmo_owned_creative_reference_fetch_failed" ||
            body.request_id === "req_m13_creative_conversation_advisory" ||
            body.request_id === "req_m13_creative_outbound_sanitized";
          const firstCallCreativeNative = firstCallCreativeExecution || firstCallCmoOwnedCreativeExecution;
          assert.equal(body.skill_kernel?.id, "clean-cmo-skill-kernel");
          assert.equal(body.user_message, body.intent?.user_message);
          assert.equal(body.message, body.intent?.user_message);
          assert.equal(body.input?.user_message, body.intent?.user_message);
          assert.equal(body.input?.message, body.intent?.user_message);
          assert.deepEqual(body.constraints.allowed_agents, firstCallProposalsOnly ? [] : firstCallCreativeNative ? ["creative"] : ["echo", "surf"]);
          assert.deepEqual(body.constraints.allowed_surf_modes, firstCallProposalsOnly || firstCallCreativeNative ? [] : ["surf.default", "surf.x", "surf.trend", "surf.pulse"]);
          assert.equal(body.constraints.delegations_mode, firstCallProposalsOnly || firstCallCreativeNative ? "proposals_only" : "echo_surf_bounded");
          assert.equal(body.constraints.allowSubAgentExecution, firstCallCreativeNative ? true : !firstCallProposalsOnly);
          if (firstCallCreativeExecution) {
            assert.equal(body.constraints.creative_execution_requested, true);
            assert.equal(body.constraints.allowCreativeExecution, true);
            assert.equal(body.constraints.creative_call_mode, "via_cmo");
            assert.equal(body.constraints.execution_boundary?.creative_execution_allowed, true);
            assert.equal(body.constraints.execution_boundary?.creative_execution_requested, true);
          } else if (firstCallCmoOwnedCreativeExecution) {
            assert.equal(body.constraints.creative_execution_requested, false);
            assert.equal(body.constraints.cmo_owns_creative_decision, true);
            assert.equal(body.constraints.creative_long_running_turn, true);
            assert.equal(body.constraints.execution_boundary?.creative_execution_requested, false);
            assert.equal(body.constraints.execution_boundary?.cmo_owns_creative_decision, true);
            assert.equal(body.constraints.execution_boundary?.creative_artifact_ingest_required_for_preview, true);
            assert.equal(body.constraints.h5_live_adapter?.creative_execution_requested, false);
            assert.equal(body.constraints.h5_live_adapter?.cmo_owns_creative_decision, true);
          }
          if (firstCallCreativeNative) {
            assert.deepEqual(body.artifact_transport, {
              mode: "product_upload",
              upload_endpoint: "https://cmo.jayju.cloud/api/cmo/apps/hold-pay/creative/artifact-ingest",
              workspace_id: "hold-pay",
              app_id: "hold-pay",
              request_id: body.request_id,
              accepted_mime_types: ["image/png", "image/jpeg", "image/webp", "video/mp4", "video/webm"],
              max_bytes: 52428800,
            });
          } else {
            assert.equal(body.artifact_transport, undefined);
          }
          if (body.request_id === "req_m13_creative_outbound_sanitized") {
            assert.deepEqual(collectForbiddenStringValues(body), []);
            assert.equal(body.constraints?.outbound_hermes_payload_sanitized, true);
            assert.equal(body.constraints?.outbound_hermes_payload_path_like_blocked, false);
            assert.equal(body.constraints?.outbound_callsite_guard_version, "context-sanitizer-v2");
            assert.equal(body.constraints?.outbound_callsite_guard_checked, true);
            assert.equal(body.constraints?.outbound_callsite_guard_blocked, false);
            assert.equal(body.outbound_hermes_payload_guard?.outbound_callsite_guard_version, "context-sanitizer-v2");
            assert.equal(body.outbound_hermes_payload_guard?.outbound_callsite_guard_checked, true);
            assert.equal(body.outbound_hermes_payload_guard?.outbound_callsite_guard_blocked, false);
            assert.ok(body.constraints?.outbound_sanitized_field_count >= 10);
            assert.ok(
              body.constraints?.outbound_sanitized_fields_preview.includes("messages.0.content"),
              "Sanitizer diagnostics must show polluted assistant message content was sanitized",
            );
            assert.ok(
              body.constraints?.outbound_sanitized_fields_preview.includes("context_pack.selected_context.0.content"),
              "Sanitizer diagnostics must show selected context content was sanitized",
            );
            assert.ok(
              body.constraints?.outbound_sanitized_fields_preview.includes("context_pack.recent_session_summary"),
              "Sanitizer diagnostics must show recent session summary was sanitized",
            );
            assert.equal(body.constraints?.workspace_fallback_suppressed_for_creative, true);
            assert.equal(
              body.messages[0].content,
              "Creative asset was generated or updated. Use active asset metadata and reference_assets for visual context.",
            );
            assert.equal(body.creative_working_state.assets[0].preview_url, null);
            assert.equal(body.creative_working_state.assets[0].render_url, null);
            assert.equal(body.creative_working_state.assets[0].signed_url, null);
            assert.equal(body.context_pack.creative_working_state.assets[0].render_url, null);
            assert.equal(body.input.creative_working_state.assets[0].render_url, null);
            assert.equal(body.reference_assets[0].preview_url, null);
            assert.equal(body.reference_assets[0].render_url, null);
            assert.equal(
              body.reference_assets[0].fetch_url,
              "https://cmo.jayju.cloud/api/cmo/apps/hold-pay/creative/assets/creative_source_fixture/download",
            );
          }
          assert.equal(body.constraints.execution_boundary?.vault_agent_execution_allowed, false);
          assert.equal(body.constraints.execution_boundary?.direct_supabase_mutations_allowed, false);
          assert.equal(body.constraints.execution_boundary?.openclaw_calls_allowed, false);

          if (body.request_id === "req_m13_creative_top_level_success") {
            writeJson(response, 200, {
              status: "success",
              routed_to_creative: true,
              image_path: "/tmp/creative-agent-smoke/hold-pay-top-level.png",
              bytes: 256,
              sha256: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
              model: "gpt-5.5",
              operation: "responses image_generation",
              side_effects: {
                image_generation: true,
                local_artifact_created: {
                  type: "local_artifact_created",
                  path: "/tmp/creative-agent-smoke/hold-pay-top-level.png",
                  bytes: 256,
                  sha256: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
                },
                creative_asset_metadata: true,
                executed_creative: true,
                executed_echo: false,
                executed_surf: false,
                executed_vault_agent: false,
                published: false,
                scheduled: false,
                vault_mutation: false,
                database_mutation: false,
                credential_write: false,
              },
            });
            return;
          }

          if (body.request_id === "req_m13_creative_executed_creative_true") {
            writeJson(response, 200, {
              status: "success",
              routed_to_creative: true,
              image_path: "/tmp/creative-agent-smoke/hold-pay-executed-creative.png",
              bytes: 640,
              sha256: "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
              model: "gpt-5.5",
              operation: "responses image_generation",
              side_effects: {
                executed_creative: true,
              },
            });
            return;
          }

          if (body.request_id === "req_m13_creative_uploaded_asset") {
            writeJson(response, 200, {
              status: "success",
              routed_to_creative: true,
              visual_summary: "Uploaded Product-owned Creative asset.",
              creative_assets: [
                {
                  schema_version: "cmo.creative_asset.v1",
                  type: "creative_asset",
                  asset_id: "creative_uploaded_fixture",
                  asset_type: "image",
                  transport_status: "uploaded",
                  status: "stored",
                  storage_path: "holdstation/hold-pay/hold-pay/job/asset/uploaded.png",
                  render_url: "https://cmo.jayju.cloud/api/signed/creative_uploaded_fixture",
                  signed_url: "https://cmo.jayju.cloud/api/signed/creative_uploaded_fixture",
                  bytes: 1024,
                  sha256: "1212121212121212121212121212121212121212121212121212121212121212",
                  mime_type: "image/png",
                  model: "gpt-5.5",
                  operation: "responses image_generation",
                },
              ],
              side_effects: {
                executed_creative: true,
              },
              activity_events: [
                {
                  schema_version: "hermes.activity.event.v1",
                  event_id: "creative_uploaded_started",
                  request_id: body.request_id,
                  session_id: body.session_id,
                  turn_id: body.turn_id,
                  seq: 1,
                  created_at: "2026-06-20T00:00:00.000Z",
                  source: { agent: "creative", mode: "creative_execution" },
                  type: "creative.started",
                  status: "completed",
                  user_visible: true,
                  message: "Creative execution started.",
                  data: {},
                },
                {
                  schema_version: "hermes.activity.event.v1",
                  event_id: "creative_uploaded_asset_ready",
                  request_id: body.request_id,
                  session_id: body.session_id,
                  turn_id: body.turn_id,
                  seq: 2,
                  created_at: "2026-06-20T00:00:01.000Z",
                  source: { agent: "cmo", mode: "creative_execution" },
                  type: "creative.asset_ready",
                  status: "completed",
                  user_visible: true,
                  message: "Creative asset uploaded.",
                  data: {},
                },
              ],
              activity_summary: {
                events_count: 2,
                final_state: "completed",
              },
            });
            return;
          }

          if (
            body.request_id === "req_m13_cmo_owned_creative_reference_fetch_failed"
          ) {
            writeJson(response, 200, {
              schema_version: "hermes.cmo.response.v1",
              request_id: body.request_id,
              session_id: body.session_id,
              turn_id: body.turn_id,
              status: "failed",
              response_status: "failed",
              answer_basis: {
                mode: "creative_execution",
              },
              creative_decision: {
                action: "execute",
                operation: "creative.edit_image",
              },
              creative_assets: [],
              errors: [
                {
                  type: "reference_asset_fetch_failed",
                  code: "reference_fetch_http_error",
                  http_status: 401,
                },
              ],
            });
            return;
          }

          if (
            body.request_id === "req_m13_cmo_owned_creative_execution_live_shape"
          ) {
            writeJson(response, 200, {
              schema_version: "hermes.cmo.response.v1",
              request_id: body.request_id,
              session_id: body.session_id,
              turn_id: body.turn_id,
              status: "completed",
              answer_basis: {
                mode: "creative_execution",
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
                title: "Edited creative asset",
                summary: "Edited image uploaded.",
                decision: "execute",
                body: "Edited image uploaded.",
              },
              structured_output: null,
              creative_decision: {
                action: "execute",
                draft_id: "creative_draft_fixture",
                operation: "creative.generate_image",
              },
              creative_assets: [
                {
                  schema_version: "cmo.creative_asset.v1",
                  type: "creative_asset",
                  asset_id: "creative_edited_fixture",
                  asset_type: "image",
                  agent: "creative",
                  transport_status: "uploaded",
                  status: "stored",
                  storage_path: "holdstation/hold-pay/hold-pay/job/asset/edited.png",
                  render_url: "https://cmo.jayju.cloud/api/signed/creative_edited_fixture",
                  signed_url: "https://cmo.jayju.cloud/api/signed/creative_edited_fixture",
                  bytes: 4096,
                  sha256: "7878787878787878787878787878787878787878787878787878787878787878",
                  mime_type: "image/png",
                  model: "gpt-5.5",
                  operation: "responses image_generation",
                },
              ],
              artifacts: [
                {
                  schema_version: "cmo.creative_asset.v1",
                  type: "creative_asset",
                  asset_id: "creative_edited_fixture",
                  asset_type: "image",
                  agent: "creative",
                  transport_status: "uploaded",
                  status: "stored",
                  render_url: "https://cmo.jayju.cloud/api/signed/creative_edited_fixture",
                  signed_url: "https://cmo.jayju.cloud/api/signed/creative_edited_fixture",
                  bytes: 4096,
                  sha256: "7878787878787878787878787878787878787878787878787878787878787878",
                  mime_type: "image/png",
                },
              ],
              memory_suggestions: [],
              activity_events: [
                {
                  type: "creative.started",
                  status: "completed",
                  message: "Creative execution started.",
                  user_visible: true,
                },
                {
                  type: "creative.generating",
                  status: "running",
                  message: "Creative image edit is generating.",
                  user_visible: true,
                },
              ],
              activity_summary: {
                events_count: 2,
                final_state: "completed",
              },
            });
            return;
          }

          if (body.request_id === "req_m13_creative_conversation_advisory") {
            writeJson(response, 200, m13CreativeConversationResponse(
              body,
              "advise",
              "Hướng này không bị hiền quá. Nó đang an toàn và premium; để mạnh hơn, tăng contrast ở hook, thêm một điểm căng về merchant checkout, và giữ visual 21:9 sạch thay vì thêm quá nhiều chi tiết.",
            ));
            return;
          }

          if (body.request_id === "req_m13_creative_outbound_sanitized") {
            writeJson(response, 200, m13CreativeConversationResponse(
              body,
              "advise",
              "This direction remains clean and premium. Add a sharper CTA contrast and one energetic accent while preserving the current image as reference.",
            ));
            return;
          }

          if (body.request_id === "req_m13_creative_activity_invalid_type") {
            writeJson(response, 200, {
              status: "success",
              routed_to_creative: true,
              creative_assets: [
                {
                  asset_id: "creative_invalid_activity_fixture",
                  asset_type: "image",
                  transport_status: "uploaded",
                  status: "stored",
                  render_url: "https://cmo.jayju.cloud/api/signed/creative_invalid_activity_fixture",
                  bytes: 1024,
                  sha256: "3434343434343434343434343434343434343434343434343434343434343434",
                  model: "gpt-5.5",
                  operation: "responses image_generation",
                },
              ],
              side_effects: {
                executed_creative: true,
              },
              activity_events: [
                {
                  schema_version: "hermes.activity.event.v1",
                  event_id: "creative_invalid_activity",
                  request_id: body.request_id,
                  session_id: body.session_id,
                  turn_id: body.turn_id,
                  seq: 1,
                  created_at: "2026-06-20T00:00:00.000Z",
                  source: { agent: "creative", mode: "creative_execution" },
                  type: "cmo.run.completed",
                  status: "completed",
                  user_visible: true,
                  message: "Invalid Creative execution mode event.",
                  data: {},
                },
              ],
              activity_summary: {
                events_count: 1,
                final_state: "completed",
              },
            });
            return;
          }

          if (body.request_id === "req_m13_creative_executed_creative_missing_metadata") {
            writeJson(response, 200, {
              status: "success",
              routed_to_creative: true,
              side_effects: {
                executed_creative: true,
              },
            });
            return;
          }

          if (body.request_id === "req_m13_creative_false_only_side_effects") {
            writeJson(response, 200, {
              status: "success",
              routed_to_creative: true,
              image_path: "/tmp/creative-agent-smoke/hold-pay-false-only.png",
              bytes: 384,
              sha256: "dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
              model: "gpt-5.5",
              operation: "responses image_generation",
              side_effects: {
                executed_echo: false,
                executed_surf: false,
                executed_vault_agent: false,
                published: false,
                scheduled: false,
                vault_mutation: false,
                database_mutation: false,
                credential_write: false,
                arbitrary_filesystem_write: false,
              },
            });
            return;
          }

          if (body.request_id === "req_m13_creative_unsafe_side_effect") {
            writeJson(response, 200, {
              status: "success",
              routed_to_creative: true,
              image_path: "/tmp/creative-agent-smoke/hold-pay-unsafe.png",
              bytes: 512,
              sha256: "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
              model: "gpt-5.5",
              operation: "responses image_generation",
              side_effects: {
                publish: true,
              },
            });
            return;
          }

          if (body.request_id === "req_m13_creative_executed_echo_true") {
            writeJson(response, 200, {
              status: "success",
              routed_to_creative: true,
              image_path: "/tmp/creative-agent-smoke/hold-pay-echo-true.png",
              bytes: 768,
              sha256: "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
              model: "gpt-5.5",
              operation: "responses image_generation",
              side_effects: {
                executed_echo: true,
              },
            });
            return;
          }

          if (firstCallCreativeExecution) {
            writeJson(
              response,
              200,
              cmoResponse(body, {
                response: {
                  answer: {
                    format: "markdown",
                    title: "Creative Asset Ready",
                    summary: "Creative generated an image and returned local artifact metadata.",
                    decision: "KEEP",
                    body: "Creative generated the requested image and returned metadata for Product artifact transport.",
                  },
                  structured_output: {
                    routed_to_creative: true,
                    image_path: "/tmp/creative-agent-smoke/hold-pay.png",
                    bytes: 128,
                    sha256: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                    model: "gpt-5.5",
                    operation: "responses image_generation",
                  },
                  delegations: [],
                },
              }),
            );
            return;
          }

          const echoFailFixture = body.request_id === "req_m1_echo_fail";
          const latestPostFixture = body.request_id === "req_m1_native_latest_post";
          const xSignalFixture = body.request_id === "req_m1_native_x_signal";
          const xPostsEchoOnlyFixture = body.request_id === "req_m1_x_posts_echo_only";
          const surfFailFixture = body.request_id === "req_m1_surf_fail";
          const surfThenEchoFixture = body.request_id === "req_m1_surf_then_echo";
          const maxRoundsFixture = body.request_id === "req_m1_max_rounds";
          const duplicateSameIdFixture = body.request_id === "req_m1_duplicate_same_id";
          const duplicateFingerprintFixture = body.request_id === "req_m1_duplicate_fingerprint";
          const duplicateDelegatedStopFixture = body.request_id === "req_m1_duplicate_delegated_stop";
          const worldAppSignalFixture = body.request_id === "req_m1_world_app_signal";
          const echoCompletedUnresolvedFixture = body.request_id === "req_m1_echo_completed_unresolved";
          const translationFollowupFixture = body.request_id === "req_m1_translation_followup";
          const m43NativeConversationFixture = body.request_id === "req_m43_native_conversation";
          const m43SourceAnswerFixture = body.request_id.startsWith("req_m43c3_source_answer_");
          const m43StrategyOnlyFixture = body.request_id === "req_m43_strategy_only_review";
          const m43SourceTranslateFixture = body.request_id === "req_m43_source_translate";
          const m43UnknownActivityFixture = body.request_id === "req_m43_unknown_activity";
          const m44aContextLoadedFixture = body.request_id === "req_m44a_context_loaded";
          const m44aAnswerGroundedFixture = body.request_id === "req_m44a_answer_grounded";
          const m44aAnswerGroundedRawTextFixture = body.request_id === "req_m44a_answer_grounded_raw_text";
          const m44aAnswerGroundedUnknownKeyFixture = body.request_id === "req_m44a_answer_grounded_unknown_key";
          const m44aDurableActionFixture = body.request_id === "req_m44a_durable_action_proposed";
          const m44aToolReadFixture = body.request_id === "req_m44a_tool_read";
          const m44d2ToolEndpointFixture = body.request_id === "req_m44d2_tool_endpoint";
          const m44dToolEndpointPathAnswerFixture = body.request_id === "req_m44d_tool_endpoint_path_answer";
          const m44dToolEndpointSideEffectsFixture = body.request_id === "req_m44d_tool_endpoint_side_effects_true";
          const m44dToolEndpointCreativeSideEffectsFixture = body.request_id === "req_m44d_tool_endpoint_creative_side_effects";
          const m44dToolEndpointCreativeExecutionModeFixture = body.request_id === "req_m44d_tool_endpoint_creative_execution_mode";
          const m44dToolEndpointUnsafeToolResultFixture = body.request_id === "req_m44d_tool_endpoint_unsafe_tool_result";
          const m44dToolEndpointUnsafeTraceFixture = body.request_id === "req_m44d_tool_endpoint_unsafe_trace";
          const m44dToolEndpointVaultAgentSourceFixture = body.request_id === "req_m44d_tool_endpoint_vault_agent_source";
          const m44dToolEndpointArbitraryModeFixture = body.request_id === "req_m44d_tool_endpoint_arbitrary_mode";
          const m44dUnknownAnswerBasisFixture = body.request_id === "req_m44d_unknown_answer_basis";
          const m44eExternalResearchFixture = body.request_id === "req_m44e_external_research_active_source";
          const m44eSurfSafeFailFixture = body.request_id === "req_m44e_surf_safe_failure";
          const m44e6ResearchFollowupFixture = body.request_id === "req_m44e6_research_followup_table" || body.request_id === "req_m44e6_research_followup_rank";
          const m44eSourceKycToolEndpointFixture = body.request_id === "req_m44e_source_kyc_tool_endpoint";
          const m44d2NativeExecuteFixture = body.request_id === "req_m44d2_native_execute";
          const m44aToolReadCompletedHtmlFixture = body.request_id === "req_m44a_tool_read_completed_html";
          const m44aDurableActionUnsafeWriteFixture = body.request_id === "req_m44a_durable_action_unsafe_write";
          const m44aSecretsFixture = body.request_id === "req_m44a_activity_secret_value";
          const m44aContextOldFieldsFixture = body.request_id === "req_m44a_context_loaded_old_fields";
          const m44aContextRawTextFixture = body.request_id === "req_m44a_context_loaded_raw_text";
          const m44aContextFullPackFixture = body.request_id === "req_m44a_context_loaded_full_pack";
          const m44aUnsafeActivityDataFixture = body.request_id === "req_m44a_unsafe_activity_data";
          const echoRetryFixture =
            body.request_id === "req_m1_echo_retry_good" ||
            body.request_id === "req_m1_echo_retry_fail" ||
            body.request_id === "req_m1_echo_retry_limit";

          let delegations;

          if (m43UnknownActivityFixture) {
            writeJson(
              response,
              200,
              cmoResponse(body, {
                activity_events: [
                  {
                    ...activity(body, 1, "cmo.unknown_event", "Unknown CMO event."),
                    status: "completed",
                  },
                ],
              }),
            );
            return;
          }

          if (m44aContextLoadedFixture) {
            writeJson(
              response,
              200,
              cmoResponse(body, {
                activity_events: [
                  {
                    ...activity(body, 1, "cmo.context.loaded", "CMO loaded bounded product context."),
                    status: "completed",
                    data: {
                      context_pack_present: true,
                      context_item_count: 4,
                      source_count: 2,
                      active_source_count: 1,
                      has_source_answer_context: true,
                      source_answerable: true,
                      workspace_id: "feeback",
                      session_id: "session_m44a_context_loaded",
                      truth_status: "session_only",
                      saved_to_vault: false,
                      no_auto_promote: true,
                      tool_policy_present: true,
                    },
                  },
                ],
              }),
            );
            return;
          }

          if (m44aAnswerGroundedFixture) {
            writeJson(
              response,
              200,
              cmoResponse(body, {
                activity_events: [
                  {
                    ...activity(body, 1, "cmo.answer.grounded", "CMO grounded the answer in available source metadata."),
                    status: "completed",
                    data: {
                      answer_basis_mode: "source_answer",
                      classification: "source_answer",
                      delegations_count: 0,
                      safe_metadata_only: true,
                    },
                  },
                ],
              }),
            );
            return;
          }

          if (m44aAnswerGroundedRawTextFixture) {
            writeJson(
              response,
              200,
              cmoResponse(body, {
                activity_events: [
                  {
                    ...activity(body, 1, "cmo.answer.grounded", "CMO grounded the answer in available source metadata."),
                    status: "completed",
                    data: {
                      answer_basis_mode: "source_answer",
                      source_text: "raw source text should never be emitted in grounded answer activity metadata",
                    },
                  },
                ],
              }),
            );
            return;
          }

          if (m44aAnswerGroundedUnknownKeyFixture) {
            writeJson(
              response,
              200,
              cmoResponse(body, {
                activity_events: [
                  {
                    ...activity(body, 1, "cmo.answer.grounded", "CMO grounded the answer in available source metadata."),
                    status: "completed",
                    data: {
                      answer_basis_mode: "source_answer",
                      unexpected_grounding_key: "safe-looking but not allowlisted",
                    },
                  },
                ],
              }),
            );
            return;
          }

          if (m44aDurableActionFixture) {
            writeJson(
              response,
              200,
              cmoResponse(body, {
                activity_events: [
                  {
                    ...activity(body, 1, "cmo.durable_action.proposed", "CMO proposed a durable action requiring confirmation."),
                    status: "completed",
                    data: {
                      delegation_id: "del_save_source_proposal",
                      target: "vault_agent",
                      plan_only: true,
                      direct_write_performed: false,
                      safe_metadata_only: true,
                      workspace_id: "feeback",
                      session_id: "session_m44a_durable_action_proposed",
                      action_type: "save_source",
                      saved_to_vault: false,
                      no_auto_promote: true,
                    },
                  },
                ],
                response: {
                  answer_basis: {
                    mode: "save_to_vault",
                  },
                  structured_output: {
                    classification: "save_to_vault",
                    response_style: "save_to_vault",
                    tool_policy: "vault_agent",
                    save_requires_explicit_user_confirmation: true,
                    no_auto_save_13_sources: true,
                  },
                  answer: {
                    body: "I can prepare this source for the explicit save flow, but I will not write it from chat.",
                  },
                },
              }),
            );
            return;
          }

          if (m44aToolReadFixture) {
            writeJson(
              response,
              200,
              cmoResponse(body, {
                activity_events: [
                  {
                    ...activity(body, 1, "cmo.tool_read.started", "CMO started a read-only source tool read."),
                    status: "completed",
                    data: {
                      tool_family: "web",
                      read_only: true,
                      source_type: "url",
                      workspace_id: "feeback",
                      session_id: "session_m44a_tool_read",
                      source_id: "source_review_fixture",
                      url_present: true,
                      tool_policy: "read_only",
                      request_id: "req_m44a_tool_read",
                    },
                  },
                  {
                    ...activity(body, 2, "cmo.tool_read.completed", "CMO completed a read-only source tool read."),
                    status: "completed",
                    data: {
                      tool_family: "web",
                      read_only: true,
                      source_type: "url",
                      status: "completed",
                      workspace_id: "feeback",
                      session_id: "session_m44a_tool_read",
                      source_id: "source_review_fixture",
                      http_status: 200,
                      content_type: "text/html",
                      bytes_read: 1200,
                      canonical_url_present: true,
                    },
                  },
                ],
              }),
            );
            return;
          }

          if (m44d2ToolEndpointFixture) {
            assert.equal(url.pathname, "/agents/cmo/tool-execute");
            assert.equal(body.user_message, body.intent?.user_message);
            assert.equal(body.message, body.intent?.user_message);
            assert.equal(body.input?.user_message, body.intent?.user_message);
            assert.equal(body.active_source_id, "source_hold_pay_faq");
            assert.equal(body.context_pack?.active_source_id, "source_hold_pay_faq");
            assert.equal(body.workspace?.app_id, "hold-pay");
            assert.equal(body.workspace?.workspace_id, "hold-pay");
            assert.equal(body.session_id, "session_m44d2_tool_endpoint");
            assert.equal(body.turn_id, "turn_m44d2_tool_endpoint_001");
            assert.ok(body.context_pack, "tool-execute request must include context_pack");
            assert.ok(body.tool_policy, "tool-execute request must include tool_policy");
            assert.equal(body.tool_endpoint?.enabled, true);
            assert.equal(body.constraints?.allowCmoReadTools, true);
            assert.equal(body.constraints?.execution_boundary?.browser_read_allowed, true);
            assert.equal(body.constraints?.execution_boundary?.durable_side_effects_allowed, false);
            assert.equal(body.source_acquisition?.tool_read_recommended, true);
            assert.equal(body.source_acquisition?.original_url, holdPayFaqUrl);
            assert.equal(body.source_acquisition?.canonical_url, holdPayFaqUrl);
            assert.equal(body.context_pack?.source_answer_context?.answerable, false);
            assert.deepEqual(body.context_pack?.source_answer_context?.relevant_snippets, []);
            const sourceArtifact = body.context_pack?.artifacts_in?.find((artifact) => artifact?.type === "session_local_source");
            assert.equal(sourceArtifact?.original_url, holdPayFaqUrl);
            assert.equal(sourceArtifact?.canonical_url, holdPayFaqUrl);
            assert.equal(sourceArtifact?.source_text_excerpt, undefined);
            assert.equal(sourceArtifact?.extracted_summary, undefined);
            writeJson(
              response,
              200,
              {
                ...cmoResponse(body, {
                  response: {
                    schema_version: "hermes.cmo.tool_response.v1",
                    mode: "cmo.tool_capable",
                    activity_summary: undefined,
                    answer_basis: {
                      mode: "tool_read",
                    },
                    structured_output: {
                      classification: "native_conversation",
                      response_style: "native_conversation",
                      tool_policy: "none",
                    },
                    answer: {
                      body: "Holdstation Pay FAQ summary from a tool-capable CMO read.",
                    },
                    tools_used: ["browser_navigate", "browser_snapshot", "browser_console"],
                    tool_trace_summary: {
                      tool_read_count: 3,
                      read_only: true,
                      source_type: "url",
                    },
                  },
                  activity_events: [
                    {
                      ...activity(body, 1, "cmo.tool_read.started", "CMO started browser source read."),
                      sourceMode: "cmo.tool_capable",
                      status: "completed",
                      data: {
                        tool_family: "browser",
                        tool_name: "browser_navigate",
                        tool_category: "browser",
                        read_only: true,
                        source_type: "url",
                        status: "started",
                        success: true,
                        workspace_id: "hold-pay",
                        session_id: "session_m44d2_tool_endpoint",
                        source_id: "source_hold_pay_faq",
                        url_present: true,
                        tool_policy: "read_only",
                        request_id: "req_m44d2_tool_endpoint",
                      },
                    },
                    {
                      ...activity(body, 2, "cmo.tool_read.completed", "CMO completed browser source read."),
                      sourceMode: "cmo.tool_capable",
                      status: "completed",
                      data: {
                        tool_family: "browser",
                        tool_name: "browser_snapshot",
                        tool_category: "browser",
                        read_only: true,
                        source_type: "url",
                        status: "completed",
                        success: true,
                        workspace_id: "hold-pay",
                        session_id: "session_m44d2_tool_endpoint",
                        source_id: "source_hold_pay_faq",
                        http_status: 200,
                        content_type: "text/html",
                        bytes_read: 4096,
                        canonical_url_present: true,
                      },
                    },
                    {
                      ...activity(body, 3, "cmo.answer.grounded", "CMO grounded the answer in a live read-only source tool read."),
                      sourceMode: "cmo.tool_capable",
                      status: "completed",
                      data: {
                        answer_basis_mode: "tool_read",
                        classification: "native_conversation",
                        safe_metadata_only: true,
                        grounded: true,
                        source_count: 1,
                        used_live_tool_read: true,
                        source_answerable: true,
                        truth_status: "session_only",
                        saved_to_vault: false,
                        no_auto_promote: true,
                      },
                    },
                    {
                      ...activity(body, 4, "cmo.run.completed", "CMO completed the tool-capable run."),
                      sourceMode: "cmo.tool_capable",
                      status: "completed",
                    },
                  ],
                }),
                side_effects: {
                  vault_write: false,
                  memory_mutation: false,
                  gbrain_mutation: false,
                  source_auto_save: false,
                  knowledge_promotion: false,
                  supabase_mutation: false,
                  session_mutation: false,
                  raw_capture: false,
                  repo_mutation: false,
                  publishing: false,
                },
              },
            );
            return;
          }

          if (m44dToolEndpointPathAnswerFixture) {
            assert.equal(url.pathname, "/agents/cmo/tool-execute");
            writeJson(
              response,
              200,
              {
                ...cmoResponse(body, {
                  response: {
                    schema_version: "hermes.cmo.tool_response.v1",
                    mode: "cmo.tool_capable",
                    activity_summary: undefined,
                    answer_basis: {
                      mode: "tool_read",
                    },
                    structured_output: {
                      classification: "native_conversation",
                      response_style: "native_conversation",
                      tool_policy: "none",
                    },
                    answer: {
                      body: "[hermes_local_artifact_path_redacted]/creative/session/_crystal_egg_output.png",
                    },
                  },
                  activity_events: [
                    {
                      ...activity(body, 1, "cmo.tool_read.completed", "CMO completed browser source read."),
                      sourceMode: "cmo.tool_capable",
                      status: "completed",
                      data: {
                        tool_family: "browser",
                        tool_name: "browser_snapshot",
                        tool_category: "browser",
                        read_only: true,
                        source_type: "url",
                        status: "completed",
                        success: true,
                        workspace_id: "hold-pay",
                        session_id: body.session_id,
                        source_id: "source_hold_pay_faq",
                        http_status: 200,
                        content_type: "text/html",
                        bytes_read: 4096,
                        canonical_url_present: true,
                      },
                    },
                  ],
                }),
                side_effects: {
                  vault_write: false,
                  memory_mutation: false,
                  gbrain_mutation: false,
                  source_auto_save: false,
                  knowledge_promotion: false,
                  supabase_mutation: false,
                  session_mutation: false,
                  raw_capture: false,
                  repo_mutation: false,
                  publishing: false,
                },
              },
            );
            return;
          }

          if (m44dToolEndpointSideEffectsFixture) {
            assert.equal(url.pathname, "/agents/cmo/tool-execute");
            writeJson(
              response,
              200,
              {
                ...cmoResponse(body, {
                  response: {
                    schema_version: "hermes.cmo.tool_response.v1",
                    mode: "cmo.tool_capable",
                    answer_basis: {
                      mode: "tool_read",
                    },
                    structured_output: {
                      classification: "native_conversation",
                      response_style: "native_conversation",
                      tool_policy: "none",
                    },
                    answer: {
                      body: "This response must be rejected because it reports a side effect.",
                    },
                  },
                }),
                side_effects: {
                  vault_write: true,
                  memory_mutation: false,
                  gbrain_mutation: false,
                  source_auto_save: false,
                  knowledge_promotion: false,
                  supabase_mutation: false,
                  session_mutation: false,
                  raw_capture: false,
                  repo_mutation: false,
                  publishing: false,
                },
              },
            );
            return;
          }

          if (m44dToolEndpointCreativeSideEffectsFixture) {
            assert.equal(url.pathname, "/agents/cmo/tool-execute");
            writeJson(
              response,
              200,
              {
                ...cmoResponse(body, {
                  response: {
                    schema_version: "hermes.cmo.tool_response.v1",
                    mode: "cmo.tool_capable",
                    answer_basis: {
                      mode: "tool_read",
                    },
                    structured_output: {
                      classification: "native_conversation",
                      response_style: "native_conversation",
                      tool_policy: "none",
                    },
                    answer: {
                      body: "This non-Creative response must reject Creative-looking side effects.",
                    },
                  },
                }),
                side_effects: {
                  executed_creative: true,
                  image_generation: true,
                  local_artifact_created: true,
                  creative_asset_metadata: true,
                },
              },
            );
            return;
          }

          if (m44dToolEndpointCreativeExecutionModeFixture) {
            assert.equal(url.pathname, "/agents/cmo/tool-execute");
            writeJson(
              response,
              200,
              cmoResponse(body, {
                activity_events: [
                  {
                    ...activity(body, 1, "creative.asset_ready", "Non-Creative response must reject Creative execution source mode."),
                    source: { agent: "creative", mode: "creative_execution" },
                    status: "completed",
                  },
                ],
              }),
            );
            return;
          }

          if (m44dToolEndpointUnsafeToolResultFixture) {
            assert.equal(url.pathname, "/agents/cmo/tool-execute");
            writeJson(
              response,
              200,
              {
                ...cmoResponse(body, {
                  response: {
                    schema_version: "hermes.cmo.tool_response.v1",
                    mode: "cmo.tool_capable",
                    answer_basis: {
                      mode: "tool_read",
                    },
                    structured_output: {
                      classification: "native_conversation",
                      response_style: "native_conversation",
                      tool_policy: "none",
                    },
                    answer: {
                      body: "This response must be rejected because activity data contains raw tool result.",
                    },
                  },
                  activity_events: [
                    {
                      ...activity(body, 1, "cmo.tool_read.completed", "CMO completed browser source read."),
                      status: "completed",
                      data: {
                        tool_family: "browser",
                        tool_name: "browser_snapshot",
                        read_only: true,
                        source_type: "url",
                        status: "completed",
                        success: true,
                        tool_result: "<html><body>raw page body</body></html>",
                      },
                    },
                  ],
                }),
                side_effects: false,
              },
            );
            return;
          }

          if (m44dToolEndpointUnsafeTraceFixture) {
            assert.equal(url.pathname, "/agents/cmo/tool-execute");
            writeJson(
              response,
              200,
              {
                ...cmoResponse(body, {
                  response: {
                    schema_version: "hermes.cmo.tool_response.v1",
                    mode: "cmo.tool_capable",
                    activity_summary: undefined,
                    answer_basis: {
                      mode: "tool_read",
                    },
                    structured_output: {
                      classification: "native_conversation",
                      response_style: "native_conversation",
                      tool_policy: "none",
                    },
                    answer: {
                      body: "This response must be rejected because tool_trace_summary contains raw HTML.",
                    },
                    tool_trace_summary: {
                      tool_read_count: 1,
                      html: "<html><body>raw page body</body></html>",
                    },
                  },
                  activity_events: [
                    {
                      ...activity(body, 1, "cmo.tool_read.completed", "CMO completed browser source read."),
                      status: "completed",
                      data: {
                        tool_family: "browser",
                        tool_name: "browser_snapshot",
                        read_only: true,
                        source_type: "url",
                        status: "completed",
                        success: true,
                      },
                    },
                  ],
                }),
                side_effects: false,
              },
            );
            return;
          }

          if (m44dToolEndpointVaultAgentSourceFixture) {
            assert.equal(url.pathname, "/agents/cmo/tool-execute");
            writeJson(
              response,
              200,
              {
                ...cmoResponse(body, {
                  response: {
                    schema_version: "hermes.cmo.tool_response.v1",
                    mode: "cmo.tool_capable",
                    activity_summary: undefined,
                    answer_basis: {
                      mode: "tool_read",
                    },
                    structured_output: {
                      classification: "native_conversation",
                      response_style: "native_conversation",
                      tool_policy: "none",
                    },
                    answer: {
                      body: "This response must be rejected because Vault Agent cannot be a direct tool event source.",
                    },
                  },
                  activity_events: [
                    {
                      ...activity(body, 1, "cmo.tool_read.completed", "CMO completed browser source read."),
                      sourceAgent: "vault_agent",
                      sourceMode: "vault_agent.default",
                      status: "completed",
                      data: {
                        tool_family: "browser",
                        tool_name: "browser_snapshot",
                        read_only: true,
                        source_type: "url",
                        status: "completed",
                        success: true,
                      },
                    },
                  ],
                }),
                side_effects: false,
              },
            );
            return;
          }

          if (m44dToolEndpointArbitraryModeFixture) {
            assert.equal(url.pathname, "/agents/cmo/tool-execute");
            writeJson(
              response,
              200,
              {
                ...cmoResponse(body, {
                  response: {
                    schema_version: "hermes.cmo.tool_response.v1",
                    mode: "cmo.tool_capable",
                    activity_summary: undefined,
                    answer_basis: {
                      mode: "tool_read",
                    },
                    structured_output: {
                      classification: "native_conversation",
                      response_style: "native_conversation",
                      tool_policy: "none",
                    },
                    answer: {
                      body: "This response must be rejected because the CMO source mode is arbitrary.",
                    },
                  },
                  activity_events: [
                    {
                      ...activity(body, 1, "cmo.tool_read.completed", "CMO completed browser source read."),
                      sourceMode: "arbitrary_tool",
                      status: "completed",
                      data: {
                        tool_family: "browser",
                        tool_name: "browser_snapshot",
                        read_only: true,
                        source_type: "url",
                        status: "completed",
                        success: true,
                      },
                    },
                  ],
                }),
                side_effects: false,
              },
            );
            return;
          }

          if (m44dUnknownAnswerBasisFixture) {
            writeJson(
              response,
              200,
              cmoResponse(body, {
                response: {
                  answer_basis: {
                    mode: "tool_read",
                  },
                  answer: {
                    body: "Legacy response with tool_read answer basis must still be rejected.",
                  },
                },
              }),
            );
            return;
          }

          if (m44eSourceKycToolEndpointFixture) {
            assert.equal(url.pathname, "/agents/cmo/tool-execute");
            assert.equal(body.intent?.user_message, "Merchant/Partner có chịu trách nhiệm KYC/AML không?");
            assert.equal(body.context_pack?.active_source_id, "source_hold_pay_faq");
            writeJson(
              response,
              200,
              {
                ...cmoResponse(body, {
                  response: {
                    schema_version: "hermes.cmo.tool_response.v1",
                    mode: "cmo.tool_capable",
                    activity_summary: undefined,
                    answer_basis: {
                      mode: "tool_read",
                    },
                    structured_output: {
                      classification: "source_answer",
                      response_style: "source_answer",
                      tool_policy: "none",
                    },
                    answer: {
                      body: "Merchant/Partner KYC/AML answer from the active source.",
                    },
                  },
                  activity_events: [
                    {
                      ...activity(body, 1, "cmo.tool_read.completed", "CMO completed browser source read."),
                      sourceMode: "cmo.tool_capable",
                      status: "completed",
                      data: {
                        tool_family: "browser",
                        tool_name: "browser_snapshot",
                        read_only: true,
                        source_type: "url",
                        status: "completed",
                        success: true,
                      },
                    },
                  ],
                }),
                side_effects: false,
              },
            );
            return;
          }

          if (m44d2NativeExecuteFixture) {
            assert.equal(url.pathname, "/agents/cmo/execute");
            writeJson(response, 200, cmoResponse(body));
            return;
          }

          if (m44eExternalResearchFixture && cmoCallCount === 1) {
            assert.equal(url.pathname, "/agents/cmo/tool-execute");
            assert.equal(body.user_message, body.intent?.user_message);
            assert.equal(body.message, body.intent?.user_message);
            assert.equal(body.input?.user_message, body.intent?.user_message);
            assert.equal(body.constraints?.allowSurfExecution, true);
            assert.deepEqual(body.constraints?.allowed_agents, ["echo", "surf"]);
            assert.deepEqual(body.constraints?.allowed_surf_modes, ["surf.default", "surf.x", "surf.trend", "surf.pulse"]);
            assert.equal(body.constraints?.execution_boundary?.surf_execution_allowed, true);
            assert.equal(body.constraints?.execution_boundary?.sub_agent_execution_allowed, true);
            assert.equal(body.constraints?.execution_boundary?.vault_agent_execution_allowed, false);
            assert.equal(body.constraints?.delegations_mode, "echo_surf_bounded");
            assert.equal(body.context_pack?.active_source_id, "source_feeback_home");
            assert.equal(body.source_acquisition?.original_url, "https://feeback.org");
            writeJson(
              response,
              200,
              cmoResponse(body, {
                response: {
                  status: "delegated",
                  answer_basis: {
                    mode: "external_research",
                  },
                  structured_output: {
                    classification: "external_research",
                    response_style: "external_research",
                    tool_policy: "surf",
                  },
                  answer: {
                    format: "markdown",
                    title: "External research delegation",
                    summary: "Delegating competitor landscape research to Surf.",
                    decision: "WAIT",
                    body: "Delegating competitor landscape research to Surf.",
                  },
                  delegations: [
                    {
                      id: "del_m44e_feeback_competitors",
                      target: { agent: "surf", mode: "surf.default" },
                      task_type: "competitor_landscape_research",
                      objective: "Research whether there are current products similar to Feeback.",
                      input: {
                        brief: "Research current competitor/alternative products similar to Feeback. Include workspace_id=feeback, app_name=Feeback, user question, active source URL https://feeback.org, and concise cited findings.",
                        context: {
                          workspace_id: "feeback",
                          app_name: "Feeback",
                          active_source_url: "https://feeback.org",
                          user_question: body.intent?.user_message,
                        },
                      },
                      output_contract: {
                        desired_format: "concise market landscape with sources and confidence",
                        no_auto_save_13_sources: true,
                        no_auto_promote_12_knowledge: true,
                        no_gbrain_mutation: true,
                      },
                      constraints: ["Read-only external research.", "No Vault write.", "No source auto-save.", "No knowledge promotion."],
                    },
                  ],
                },
              }),
            );
            return;
          }

          if (m44eSurfSafeFailFixture && cmoCallCount === 1) {
            assert.equal(url.pathname, "/agents/cmo/tool-execute");
            assert.equal(body.constraints?.allowSurfExecution, true);
            assert.deepEqual(body.constraints?.allowed_agents, ["echo", "surf"]);
            assert.equal(body.constraints?.execution_boundary?.surf_execution_allowed, true);
            assert.equal(body.context_pack?.active_source_id, "source_feeback_home");
            assert.equal(body.source_acquisition?.original_url, "https://feeback.org");
            writeJson(
              response,
              200,
              cmoResponse(body, {
                response: {
                  status: "delegated",
                  answer_basis: {
                    mode: "external_research",
                  },
                  structured_output: {
                    classification: "external_research",
                    response_style: "external_research",
                    tool_policy: "surf",
                  },
                  answer: {
                    format: "markdown",
                    title: "External research delegation",
                    summary: "Delegating competitor landscape research to Surf.",
                    decision: "WAIT",
                    body: "Delegating competitor landscape research to Surf.",
                  },
                  delegations: [
                    {
                      id: "del_m44e_surf_safe_fail",
                      target: { agent: "surf", mode: "surf.default" },
                      task_type: "competitor_landscape_research",
                      objective: "Research whether current competitors overlap with Feeback.",
                      input: {
                        brief: "Research current competitor products similar to Feeback.",
                        context: {
                          workspace_id: "feeback",
                          app_name: "Feeback",
                          active_source_url: "https://feeback.org",
                          user_question: body.intent?.user_message,
                        },
                      },
                      output_contract: {
                        desired_format: "concise market landscape with sources and confidence",
                        no_auto_save_13_sources: true,
                        no_auto_promote_12_knowledge: true,
                        no_gbrain_mutation: true,
                      },
                      constraints: ["Read-only external research.", "No Vault write.", "No source auto-save.", "No knowledge promotion."],
                    },
                  ],
                },
              }),
            );
            return;
          }

          if (m44e6ResearchFollowupFixture) {
            assert.equal(url.pathname, "/agents/cmo/tool-execute");
            assert.equal(body.constraints?.allowSurfExecution, false);
            assert.equal(body.constraints?.delegations_mode, "proposals_only");
            assert.equal(body.source_acquisition?.research_followup_requested, undefined);
            assert.equal(body.source_acquisition?.research_followup_has_session_artifact, true);
            assert.equal(body.source_acquisition?.research_followup_missing_session_artifact, false);
            assert.equal(body.source_acquisition?.scoped_session_research_artifact_available, true);
            assert.equal(body.source_acquisition?.scope_validated_by_product, true);
            const researchArtifact = body.context_pack?.artifacts_in?.find((artifact) => artifact?.type === "session_local_research_result");
            assert.ok(researchArtifact, "research follow-up request must include session-local research artifact");
            assert.equal(researchArtifact.schema_version, "cmo.session_local_research_result.v1");
            assert.equal(researchArtifact.artifact_id, "research_del_m44e_feeback_competitors");
            assert.equal(researchArtifact.scope_validated_by_product, true);
            assert.equal(researchArtifact.tenant_id, "holdstation");
            assert.equal(researchArtifact.workspace_id, "feeback");
            assert.equal(researchArtifact.app_id, "feeback");
            assert.equal(researchArtifact.user_id, "server_derived_user_id");
            assert.equal(researchArtifact.truth_status, "session_only");
            assert.equal(researchArtifact.saved_to_vault, false);
            assert.equal(researchArtifact.no_auto_promote, true);
            assert.equal(body.context_pack?.research_context?.artifact_count, 1);
            assert.equal(body.context_pack?.session_working_memory?.scope_validated_by_product, true);
            assert.equal(body.context_pack?.session_working_memory?.active_contexts?.[0]?.artifact_id, "research_del_m44e_feeback_competitors");
            writeJson(
              response,
              200,
              cmoResponse(body, {
                response: {
                  answer_basis: {
                    schema_version: "cmo.answer_basis.v1",
                    mode: "session_research_artifact",
                  },
                  context_resolution: {
                    schema_version: "cmo.context_resolution.v1",
                    status: "resolved",
                    semantic_intent: {
                      primary: "research_followup",
                      subtype:
                        body.request_id === "req_m44e6_research_followup_rank"
                          ? "ranking_similarity"
                          : "table_comparison",
                      requires_surf: false,
                    },
                    used_live_surf: false,
                  },
                  structured_output: {
                    classification: "research_followup",
                    response_style: "research_followup",
                    tool_policy: "none",
                    used_session_local_research_result: true,
                  },
                  answer: {
                    format: "markdown",
                    title: "Feeback competitor comparison",
                    summary: "Comparison from existing Surf research.",
                    decision: "KEEP",
                    body:
                      body.request_id === "req_m44e6_research_followup_rank"
                        ? "From the 5 existing Surf results, UserVoice and Canny are closest to Feeback under the requested criteria."
                        : "| Product | Similarity | Note |\\n| --- | --- | --- |\\n| UserVoice | High | Feedback workflow overlap |\\n| Canny | High | Prioritization workflow overlap |",
                  },
                },
              }),
            );
            return;
          }

          if (m44aToolReadCompletedHtmlFixture) {
            writeJson(
              response,
              200,
              cmoResponse(body, {
                activity_events: [
                  {
                    ...activity(body, 1, "cmo.tool_read.completed", "CMO completed a read-only source tool read."),
                    status: "completed",
                    data: {
                      tool_family: "web",
                      read_only: true,
                      source_type: "url",
                      status: "completed",
                      html: "<html><body>raw page body</body></html>",
                    },
                  },
                ],
              }),
            );
            return;
          }

          if (m44aDurableActionUnsafeWriteFixture) {
            writeJson(
              response,
              200,
              cmoResponse(body, {
                activity_events: [
                  {
                    ...activity(body, 1, "cmo.durable_action.proposed", "CMO proposed a durable action requiring confirmation."),
                    status: "completed",
                    data: {
                      delegation_id: "del_unsafe_write",
                      target: "vault_agent",
                      plan_only: false,
                      direct_write_performed: true,
                      safe_metadata_only: true,
                      vault_write_path: "13 Sources/private.md",
                    },
                  },
                ],
              }),
            );
            return;
          }

          if (m44aSecretsFixture) {
            writeJson(
              response,
              200,
              cmoResponse(body, {
                activity_events: [
                  {
                    ...activity(body, 1, "cmo.answer.grounded", "CMO grounded the answer in available source metadata."),
                    status: "completed",
                    data: {
                      answer_basis_mode: "source_answer",
                      safe_metadata_only: true,
                      classification: "Bearer sk-this-should-never-appear",
                    },
                  },
                ],
              }),
            );
            return;
          }

          if (m44aContextOldFieldsFixture) {
            writeJson(
              response,
              200,
              cmoResponse(body, {
                activity_events: [
                  {
                    ...activity(body, 1, "cmo.context.loaded", "CMO loaded bounded product context."),
                    status: "completed",
                    data: {
                      selected_context_count: 5,
                      safe_metadata_only: true,
                    },
                  },
                ],
              }),
            );
            return;
          }

          if (m44aContextRawTextFixture) {
            writeJson(
              response,
              200,
              cmoResponse(body, {
                activity_events: [
                  {
                    ...activity(body, 1, "cmo.context.loaded", "CMO loaded bounded product context."),
                    status: "completed",
                    data: {
                      context_pack_present: true,
                      source_count: 1,
                      source_text: "raw source text should never be emitted in activity metadata",
                    },
                  },
                ],
              }),
            );
            return;
          }

          if (m44aContextFullPackFixture) {
            writeJson(
              response,
              200,
              cmoResponse(body, {
                activity_events: [
                  {
                    ...activity(body, 1, "cmo.context.loaded", "CMO loaded bounded product context."),
                    status: "completed",
                    data: {
                      context_pack_present: true,
                      source_count: 1,
                      context_pack: {
                        artifacts_in: [
                          {
                            type: "session_local_source",
                            source_text_excerpt: "raw source excerpt must not appear in activity metadata",
                          },
                        ],
                      },
                    },
                  },
                ],
              }),
            );
            return;
          }

          if (m44aUnsafeActivityDataFixture) {
            writeJson(
              response,
              200,
              cmoResponse(body, {
                activity_events: [
                  {
                    ...activity(body, 1, "cmo.tool_read.completed", "CMO completed a read-only tool read."),
                    status: "completed",
                    data: {
                      tool_family: "web",
                      raw_source_text: "full source text should not be included in activity metadata",
                    },
                  },
                ],
              }),
            );
            return;
          }

          if (m43NativeConversationFixture) {
            writeJson(
              response,
              200,
              cmoResponse(body, {
                activity_events: cmoM43SourceActivityEvents(body, "native_conversation"),
                response: {
                  clarifying_question: undefined,
                  answer_basis: {
                    mode: "native_conversation",
                  },
                  structured_output: {
                    strategyMode: "REVIEW",
                    mainBottleneck: "none",
                    decisionLabel: "KEEP",
                    classification: "native_conversation",
                    uses_session_local_source: true,
                    source_context_type: "session_local_source",
                    active_source_id: "source_review_fixture",
                  },
                  answer: {
                    body: "Ok bro, rõ rồi.",
                  },
                },
              }),
            );
            return;
          }

          if (m43SourceAnswerFixture) {
            const answerBody =
              body.request_id === "req_m43c3_source_answer_summarize"
                ? "Feeback source summary: it describes the project website and current positioning from the session-local source."
                : body.request_id === "req_m43c3_source_answer_translate_direct"
                  ? "Bản dịch trực tiếp từ nguồn Feeback trong phiên làm việc."
                  : "Feeback applies to venues that can support the source-described campaign or product surface; this answer uses only the active session-local source.";

            writeJson(
              response,
              200,
              cmoResponse(body, {
                activity_events: cmoM43SourceActivityEvents(body, "source_answer"),
                response: {
                  answer_basis: {
                    mode: "source_answer",
                  },
                  structured_output: {
                    classification: "source_answer",
                    response_style: "source_answer",
                    tool_policy: "none",
                    speech_act: body.request_id === "req_m43c3_source_answer_summarize" ? "summarize" : "answer",
                    target_type: "session_local_source",
                    target_ref: "source_review_fixture",
                    action: body.request_id === "req_m43c3_source_answer_translate_direct" ? "translate_direct" : "answer_from_source",
                    confidence: 0.93,
                    negated_intents: [],
                    uses_session_local_source: true,
                    uses_vault_context_pack: false,
                    active_source_id: "source_review_fixture",
                  },
                  answer: {
                    body: answerBody,
                  },
                },
              }),
            );
            return;
          }

          if (m43StrategyOnlyFixture) {
            writeJson(
              response,
              200,
              cmoResponse(body, {
                activity_events: [
                  {
                    ...activity(body, 1, "run.started", "CMO run started."),
                    status: "completed",
                  },
                  {
                    ...activity(body, 2, "cmo.source_context.loaded", "CMO loaded active session-local source context."),
                    status: "completed",
                    data: {
                      uses_session_local_source: true,
                      source_context_type: "session_local_source",
                      active_source_id: "source_review_fixture",
                    },
                  },
                  {
                    ...activity(body, 3, "cmo.intent.classified", "CMO classified intent: strategy_only."),
                    status: "completed",
                    data: {
                      classification: "strategy_only",
                      speech_act: "review",
                      target_type: "session_local_source",
                      target_ref: "source_review_fixture",
                      action: "structured_review",
                      confidence: 0.92,
                      negated_intents: [],
                      uses_session_local_source: true,
                      uses_vault_context_pack: false,
                    },
                  },
                  {
                    ...activity(body, 4, "cmo.mode.selected", "Mode selected: REVIEW."),
                    status: "completed",
                  },
                  {
                    ...activity(body, 5, "cmo.bottleneck.identified", "Main bottleneck identified: source proof gap."),
                    status: "completed",
                  },
                  {
                    ...activity(body, 6, "cmo.decision.selected", "Decision selected: KEEP."),
                    status: "completed",
                  },
                  {
                    ...activity(body, 7, "cmo.next_step.selected", "Next step selected: confirm project source fit."),
                    status: "completed",
                  },
                  {
                    ...activity(body, 8, "plan.created", "CMO created the source review plan."),
                    status: "completed",
                  },
                  {
                    ...activity(body, 9, "cmo.run.completed", "CMO run completed."),
                    status: "completed",
                  },
                ],
                response: {
                  answer_basis: {
                    mode: "fully_grounded",
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
                  answer: {
                    format: "markdown",
                    title: "CMO strategic response",
                    summary: "REVIEW",
                    decision: "KEEP",
                    body: "Structured review body from the active session-local source.",
                  },
                },
              }),
            );
            return;
          }

          if (m43SourceTranslateFixture) {
            delegations = [
              {
                id: "del_source_translate",
                target_agent: "echo",
                mode: "source_translate",
                task_type: "source_translate",
                objective: "Translate the active session-local source excerpt into Vietnamese.",
                input: {
                  brief: "Translate the active session-local source excerpt into Vietnamese.",
                  input_material: translationSourceMaterial,
                  source_material: translationSourceMaterial,
                  context: {
                    active_source_id: "source_review_fixture",
                    source_context_type: "session_local_source",
                  },
                },
                input_material: translationSourceMaterial,
                source_material: translationSourceMaterial,
                output_contract: {
                  schema_version: "echo.response.v1",
                  task_type: "source_translate",
                  source_material: translationSourceMaterial,
                },
              },
            ];
          } else if (latestPostFixture) {
            delegations = [
              {
                id: "del_latest_post",
                targetAgent: "surf",
                mode: "surf.x",
                taskType: "latest_post_lookup",
                surface: "x",
                entity: "Holdstation",
                query: "Holdstation latest post",
                outputContract: {
                  linkRequired: true,
                  strategySynthesisAllowed: false,
                },
                objective: "Find the latest Holdstation post on X and return the link.",
                constraints: ["Read-only lookup.", "Return a source link."],
              },
            ];
          } else if (xSignalFixture || duplicateSameIdFixture || duplicateDelegatedStopFixture || worldAppSignalFixture) {
            delegations = [
              {
                id:
                  duplicateSameIdFixture || duplicateDelegatedStopFixture
                    ? "dlg_req_h6_msg_c7e41e48-0cc_surf_001"
                    : worldAppSignalFixture
                      ? "del_world_app_signal"
                      : "del_x_signal_scan",
                target_agent: "surf",
                mode: "surf.x",
                task_type: "x_signal_scan",
                surface: "x",
                topics: signalTopics,
                objective: "Scan X for World App and trading mini app signal.",
                output_contract: {
                  strategySynthesisAllowed: false,
                },
                constraints: ["Read-only X scan.", "Treat social signal as weak evidence."],
              },
            ];
          } else if (duplicateFingerprintFixture) {
            delegations = [
              {
                target_agent: "surf",
                mode: "surf.x",
                task_type: "x_signal_scan",
                surface: "x",
                topics: signalTopics,
                objective: "Scan X for World App and trading mini app signal.",
                output_contract: {
                  strategySynthesisAllowed: false,
                },
                input: {
                  brief: "No-id duplicate fingerprint fixture.",
                },
                constraints: ["Read-only X scan.", "Treat social signal as weak evidence."],
              },
              {
                target_agent: "surf",
                mode: "surf.x",
                task_type: "x_signal_scan",
                surface: "x",
                topics: signalTopics,
                objective: "Scan X for World App and trading mini app signal.",
                output_contract: {
                  strategySynthesisAllowed: false,
                },
                input: {
                  brief: "No-id duplicate fingerprint fixture.",
                },
                constraints: ["Read-only X scan.", "Treat social signal as weak evidence."],
              },
            ];
          } else if (surfThenEchoFixture || maxRoundsFixture) {
            delegations = [
              {
                id: `del_${body.request_id}_surf_initial`,
                targetAgent: "surf",
                mode: "surf.x",
                taskType: "x_signal_scan",
                surface: "x",
                topics: signalTopics,
                objective: "Scan X for usable Holdstation and World App mini app signal.",
                output_contract: {
                  strategySynthesisAllowed: false,
                },
                constraints: ["Read-only X scan.", "Treat social signal as weak evidence."],
              },
            ];
          } else if (xPostsEchoOnlyFixture || echoCompletedUnresolvedFixture) {
            delegations = [
              {
                id: echoCompletedUnresolvedFixture ? "del_echo_completed_unresolved" : "del_x_posts_echo_only",
                targetAgent: "echo",
                mode: "echo.default",
                objective: "Create 3 short X posts from the safest angle.",
                input: {
                  brief: "Write channel-native X posts from the CMO angle.",
                  constraints: ["Do not research.", "Do not decide strategy."],
                },
              },
            ];
          } else if (translationFollowupFixture) {
            const priorAssistantContext = body.context_pack.selected_context.find((item) => item?.kind === "recent_chat_message" && item?.role === "assistant");
            assert.ok(priorAssistantContext, "translation follow-up must include prior assistant answer in selected_context");
            assert.match(priorAssistantContext.content, /POST 1:/);
            assert.match(priorAssistantContext.content, /POST 2:/);
            assert.match(priorAssistantContext.content, /POST 3:/);

            delegations = [
              {
                handoff_id: "del_translation_followup_initial",
                target_agent: "echo",
                mode: "echo.default",
                task_type: "translation_followup",
                objective: "Translate all 3 prior X posts into Vietnamese.",
                platform: "x",
                content_count: 3,
                audience: "Vietnamese Holdstation Mini App users",
                claim_boundaries: ["Translate only; preserve claim boundaries."],
                input: {
                  brief: "Translate all three source posts to Vietnamese.",
                  input_material: translationSourceMaterial,
                  source_material: translationSourceMaterial,
                  context: {
                    previous_answer: translationSourceMaterial.join("\n\n"),
                  },
                },
                input_material: translationSourceMaterial,
                source_material: translationSourceMaterial,
                output_contract: {
                  schema_version: "echo.response.v1",
                  expected_count: 3,
                  translation_source_material: translationSourceMaterial,
                  source_material: translationSourceMaterial,
                },
              },
            ];
          } else if (surfFailFixture) {
            delegations = [
              {
                id: "del_surf_fail",
                targetAgent: "surf",
                mode: "surf.x",
                taskType: "latest_post_lookup",
                surface: "x",
                entity: "Holdstation",
                query: "Holdstation latest post",
                outputContract: {
                  linkRequired: true,
                  strategySynthesisAllowed: false,
                },
                objective: "Find the latest Holdstation post on X and return the link.",
                constraints: ["Read-only lookup.", "Return a source link."],
              },
            ];
          } else if (echoRetryFixture) {
            delegations = [
              {
                id: `del_${body.request_id}_initial`,
                targetAgent: "echo",
                mode: "echo.default",
                objective: "Create 3 short X posts from the safest angle.",
                input: {
                  brief: "Write channel-native X posts from the CMO angle.",
                  constraints: ["Do not research.", "Do not decide strategy."],
                },
              },
            ];
          } else if (echoFailFixture) {
            delegations = [
              {
                id: "del_surf_fail_default",
                target: { agent: "surf", mode: "surf.default" },
                objective: "Research activation evidence gaps for Holdstation Mini App.",
                input: {
                  brief: "Find compact activation proof gaps before content execution.",
                  constraints: ["M1 source caps only."],
                },
              },
              {
                id: "del_echo_fail",
                target: { agent: "echo", mode: "echo.default" },
                objective: "Create 3 short X posts from the safest angle.",
                input: {
                  brief: "Use evidence boundaries and produce final copy only through Echo.",
                  constraints: ["Do not decide strategy."],
                },
              },
            ];
          } else {
            delegations = [
              {
                id: "del_surf_gap_wrong",
                target: { agent: "surf", mode: "surf.x" },
                objective: "Research activation evidence gaps for Holdstation Mini App.",
                input: {
                  brief: "Find compact activation proof gaps before content execution.",
                  constraints: ["M1 source caps only."],
                },
              },
              {
                id: "del_surf_x_explicit",
                target: { agent: "surf", mode: "surf.x" },
                objective: "Research X social signal evidence for activation objections.",
                input: {
                  brief: "Scan X signal only for activation objection language.",
                  constraints: ["M1 source caps only."],
                },
              },
              {
                id: "del_echo_copy",
                target: { agent: "echo", mode: "echo.default" },
                objective: "Create 3 short X posts from the safest angle.",
                input: {
                  brief: "Write final copy only after Surf evidence is available.",
                  constraints: ["Do not decide strategy."],
                },
              },
            ];
          }

          writeJson(
            response,
            200,
            cmoResponse(body, {
              ...(m43SourceTranslateFixture ? { activity_events: cmoM43SourceActivityEvents(body, "source_translate") } : {}),
              response: {
                status: "delegated",
                ...(m43SourceTranslateFixture
                  ? {
                      answer_basis: {
                        mode: "source_translate",
                        missing_inputs: [],
                        assumptions_used: [],
                        user_can_override: true,
                        suggested_user_inputs: [],
                      },
                    }
                  : {}),
                structured_output: {
                  strategyMode: "DIAGNOSE",
                  mainBottleneck: "activation proof gap",
                  decisionLabel: "TEST",
                  ...(m43SourceTranslateFixture
                    ? {
                        classification: "source_translate",
                        uses_session_local_source: true,
                        source_context_type: "session_local_source",
                        active_source_id: "source_review_fixture",
                      }
                    : {}),
                },
                answer: {
                  format: "markdown",
                  title: "Delegated fixture answer",
                  summary: "Initial CMO response requested specialist execution.",
                  decision: "WAIT",
                  body: "Delegating to specialist. This text must not be surfaced as the final answer when orchestration is enabled.",
                },
                delegations,
              },
            }),
          );
          return;
        }

        if (body.request_id === "req_m44e_external_research_active_source" && cmoCallCount === 2) {
          assert.equal(url.pathname, "/agents/cmo/tool-execute");
          assert.equal(body.context_pack?.artifacts_in?.at(-1)?.type, "cmo_engine_delegation_results");
          writeJson(
            response,
            200,
            cmoResponse(body, {
              response: {
                answer_basis: {
                  mode: "external_research",
                },
                structured_output: {
                  classification: "external_research",
                  response_style: "external_research",
                  tool_policy: "surf",
                },
                answer: {
                  format: "markdown",
                  title: "Feeback competitor landscape",
                  summary: "Surf-backed competitor landscape.",
                  decision: "KEEP",
                  body: "Surf-backed answer: Feeback has adjacent competitors, but positioning depends on feedback-loop workflow depth and campaign proof.",
                },
              },
            }),
          );
          return;
        }

        const echoRetryRequest =
          body.request_id === "req_m1_echo_retry_good" ||
          body.request_id === "req_m1_echo_retry_fail" ||
          body.request_id === "req_m1_echo_retry_limit" ||
          body.request_id === "req_m1_translation_followup";
        const failedExecutionSynthesis =
          body.request_id === "req_m1_echo_fail" ||
          body.request_id === "req_m1_surf_fail" ||
          body.request_id === "req_m44e_surf_safe_failure" ||
          (body.request_id === "req_m1_duplicate_delegated_stop" && cmoCallCount === 3) ||
          (body.request_id === "req_m1_echo_completed_unresolved" && cmoCallCount === 3) ||
          (body.request_id === "req_m1_max_rounds" && cmoCallCount === 4) ||
          (body.request_id === "req_m1_echo_retry_fail" && cmoCallCount === 3);
        const expectedAllowedAgents = failedExecutionSynthesis ? [] : ["echo", "surf"];
        if (JSON.stringify(body.constraints.allowed_agents) !== JSON.stringify(expectedAllowedAgents)) {
          throw new Error(`Unexpected allowed_agents for ${body.request_id} #${cmoCallCount}: ${JSON.stringify(body.constraints.allowed_agents)} expected ${JSON.stringify(expectedAllowedAgents)}`);
        }
        assert.deepEqual(
          body.constraints.allowed_surf_modes,
          failedExecutionSynthesis ? [] : ["surf.default", "surf.x", "surf.trend", "surf.pulse"],
          `${body.request_id} #${cmoCallCount} unexpected allowed_surf_modes`,
        );
        assert.equal(body.constraints.delegations_mode, failedExecutionSynthesis ? "proposals_only" : "echo_surf_bounded");
        assert.equal(body.constraints.m1_clean_cmo_skill_kernel?.final_synthesis, true);
        assert.equal(body.context_pack.artifacts_in.at(-1)?.type, "cmo_engine_delegation_results");
        assert.ok(
          body.context_pack.artifacts_in.some((artifact) => artifact?.type === "specialist_result"),
          "synthesis request did not include specialist_result artifacts",
        );
        if (
          body.request_id === "req_m1_duplicate_same_id" ||
          body.request_id === "req_m1_duplicate_fingerprint" ||
          body.request_id === "req_m1_world_app_signal" ||
          body.request_id === "req_m1_echo_completed_unresolved"
        ) {
          assert.equal(
            body.context_pack.artifacts_in.filter((artifact) => artifact?.type === "specialist_result").length,
            1,
          );
        }
        const expectedResultCount = echoRetryRequest && cmoCallCount === 3
            ? 2
            : body.request_id === "req_m1_surf_then_echo" && cmoCallCount === 3
              ? 2
              : body.request_id === "req_m1_max_rounds"
                ? cmoCallCount - 1
                : body.request_id === "req_m1_echo_fail"
                  ? 2
                  : body.request_id === "req_m1_cmo_001"
                    ? 3
                    : 1;
        assert.equal(
          body.context_pack.artifacts_in.at(-1)?.results.length,
          expectedResultCount,
          `${body.request_id} #${cmoCallCount} should include expected delegation result count`,
        );

        if (
          body.request_id === "req_m1_duplicate_same_id" ||
          body.request_id === "req_m1_duplicate_fingerprint" ||
          body.request_id === "req_m1_world_app_signal"
        ) {
          writeJson(
            response,
            200,
            cmoResponse(body, {
              response: {
                status: "completed",
                answer: {
                  format: "markdown",
                  title: "Deduped Surf Final",
                  summary: "CMO used one Surf result and did not need another specialist call.",
                  decision: "WAIT",
                  body: "One Surf result was enough for the final CMO judgement.",
                },
                delegations:
                  body.request_id === "req_m1_duplicate_fingerprint"
                    ? [
                        {
                          target_agent: "surf",
                          mode: "surf.x",
                          task_type: "x_signal_scan",
                          surface: "x",
                          topics: signalTopics,
                          objective: "Scan X for World App and trading mini app signal.",
                          input: {
                            brief: "No-id duplicate fingerprint fixture.",
                          },
                        },
                      ]
                    : [
                        {
                          id:
                            body.request_id === "req_m1_world_app_signal"
                              ? "del_world_app_signal"
                              : "dlg_req_h6_msg_c7e41e48-0cc_surf_001",
                          target_agent: "surf",
                          mode: "surf.x",
                          task_type: "x_signal_scan",
                          surface: "x",
                          topics: signalTopics,
                          objective: "Scan X for World App and trading mini app signal.",
                        },
                      ],
              },
            }),
          );
          return;
        }

        if (body.request_id === "req_m1_duplicate_delegated_stop") {
          writeJson(
            response,
            200,
            cmoResponse(body, {
              response: {
                status: "delegated",
                answer: {
                  format: "markdown",
                  title: "Duplicate Delegated Intermediate",
                  summary: "caller should run Surf again.",
                  decision: "WAIT",
                  body: "caller should run Surf again. This duplicate delegation text must not be final.",
                },
                delegations: [
                  {
                    id: "dlg_req_h6_msg_c7e41e48-0cc_surf_001",
                    target_agent: "surf",
                    mode: "surf.x",
                    task_type: "x_signal_scan",
                    surface: "x",
                    topics: signalTopics,
                    objective: "Scan X for World App and trading mini app signal.",
                  },
                ],
              },
            }),
          );
          return;
        }

        if (body.request_id === "req_m1_echo_completed_unresolved") {
          writeJson(
            response,
            200,
            cmoResponse(body, {
              response: {
                status: "delegated",
                answer: {
                  format: "markdown",
                  title: "Echo Completed But Unresolved",
                  summary: "caller should run Echo again.",
                  decision: "WAIT",
                  body: "caller should run Echo again. This duplicate Echo delegation text must not be final.",
                },
                delegations: [
                  {
                    id: "del_echo_completed_unresolved",
                    targetAgent: "echo",
                    mode: "echo.default",
                    objective: "Create 3 short X posts from the safest angle.",
                    input: {
                      brief: "Write channel-native X posts from the CMO angle.",
                      constraints: ["Do not research.", "Do not decide strategy."],
                    },
                  },
                ],
              },
            }),
          );
          return;
        }

        if (echoRetryRequest && cmoCallCount === 2) {
          assert.equal(body.constraints.delegations_mode, "echo_surf_bounded");
          assert.equal(body.constraints.allowEchoExecution, true);
          if (body.request_id === "req_m1_translation_followup") {
            writeJson(
              response,
              200,
              cmoResponse(body, {
                response: {
                  status: "delegated",
                  classification: "needs_echo_retry",
                  retry_of: "echo",
                  retry_reason: "echo_translation_output_incomplete",
                  structured_output: {
                    strategyMode: "REVIEW",
                    mainBottleneck: "Echo translated only part of the source material.",
                    decisionLabel: "WAIT",
                    classification: "needs_echo_retry",
                    retry_of: "echo",
                    retry_reason: "echo_translation_output_incomplete",
                  },
                  answer: {
                    format: "markdown",
                    title: "Incomplete Translation",
                    summary: "Echo translated only 1 of 3 posts.",
                    decision: "WAIT",
                    body: "Echo translated only Post 1. Caller should retry Echo with all source material.",
                  },
                  delegations: [
                    {
                      handoff_id: "del_translation_followup_retry",
                      target_agent: "echo",
                      mode: "echo.default",
                      task_type: "translation_followup",
                      objective: "Retry Vietnamese translation for all 3 prior X posts.",
                      platform: "x",
                      content_count: 3,
                      audience: "Vietnamese Holdstation Mini App users",
                      retry_of: "echo",
                      retry_reason: "echo_translation_output_incomplete",
                      claim_boundaries: ["Translate only; preserve claim boundaries."],
                      input: {
                        brief: "Translate all three source posts to Vietnamese.",
                      },
                      input_material: translationSourceMaterial,
                      source_material: translationSourceMaterial,
                      output_contract: {
                        schema_version: "echo.response.v1",
                        expected_count: 3,
                        translation_source_material: translationSourceMaterial,
                        source_material: translationSourceMaterial,
                      },
                    },
                  ],
                },
              }),
            );
            return;
          }
          writeJson(
            response,
            200,
            cmoResponse(body, {
              response: {
                status: "delegated",
                classification: "needs_echo_retry",
                retry_of: "echo",
                retry_reason: "echo_output_unusable_internal_process_language",
                structured_output: {
                  strategyMode: "REVIEW",
                  mainBottleneck: "Echo output used internal process language.",
                  decisionLabel: "WAIT",
                  classification: "needs_echo_retry",
                  retry_of: "echo",
                  retry_reason: "echo_output_unusable_internal_process_language",
                },
                answer: {
                  format: "markdown",
                  title: "Unsafe CMO Replacement Copy",
                  summary: "This fixture tries to replace Echo output.",
                  decision: "TEST",
                  body: "Post 1: CMO-written replacement copy must not be final.",
                },
                delegations: [
                  {
                    id: body.request_id === "req_m1_echo_retry_fail" ? "del_echo_retry_fail_again" : `del_${body.request_id}_again`,
                    target_agent: "echo",
                    mode: "echo.default",
                    objective: "Create 3 short X posts from the safest angle.",
                    input: {
                      brief: "Retry without internal process language.",
                      constraints: ["Do not research.", "Do not decide strategy.", "No internal process language."],
                    },
                  },
                ],
              },
            }),
          );
          return;
        }

        if (body.request_id === "req_m1_surf_then_echo" && cmoCallCount === 2) {
          writeJson(
            response,
            200,
            cmoResponse(body, {
              response: {
                status: "delegated",
                answer: {
                  format: "markdown",
                  title: "Intermediate Echo Brief",
                  summary: "Whitelisted specialist delegation for caller to run Echo.",
                  decision: "WAIT",
                  body: "Whitelisted specialist delegation for caller to run Echo. This must not render as final.",
                },
                delegations: [
                  {
                    id: "del_surf_then_echo_copy",
                    targetAgent: "echo",
                    mode: "echo.default",
                    taskType: "cmo_orchestrated_final_copy",
                    platform: "x",
                    content_count: 2,
                    objective: "Write 2 safe X test posts from the Surf signal.",
                    input: {
                      brief: "Use only the usable Surf signal and avoid unsupported claims.",
                      constraints: ["Do not research.", "Do not decide strategy."],
                    },
                  },
                ],
              },
            }),
          );
          return;
        }

        if (body.request_id === "req_m1_surf_then_echo" && cmoCallCount === 3) {
          writeJson(
            response,
            200,
            cmoResponse(body, {
              response: {
                answer: {
                  format: "markdown",
                  title: "Surf Then Echo Final",
                  summary: "CMO accepted Surf signal and Echo copy.",
                  decision: "TEST",
                  body: "Final accepted answer after Surf and Echo execution.",
                },
              },
            }),
          );
          return;
        }

        if (body.request_id === "req_m1_max_rounds") {
          writeJson(
            response,
            200,
            cmoResponse(body, {
              response: {
                status: "delegated",
                answer: {
                  format: "markdown",
                  title: "Intermediate Loop Delegation",
                  summary: "caller should run the next specialist.",
                  decision: "WAIT",
                  body: "caller should run the next specialist. This must not render when the loop budget is exhausted.",
                },
                delegations: [
                  {
                    id: `del_max_rounds_echo_${cmoCallCount}`,
                    targetAgent: "echo",
                    mode: "echo.default",
                    objective: "Create one more test post.",
                    input: {
                      brief: "Loop fixture output.",
                      constraints: ["Do not research.", "Do not decide strategy."],
                    },
                  },
                ],
              },
            }),
          );
          return;
        }

        if (body.request_id === "req_m1_echo_retry_good" && cmoCallCount === 3) {
          writeJson(
            response,
            200,
            cmoResponse(body, {
              response: {
                answer: {
                  format: "markdown",
                  title: "Echo Retry Accepted",
                  summary: "CMO accepted the retried Echo output.",
                  decision: "KEEP",
                  body: "Echo retry accepted. Final copy is ready from Echo.",
                },
              },
            }),
          );
          return;
        }

        if (body.request_id === "req_m1_echo_retry_limit" && cmoCallCount === 3) {
          writeJson(
            response,
            200,
            cmoResponse(body, {
              response: {
                status: "delegated",
                classification: "needs_echo_retry",
                retry_of: "echo",
                retry_reason: "echo_output_unusable_internal_process_language",
                structured_output: {
                  strategyMode: "REVIEW",
                  mainBottleneck: "Echo output still unusable.",
                  decisionLabel: "WAIT",
                  classification: "needs_echo_retry",
                  retry_of: "echo",
                  retry_reason: "echo_output_unusable_internal_process_language",
                },
                answer: {
                  format: "markdown",
                  title: "Unsafe Second Retry Replacement",
                  summary: "This fixture asks for another retry after budget is spent.",
                  decision: "TEST",
                  body: "Post 1: This should not render because a second retry would be required.",
                },
                delegations: [
                  {
                    id: "del_echo_retry_limit_third_attempt",
                    target_agent: "echo",
                    mode: "echo.default",
                    objective: "Create 3 short X posts from the safest angle.",
                    input: {
                      brief: "Try a third Echo attempt, which M1 must not execute.",
                      constraints: ["No internal process language."],
                    },
                  },
                ],
              },
            }),
          );
          return;
        }

        if (body.request_id === "req_m1_translation_followup" && cmoCallCount === 3) {
          writeJson(
            response,
            200,
            cmoResponse(body, {
              response: {
                answer: {
                  format: "markdown",
                  title: "Vietnamese Translation Complete",
                  summary: "CMO accepted Echo retry translation for all three posts.",
                  decision: "KEEP",
                  body: [
                    "POST 1: Xay bang chung kich hoat dau tien truoc khi scale campaign.",
                    "",
                    "POST 2: Cho thay hanh dong Mini App tao gia tri chi trong mot buoc.",
                    "",
                    "POST 3: Giu claim gon va chac cho den khi evidence kich hoat ro rang.",
                  ].join("\n"),
                },
              },
            }),
          );
          return;
        }

        writeJson(
          response,
          200,
          cmoResponse(
            body,
            body.request_id === "req_m1_echo_fail" || body.request_id === "req_m1_surf_fail" || body.request_id === "req_m1_echo_retry_fail"
              ? {
                  response: {
                    answer: {
                      format: "markdown",
                      title: "Unsafe fixture final copy",
                      summary: "This fixture tries to present success even though delegation failed.",
                      decision: "TEST",
                      body: "Post 1: Pretend specialist execution succeeded.\nPost 2: Pretend completed.\nPost 3: Pretend final answer is ready.",
                    },
                  },
                }
              : body.request_id === "req_m1_native_latest_post"
                ? {
                    response: {
                      answer: {
                        format: "markdown",
                        title: "Latest Holdstation X Post",
                        summary: "Surf returned the latest Holdstation X link.",
                        decision: "KEEP",
                        body: "Latest Holdstation post found: https://x.com/HoldstationW/status/123",
                      },
                    },
                  }
                : body.request_id === "req_m1_native_x_signal"
                  ? {
                      response: {
                        answer: {
                          format: "markdown",
                          title: "X Signal Scan",
                          summary: "Surf returned a bounded X signal pack.",
                          decision: "WAIT",
                          body: "Surf found weak World App mini app signal. Treat as source-gathering, not strategy.",
                        },
                      },
                    }
              : {},
          ),
        );
        return;
      }

      if (url.pathname === "/agents/surf/execute") {
        calls.surfUnified += 1;
        calls.surfRequests.push({
          handoffId: body.handoff_id,
          mode: body.mode,
          workspace: body.workspace,
          workspaceId: body.workspace_id,
          appId: body.app_id,
          appName: body.app_name,
          objective: body.objective,
          researchObjective: body.research_objective,
          userQuestion: body.user_question,
          activeSourceUrl: body.active_source_url,
          brief: body.brief ?? body.input?.brief,
          input: body.input,
          outputContract: body.output_contract,
          expectedOutputFormat: body.expected_output_format,
          safetyConstraints: body.safety_constraints,
          sourceContext: body.source_context,
        });
        assert.equal(body.source_agent, "cmo");
        assert.equal(body.target_agent, "surf");
        assert.ok(["surf.default", "surf.x"].includes(body.mode), `unexpected surf mode ${body.mode}`);

        if (body.handoff_id === "del_latest_post" || body.handoff_id === "del_surf_fail") {
          assert.equal(body.mode, "surf.x");
          assert.equal(body.task_type, "latest_post_lookup");
          assert.equal(body.surface, "x");
          assert.equal(body.entity, "Holdstation");
          assert.equal(body.query, "Holdstation latest post");
          assert.equal(body.topic, "Holdstation latest post");
          assert.equal(body.output_contract?.linkRequired, true);
          assert.equal(body.output_contract?.strategySynthesisAllowed, false);
        }

        if (
          body.handoff_id === "del_x_signal_scan" ||
          String(body.handoff_id).startsWith("del_req_m1_surf_then_echo_surf_initial") ||
          String(body.handoff_id).startsWith("del_req_m1_max_rounds_surf_initial")
        ) {
          assert.equal(body.mode, "surf.x");
          assert.equal(body.task_type, "x_signal_scan");
          assert.equal(body.surface, "x");
          assert.deepEqual(body.topics, signalTopics);
          assert.equal(body.output_contract?.strategySynthesisAllowed, false);
        }

        if (body.handoff_id === "del_surf_fail") {
          writeJson(response, 200, {
            schema_version: "surf.response.v1",
            handoff_id: body.handoff_id,
            agent: "surf",
            mode: "surf.x",
            status: "failed",
            failure_reason: "Surf fixture unavailable",
            safety: {
              published: false,
              vault_write: false,
              supabase_mutation: false,
              session_mutation: false,
              raw_capture: false,
              kanban: false,
              openclaw_call: false,
            },
          });
          return;
        }

        if (body.handoff_id === "del_m44e_surf_safe_fail") {
          writeJson(response, 200, {
            schema_version: "surf.response.v1",
            handoff_id: body.handoff_id,
            agent: "surf",
            mode: "surf.default",
            status: "failed",
            error_code: "surf_contract_missing_query",
            safe_reason: "Surf needs a bounded research query or objective.",
            safety: {
              published: false,
              vault_write: false,
              supabase_mutation: false,
              session_mutation: false,
              raw_capture: false,
              kanban: false,
              openclaw_call: false,
            },
          });
          return;
        }

        writeJson(response, 200, {
          schema_version: "surf.response.v1",
          handoff_id: body.handoff_id,
          agent: "surf",
          mode: body.mode,
          status: "completed",
          summary: `${body.mode} returned activation evidence.`,
          research_pack: {
            summary: `${body.mode} returned activation evidence.`,
            sources_used: [body.mode === "surf.x" ? "x" : "web"],
            key_findings: [`${body.mode} says users respond to concrete proof before feature depth.`],
          },
          safety: {
            published: false,
            vault_write: false,
            supabase_mutation: false,
            session_mutation: false,
            raw_capture: false,
            kanban: false,
            openclaw_call: false,
          },
        });
        return;
      }

      if (url.pathname === "/agents/surf-x/execute") {
        calls.legacySurfX += 1;
      } else if (url.pathname === "/agents/surf-last30days/execute") {
        calls.legacySurfLast30Days += 1;
      }

      if (url.pathname === "/agents/echo/execute") {
        calls.echo += 1;
        calls.echoRequests.push(body);
        assert.equal(body.source_agent, "cmo");
        assert.equal(body.target_agent, "echo");
        assert.ok(["cmo_orchestrated_final_copy", "translation_followup", "source_translate"].includes(body.task_type));
        assert.ok(
          [
            "Create 3 short X posts from the safest angle.",
            "Write 2 safe X test posts from the Surf signal.",
            "Create one more test post.",
            "Translate all 3 prior X posts into Vietnamese.",
            "Retry Vietnamese translation for all 3 prior X posts.",
            "Translate the active session-local source excerpt into Vietnamese.",
          ].includes(body.objective),
          `unexpected Echo objective ${body.objective}`,
        );
        if (body.handoff_id !== "del_max_rounds_echo_2" && body.handoff_id !== "del_max_rounds_echo_3" && body.handoff_id !== "del_source_translate") {
          assert.equal(body.platform, "x");
        }
        const expectedEchoAngle = body.handoff_id === "del_echo_fail"
          ? "Use evidence boundaries and produce final copy only through Echo."
          : body.handoff_id === "del_source_translate"
            ? "Translate the active session-local source excerpt into Vietnamese."
          : String(body.handoff_id).includes("translation_followup")
            ? "Translate all three source posts to Vietnamese."
          : body.handoff_id === "del_x_posts_echo_only" ||
              body.handoff_id === "del_echo_completed_unresolved" ||
              String(body.handoff_id).includes("_initial")
            ? "Write channel-native X posts from the CMO angle."
          : String(body.handoff_id).includes("_again")
            ? "Retry without internal process language."
              : body.handoff_id === "del_surf_then_echo_copy"
                ? "Use only the usable Surf signal and avoid unsupported claims."
                : String(body.handoff_id).startsWith("del_max_rounds_echo_")
                  ? "Loop fixture output."
                  : "Write final copy only after Surf evidence is available.";
        assert.equal(
          body.brief?.angle,
          expectedEchoAngle,
        );
        assert.ok(Array.isArray(body.claim_boundaries));
        if (body.task_type === "translation_followup" || body.task_type === "source_translate") {
          assert.deepEqual(body.input_material, translationSourceMaterial);
          assert.deepEqual(body.source_material, translationSourceMaterial);
          assert.deepEqual(body.output_contract?.source_material, translationSourceMaterial);
          assert.deepEqual(body.raw_delegation?.source_material, translationSourceMaterial);
          assert.deepEqual(body.delegation?.source_material, translationSourceMaterial);
          if (body.task_type === "translation_followup") {
            assert.deepEqual(body.output_contract?.translation_source_material, translationSourceMaterial);
          }
        } else {
          assert.equal(body.output_contract, "echo.response.v1");
        }
        assert.ok(body.source_context);
        assert.ok(Array.isArray(body.constraints));

        if (body.handoff_id === "del_echo_fail") {
          writeJson(response, 200, {
            schema_version: "echo.response.v1",
            handoff_id: body.handoff_id,
            agent: "echo",
            mode: "echo.default",
            status: "failed",
            failure_reason: "Echo fixture unavailable",
            outputs: [],
            safety: {
              published: false,
              vault_write: false,
              supabase_mutation: false,
              session_mutation: false,
              raw_capture: false,
              kanban: false,
              openclaw_call: false,
            },
          });
          return;
        }

        if (String(body.handoff_id).includes("del_echo_retry_fail_again")) {
          writeJson(response, 200, {
            schema_version: "echo.response.v1",
            handoff_id: body.handoff_id,
            agent: "echo",
            mode: "echo.default",
            status: "failed",
            failure_reason: "Echo retry fixture unavailable",
            outputs: [],
            safety: {
              published: false,
              vault_write: false,
              supabase_mutation: false,
              session_mutation: false,
              raw_capture: false,
              kanban: false,
              openclaw_call: false,
            },
          });
          return;
        }

        if (body.handoff_id === "del_translation_followup_initial") {
          writeJson(response, 200, {
            schema_version: "echo.response.v1",
            handoff_id: body.handoff_id,
            agent: "echo",
            mode: "echo.default",
            status: "completed",
            outputs: [{ label: "post_1", copy: "POST 1: Xay bang chung kich hoat dau tien truoc khi scale campaign." }],
            notes: ["Fixture intentionally translated only one post."],
            safety: {
              published: false,
              vault_write: false,
              supabase_mutation: false,
              session_mutation: false,
              raw_capture: false,
              kanban: false,
              openclaw_call: false,
            },
          });
          return;
        }

        if (body.handoff_id === "del_source_translate") {
          writeJson(response, 200, {
            schema_version: "echo.response.v1",
            handoff_id: body.handoff_id,
            agent: "echo",
            mode: "echo.source_translate",
            status: "completed",
            outputs: [
              { label: "translation", copy: "Bản dịch tiếng Việt của nguồn đang hoạt động trong phiên." },
            ],
            notes: ["Translated the active session-local source excerpt only."],
            safety: {
              published: false,
              vault_write: false,
              supabase_mutation: false,
              session_mutation: false,
              raw_capture: false,
              kanban: false,
              openclaw_call: false,
            },
          });
          return;
        }

        if (String(body.handoff_id).includes("del_translation_followup_retry")) {
          writeJson(response, 200, {
            schema_version: "echo.response.v1",
            handoff_id: body.handoff_id,
            agent: "echo",
            mode: "echo.default",
            status: "completed",
            outputs: [
              { label: "post_1", copy: "POST 1: Xay bang chung kich hoat dau tien truoc khi scale campaign." },
              { label: "post_2", copy: "POST 2: Cho thay hanh dong Mini App tao gia tri chi trong mot buoc." },
              { label: "post_3", copy: "POST 3: Giu claim gon va chac cho den khi evidence kich hoat ro rang." },
            ],
            notes: ["Translated all three source posts."],
            safety: {
              published: false,
              vault_write: false,
              supabase_mutation: false,
              session_mutation: false,
              raw_capture: false,
              kanban: false,
              openclaw_call: false,
            },
          });
          return;
        }

        writeJson(response, 200, {
          schema_version: "echo.response.v1",
          handoff_id: body.handoff_id,
          agent: "echo",
          mode: "echo.default",
          status: "completed",
          outputs: [{ label: "final_copy", copy: "Prove the win in one action. Then scale." }],
          notes: ["Stayed inside CMO constraints."],
          safety: {
            published: false,
            vault_write: false,
            supabase_mutation: false,
            session_mutation: false,
            raw_capture: false,
            kanban: false,
            openclaw_call: false,
          },
        });
        return;
      }

      if (/vault|openclaw|supabase/i.test(url.pathname)) {
        calls.forbidden += 1;
      } else {
        calls.unexpected += 1;
      }

      writeJson(response, 404, { error: `Unexpected endpoint ${url.pathname}` });
    } catch (error) {
      serverFailure = error;
      writeJson(response, 500, {
        error: error instanceof Error ? error.message : String(error),
        cmoRequests: calls.cmoRequests,
      });
    }
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  const address = server.address();
  assert.ok(address && typeof address === "object", "M1 test server did not expose an address");

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    calls,
    get serverFailure() {
      return serverFailure;
    },
    close: () =>
      new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
};

const restoreEnvValue = (name, value) => {
  if (value === undefined) {
    delete process.env[name];
    return;
  }

  process.env[name] = value;
};

const importPathsFromSource = (source) => {
  const imports = [];
  const importRegex =
    /(?:import\s+(?:type\s+)?(?:[\s\S]*?\s+from\s+)?["']([^"']+)["']|import\s*\(\s*["']([^"']+)["']\s*\)|require\s*\(\s*["']([^"']+)["']\s*\))/g;
  let match = importRegex.exec(source);

  while (match) {
    imports.push(match[1] ?? match[2] ?? match[3]);
    match = importRegex.exec(source);
  }

  return imports;
};

const assertStaticBoundaries = async () => {
  const kernel = await readFile(kernelSourcePath, "utf8");
  const runtime = await readFile(runtimeSourcePath, "utf8");
  const executor = await readFile(executorSourcePath, "utf8");

  for (const needle of [
    "No tactics without diagnosis.",
    "CMO is not a content intern.",
    "DIAGNOSE",
    "FOCUS",
    "PRIORITIZE",
    "REVIEW",
    "RESET",
    "KEEP",
    "CUT",
    "TEST",
    "SCALE",
    "WAIT",
    "CMO must not write Vault directly.",
    "CMO must not mutate Supabase directly.",
    "CMO must not call OpenClaw from Hermes orchestration.",
  ]) {
    assert.match(kernel, new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }

  assert.match(runtime, /buildCleanCmoSkillKernel/);
  assert.match(executor, /targetAgent: HermesCmoExecutableAgent/);
  assert.doesNotMatch(importPathsFromSource(runtime).join("\n"), /vault-auto-capture|vault-capture-writer|supabase-indexing|openclaw/i);
  assert.doesNotMatch(importPathsFromSource(executor).join("\n"), /vault-auto-capture|vault-capture-writer|supabase-indexing|openclaw/i);
};

try {
  await assertStaticBoundaries();

  const { tmpDir, runtimePath } = await compileRuntimeModule();
  const requireFromCheck = createRequire(import.meta.url);
  const { runHermesCmoRuntime, validateHermesCmoRuntimeResponse } = requireFromCheck(runtimePath);
  const server = await startServer();
  const previousEnv = {
    CMO_HERMES_EXECUTION_ENABLED: process.env.CMO_HERMES_EXECUTION_ENABLED,
    CMO_HERMES_BASE_URL: process.env.CMO_HERMES_BASE_URL,
    CMO_HERMES_API_KEY: process.env.CMO_HERMES_API_KEY,
    CMO_HERMES_TIMEOUT_MS: process.env.CMO_HERMES_TIMEOUT_MS,
    CMO_HERMES_LAST30DAYS_TIMEOUT_MS: process.env.CMO_HERMES_LAST30DAYS_TIMEOUT_MS,
    CMO_HERMES_CMO_ORCHESTRATION_ENABLED: process.env.CMO_HERMES_CMO_ORCHESTRATION_ENABLED,
    CMO_HERMES_CMO_MAX_DELEGATIONS: process.env.CMO_HERMES_CMO_MAX_DELEGATIONS,
    CMO_HERMES_CMO_TOOL_EXECUTE_ENABLED: process.env.CMO_HERMES_CMO_TOOL_EXECUTE_ENABLED,
    CMO_HERMES_CMO_TOOL_ENDPOINT: process.env.CMO_HERMES_CMO_TOOL_ENDPOINT,
    CMO_HERMES_CMO_TOOL_TIMEOUT_MS: process.env.CMO_HERMES_CMO_TOOL_TIMEOUT_MS,
    CMO_HERMES_CREATIVE_EXECUTE_TIMEOUT_MS: process.env.CMO_HERMES_CREATIVE_EXECUTE_TIMEOUT_MS,
    CMO_HERMES_CMO_TRACE_DIR: process.env.CMO_HERMES_CMO_TRACE_DIR,
  };
  const m13TraceDir = await mkdtemp(path.join(os.tmpdir(), "hermes-cmo-m1-callsite-guard-traces-"));

  let result;
  let echoFailResult;
  let latestPostResult;
  let xSignalResult;
  let xPostsEchoOnlyResult;
  let surfFailResult;
  let echoRetryGoodResult;
  let echoRetryFailResult;
  let echoRetryLimitResult;
  let surfThenEchoResult;
  let maxRoundsResult;
  let duplicateSameIdResult;
  let duplicateFingerprintResult;
  let duplicateDelegatedStopResult;
  let worldAppSignalResult;
  let echoCompletedUnresolvedResult;
  let translationFollowupResult;
  let m43NativeConversationResult;
  let m43SourceTranslateResult;
  let m13CreativeTimeoutDefaultResult;
  let m13CreativeTopLevelSuccessResult;
  let m13CreativeUploadedAssetResult;
  let m13CmoOwnedCreativeExecutionResult;
  let m13CmoOwnedCreativeReferenceFetchFailedResult;
  let m13CreativeConversationAdvisoryResult;
  let m13CreativeOutboundSanitizedResult;
  let m13CreativeExecutedCreativeResult;
  let m13CreativeFalseOnlySideEffectsResult;

  try {
    process.env.CMO_HERMES_EXECUTION_ENABLED = "true";
    process.env.CMO_HERMES_BASE_URL = server.baseUrl;
    process.env.CMO_HERMES_API_KEY = "test-m1-key";
    process.env.CMO_HERMES_TIMEOUT_MS = "5000";
    process.env.CMO_HERMES_LAST30DAYS_TIMEOUT_MS = "5000";
    process.env.CMO_HERMES_CMO_ORCHESTRATION_ENABLED = "true";
    process.env.CMO_HERMES_CMO_MAX_DELEGATIONS = "3";
    process.env.CMO_HERMES_CMO_TOOL_EXECUTE_ENABLED = "false";
    process.env.CMO_HERMES_CMO_TOOL_ENDPOINT = "/agents/cmo/tool-execute";
    process.env.CMO_HERMES_CMO_TOOL_TIMEOUT_MS = "90000";
    process.env.CMO_HERMES_CMO_TRACE_DIR = m13TraceDir;
    delete process.env.CMO_HERMES_CREATIVE_EXECUTE_TIMEOUT_MS;

    assert.equal(
      validateHermesCmoRuntimeResponse(
        {
          ...cmoResponse(sampleRequest).response,
          direct_vault_write: true,
        },
        sampleRequest,
        { allowExecutableDelegations: true, maxDelegations: 1 },
      ),
      false,
      "direct Vault mutation must remain rejected",
    );
    assert.equal(
      validateHermesCmoRuntimeResponse(
        {
          ...cmoResponse(sampleRequest).response,
          gbrain_mutation: true,
        },
        sampleRequest,
        { allowExecutableDelegations: true, maxDelegations: 1 },
      ),
      false,
      "GBrain mutation must remain rejected",
    );
    assert.equal(
      validateHermesCmoRuntimeResponse(
        {
          ...cmoResponse(sampleRequest).response,
          knowledge_promotion_performed: true,
        },
        sampleRequest,
        { allowExecutableDelegations: true, maxDelegations: 1 },
      ),
      false,
      "knowledge promotion must remain rejected",
    );
    assert.equal(
      validateHermesCmoRuntimeResponse(
        {
          ...cmoResponse(sampleRequest).response,
          status: "success",
        },
        sampleRequest,
        { allowExecutableDelegations: true, maxDelegations: 1 },
      ),
      false,
      "normal non-Creative CMO responses must still reject status=success",
    );
    assert.equal(
      validateHermesCmoRuntimeResponse(
        {
          ...cmoResponse(sampleRequest).response,
          structured_output: {
            classification: "arbitrary_new_classification",
          },
        },
        sampleRequest,
        { allowExecutableDelegations: true, maxDelegations: 1 },
      ),
      false,
      "unknown CMO classification must remain rejected",
    );
    const validResearchFollowupRequest = m44e6ResearchFollowupRequest("req_m44e6_validate_research_followup");
    assert.equal(
      validateHermesCmoRuntimeResponse(
        {
          ...cmoResponse(validResearchFollowupRequest).response,
          answer_basis: {
            mode: "external_research",
            missing_inputs: [],
            assumptions_used: [],
            user_can_override: true,
            suggested_user_inputs: [],
          },
          structured_output: {
            classification: "research_followup",
            response_style: "research_followup",
            tool_policy: "none",
            used_session_local_research_result: true,
          },
          answer: {
            format: "markdown",
            title: "Research follow-up",
            summary: "Uses prior session-local research.",
            decision: "KEEP",
            body: "| Product | Similarity | Note |\n| --- | --- | --- |\n| UserVoice | High | Feedback workflow overlap |",
          },
        },
        validResearchFollowupRequest,
        { allowExecutableDelegations: false, maxDelegations: 0 },
      ),
      true,
      "research_followup classification must validate with session-local research context",
    );
    const missingResearchFollowupRequest = {
      ...validResearchFollowupRequest,
      context_pack: {
        ...validResearchFollowupRequest.context_pack,
        artifacts_in: validResearchFollowupRequest.context_pack.artifacts_in.filter((artifact) => artifact.type !== "session_local_research_result"),
        research_context: undefined,
      },
      source_acquisition: {
        ...validResearchFollowupRequest.source_acquisition,
        session_local_research_results_count: 0,
        research_followup_has_session_artifact: false,
        research_followup_missing_session_artifact: true,
      },
    };
    assert.equal(
      validateHermesCmoRuntimeResponse(
        {
          ...cmoResponse(missingResearchFollowupRequest).response,
          answer_basis: {
            mode: "external_research",
            missing_inputs: [],
            assumptions_used: [],
            user_can_override: true,
            suggested_user_inputs: ["Run external research first."],
          },
          structured_output: {
            classification: "research_followup",
            response_style: "research_followup",
            tool_policy: "none",
          },
          answer: {
            format: "markdown",
            title: "Research follow-up",
            summary: "No prior research is available.",
            decision: "WAIT",
            body: "Please run the research step first.",
          },
        },
        missingResearchFollowupRequest,
        { allowExecutableDelegations: false, maxDelegations: 0 },
      ),
      false,
      "research_followup classification must reject without session-local research context",
    );
    assert.equal(
      validateHermesCmoRuntimeResponse(
        {
          ...cmoResponse(sampleRequest).response,
          delegations: [{ target_agent: "vault_agent", mode: "vault_agent.write", objective: "Write source to Vault" }],
        },
        sampleRequest,
        { allowExecutableDelegations: true, maxDelegations: 1 },
      ),
      false,
      "unknown/forbidden agents must remain rejected",
    );
    assert.equal(
      validateHermesCmoRuntimeResponse(
        {
          ...cmoResponse(sampleRequest).response,
          delegations: [{ target_agent: "echo", mode: "echo.publish", objective: "Publish content" }],
        },
        sampleRequest,
        { allowExecutableDelegations: true, maxDelegations: 1 },
      ),
      false,
      "unknown Echo delegation modes must remain rejected",
    );
    assert.equal(
      validateHermesCmoRuntimeResponse(
        {
          ...cmoResponse(sampleRequest).response,
          answer_basis: {
            mode: "native_conversation",
          },
          structured_output: {
            classification: "native_conversation",
          },
          answer: {
            body: "Ok bro, rõ rồi.",
          },
        },
        sampleRequest,
        { allowExecutableDelegations: true, maxDelegations: 1 },
      ),
      true,
      "known native_conversation simple body answer must validate",
    );
    assert.equal(
      validateHermesCmoRuntimeResponse(
        {
          ...cmoResponse(sampleRequest).response,
          answer_basis: {
            mode: "source_translate",
          },
          structured_output: {
            classification: "source_translate",
          },
          answer: {
            text: "Bản dịch nguồn phiên làm việc.",
          },
        },
        sampleRequest,
        { allowExecutableDelegations: true, maxDelegations: 1 },
      ),
      true,
      "known source_translate simple text answer must validate",
    );
    assert.equal(
      validateHermesCmoRuntimeResponse(
        {
          ...cmoResponse(sampleRequest).response,
          answer_basis: {
            mode: "source_answer",
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
          answer: {
            body: "This answers directly from the active session-local source.",
          },
        },
        sampleRequest,
        { allowExecutableDelegations: true, maxDelegations: 1 },
      ),
      true,
      "known source_answer simple body answer must validate",
    );
    assert.equal(
      validateHermesCmoRuntimeResponse(
        {
          ...cmoResponse(sampleRequest).response,
          answer_basis: {
            mode: "save_to_vault",
          },
          structured_output: {
            classification: "save_to_vault",
            response_style: "save_to_vault",
            tool_policy: "vault_agent",
            save_requires_explicit_user_confirmation: true,
            no_auto_save_13_sources: true,
          },
          answer: {
            body: "Prepare the explicit Save Source flow; do not write 13 Sources from chat.",
          },
        },
        sampleRequest,
        { allowExecutableDelegations: true, maxDelegations: 1 },
      ),
      true,
      "known save_to_vault intent body answer must validate without performing writes",
    );
    assert.equal(
      validateHermesCmoRuntimeResponse(
        {
          ...cmoResponse(sampleRequest).response,
          answer_basis: {
            mode: "source_answer",
          },
          structured_output: {
            classification: "source_answer",
            response_style: "source_answer",
            tool_policy: "publish",
          },
          answer: {
            body: "This invalid tool policy should not validate.",
          },
        },
        sampleRequest,
        { allowExecutableDelegations: true, maxDelegations: 1 },
      ),
      false,
      "unknown source_answer tool_policy must remain rejected",
    );
    assert.equal(
      validateHermesCmoRuntimeResponse(
        {
          ...cmoResponse(sampleRequest).response,
          answer_basis: {
            mode: "native_conversation",
          },
          structured_output: {
            classification: "native_conversation",
          },
          answer: {
            response: "Ok bro, rõ rồi.",
          },
        },
        sampleRequest,
        { allowExecutableDelegations: true, maxDelegations: 1 },
      ),
      false,
      "unknown simple native answer object shape must remain rejected",
    );
    assert.equal(
      validateHermesCmoRuntimeResponse(
        {
          ...cmoResponse(sampleRequest).response,
          answer_basis: {
            mode: "native_conversation",
          },
          structured_output: {
            classification: "native_conversation",
          },
          answer: {},
        },
        sampleRequest,
        { allowExecutableDelegations: true, maxDelegations: 1 },
      ),
      false,
      "native_conversation without body/text must remain rejected",
    );
    assert.equal(
      validateHermesCmoRuntimeResponse(
        {
          ...cmoResponse(sampleRequest).response,
          answer_basis: {
            mode: "source_answer",
          },
          structured_output: {
            classification: "source_answer",
            response_style: "source_answer",
            tool_policy: "none",
          },
          answer: {},
        },
        sampleRequest,
        { allowExecutableDelegations: true, maxDelegations: 1 },
      ),
      false,
      "source_answer without body/text must remain rejected",
    );
    const creativeConversationRequest = m13CmoOwnedCreativeSessionExecutionRequest("req_m13_validate_creative_conversation");
    const creativeConversationAdvisoryValid = validateHermesCmoRuntimeResponse(
      m13CreativeConversationResponse(creativeConversationRequest, "advise"),
      creativeConversationRequest,
      { allowExecutableDelegations: false, maxDelegations: 0 },
    );
    assert.equal(
      creativeConversationAdvisoryValid,
      true,
      "Creative conversation advisory response must validate without asset or state mutation",
    );
    assert.equal(
      validateHermesCmoRuntimeResponse(
        m13CreativeConversationResponse(creativeConversationRequest, "critique", "The asset is clear, but the product moment needs a stronger focal point."),
        creativeConversationRequest,
        { allowExecutableDelegations: false, maxDelegations: 0 },
      ),
      true,
      "Creative conversation critique response must validate without mutation",
    );
    assert.equal(
      validateHermesCmoRuntimeResponse(
        {
          ...m13CreativeConversationResponse(creativeConversationRequest, "ask_clarification", ""),
          answer: null,
          clarifying_question: {
            required: true,
            question: "Should the next version lean more premium or more energetic?",
            reason: "Creative direction fork.",
            missing_inputs: ["tone"],
          },
        },
        creativeConversationRequest,
        { allowExecutableDelegations: false, maxDelegations: 0 },
      ),
      true,
      "Creative conversation clarification response must validate when a clarification question is present",
    );
    assert.equal(
      validateHermesCmoRuntimeResponse(
        m13CreativeConversationResponse(creativeConversationRequest, "advise", "[hermes_local_artifact_path_redacted]/creative/session/output.png"),
        creativeConversationRequest,
        { allowExecutableDelegations: false, maxDelegations: 0 },
      ),
      false,
      "Creative conversation path-like answers must remain rejected",
    );
    assert.equal(
      validateHermesCmoRuntimeResponse(
        m13CreativeConversationResponse(creativeConversationRequest, "advise", "This text claims no mutation but flags one.", {
          creative_asset_mutation: true,
        }),
        creativeConversationRequest,
        { allowExecutableDelegations: false, maxDelegations: 0 },
      ),
      false,
      "Creative conversation mutation flags must contradict and reject the response",
    );
    assert.equal(
      validateHermesCmoRuntimeResponse(
        m13CreativeConversationResponse(sampleRequest, "advise"),
        sampleRequest,
        { allowExecutableDelegations: false, maxDelegations: 0 },
      ),
      false,
      "non-Creative requests must not accept creative_conversation answer_basis",
    );

    result = await runHermesCmoRuntime(sampleRequest);

    assert.equal(server.serverFailure, null, "M1 contract server failed while handling a request");
    assert.equal(server.calls.cmo, 2);
    assert.equal(server.calls.surfUnified, 2);
    assert.equal(server.calls.legacySurfX, 0);
    assert.equal(server.calls.legacySurfLast30Days, 0);
    assert.equal(server.calls.echo, 1);
    assert.equal(server.calls.forbidden, 0);
    assert.equal(server.calls.unexpected, 0);
    assert.deepEqual(result.forbidden_counters, forbiddenCounters);
    assert.deepEqual(result.safety_counters, {
      surfCalls: 2,
      echoCalls: 1,
      vaultAgentCalls: 0,
      vaultWrites: 0,
      directSupabaseMutations: 0,
      openclawCalls: 0,
    });
    assert.equal(result.strategyMode, "REVIEW");
    assert.equal(result.mainBottleneck, "activation proof gap");
    assert.equal(result.decisionLabel, "TEST");
    assert.equal(result.currentStep, "Run a proof-led activation copy test.");
    assert.deepEqual(result.agentsUsed, ["cmo", "surf", "echo"]);
    assert.equal(result.delegationSummary.length, 3);
    assert.equal(result.delegationSummary[0].mode, "surf.default");
    assert.equal(result.delegationSummary[1].mode, "surf.x");
    assert.equal(result.delegationSummary[2].mode, "echo.default");
    assert.deepEqual(
      server.calls.surfRequests.map((surfRequest) => [surfRequest.handoffId, surfRequest.mode]),
      [
        ["del_surf_gap_wrong", "surf.default"],
        ["del_surf_x_explicit", "surf.x"],
      ],
    );
    assert.equal(result.response.activity_summary.events_count, result.activity_events.length);

    echoFailResult = await runHermesCmoRuntime({
      ...sampleRequest,
      request_id: "req_m1_echo_fail",
      session_id: "session_m1_echo_fail",
      turn_id: "turn_m1_echo_fail_001",
      intent: {
        ...sampleRequest.intent,
      },
    });

    assert.equal(server.serverFailure, null, "M1 contract server failed while handling Echo failure fixture");
    assert.equal(server.calls.cmo, 4);
    assert.equal(server.calls.surfUnified, 3);
    assert.equal(server.calls.legacySurfX, 0);
    assert.equal(server.calls.legacySurfLast30Days, 0);
    assert.equal(server.calls.echo, 2);
    assert.equal(server.calls.forbidden, 0);
    assert.equal(server.calls.unexpected, 0);
    assert.deepEqual(echoFailResult.forbidden_counters, forbiddenCounters);
    assert.equal(echoFailResult.delegationSummary.length, 2);
    assert.equal(echoFailResult.delegationSummary[0].mode, "surf.default");
    assert.equal(echoFailResult.delegationSummary[0].status, "completed");
    assert.equal(echoFailResult.delegationSummary[1].mode, "echo.default");
    assert.equal(echoFailResult.delegationSummary[1].status, "failed");
    assert.equal(echoFailResult.delegationSummary[1].failureReason, "Echo fixture unavailable");
    assert.equal(echoFailResult.response.answer?.decision, "WAIT");
    assert.match(echoFailResult.response.answer?.body ?? "", /Echo did not complete/);
    assert.match(echoFailResult.response.answer?.body ?? "", /Echo fixture unavailable/);
    assert.doesNotMatch(echoFailResult.response.answer?.body ?? "", /Post 1:/);
    assert.equal(echoFailResult.response.structured_output?.echo_failed, true);

    latestPostResult = await runHermesCmoRuntime({
      ...sampleRequest,
      request_id: "req_m1_native_latest_post",
      session_id: "session_m1_native_latest_post",
      turn_id: "turn_m1_native_latest_post_001",
      intent: {
        ...sampleRequest.intent,
        user_message: "Check thu X xem bai moi nhat cua Holdstation co gi? Gui minh link nhe",
      },
    });

    assert.equal(server.serverFailure, null, "M1 contract server failed while handling native latest-post fixture");
    assert.equal(latestPostResult.surfCalls, 1);
    assert.equal(latestPostResult.echoCalls, 0);
    assert.deepEqual(latestPostResult.agentsUsed, ["cmo", "surf"]);
    assert.equal(latestPostResult.delegationSummary.length, 1);
    assert.equal(latestPostResult.delegationSummary[0].mode, "surf.x");
    assert.equal(latestPostResult.delegationSummary[0].status, "completed");
    assert.match(latestPostResult.response.answer?.body ?? "", /https:\/\/x\.com\/HoldstationW\/status\/123/);
    assert.doesNotMatch(latestPostResult.response.answer?.body ?? "", /Delegating to specialist/);

    xSignalResult = await runHermesCmoRuntime({
      ...sampleRequest,
      request_id: "req_m1_native_x_signal",
      session_id: "session_m1_native_x_signal",
      turn_id: "turn_m1_native_x_signal_001",
      intent: {
        ...sampleRequest.intent,
        user_message: "Scan X for World App Mini App and trading mini app signal.",
      },
    });

    assert.equal(server.serverFailure, null, "M1 contract server failed while handling native X signal fixture");
    assert.equal(xSignalResult.surfCalls, 1);
    assert.equal(xSignalResult.echoCalls, 0);
    assert.equal(xSignalResult.delegationSummary[0].mode, "surf.x");
    assert.equal(xSignalResult.delegationSummary[0].status, "completed");

    const surfCallsBeforeXPostsOnly = server.calls.surfUnified;
    xPostsEchoOnlyResult = await runHermesCmoRuntime({
      ...sampleRequest,
      request_id: "req_m1_x_posts_echo_only",
      session_id: "session_m1_x_posts_echo_only",
      turn_id: "turn_m1_x_posts_echo_only_001",
      intent: {
        ...sampleRequest.intent,
        user_message: "Create 3 short X posts based on the safest angle.",
      },
    });

    assert.equal(server.serverFailure, null, "M1 contract server failed while handling X-posts Echo-only fixture");
    assert.equal(server.calls.surfUnified, surfCallsBeforeXPostsOnly);
    assert.equal(xPostsEchoOnlyResult.surfCalls, 0);
    assert.equal(xPostsEchoOnlyResult.echoCalls, 1);
    assert.deepEqual(xPostsEchoOnlyResult.agentsUsed, ["cmo", "echo"]);
    assert.equal(xPostsEchoOnlyResult.delegationSummary[0].mode, "echo.default");
    assert.equal(xPostsEchoOnlyResult.delegationSummary[0].status, "completed");

    surfFailResult = await runHermesCmoRuntime({
      ...sampleRequest,
      request_id: "req_m1_surf_fail",
      session_id: "session_m1_surf_fail",
      turn_id: "turn_m1_surf_fail_001",
      intent: {
        ...sampleRequest.intent,
        user_message: "Check X for the latest Holdstation post link.",
      },
    });

    assert.equal(server.serverFailure, null, "M1 contract server failed while handling Surf failure fixture");
    assert.equal(surfFailResult.surfCalls, 1);
    assert.equal(surfFailResult.echoCalls, 0);
    assert.equal(surfFailResult.delegationSummary[0].mode, "surf.x");
    assert.equal(surfFailResult.delegationSummary[0].status, "failed");
    assert.match(surfFailResult.delegationSummary[0].failureReason, /endpoint=\/agents\/surf\/execute/);
    assert.match(surfFailResult.delegationSummary[0].failureReason, /mode=surf\.x/);
    assert.match(surfFailResult.delegationSummary[0].failureReason, /safe_reason=Surf fixture unavailable/);
    assert.equal(surfFailResult.response.answer?.decision, "WAIT");
    assert.match(surfFailResult.response.answer?.body ?? "", /Surf did not complete/);
    assert.match(surfFailResult.response.answer?.body ?? "", /Surf fixture unavailable/);
    assert.doesNotMatch(surfFailResult.response.answer?.body ?? "", /Post 1:/);
    assert.equal(surfFailResult.response.structured_output?.surf_failed, true);
    assert.equal(server.calls.cmo, 12);
    assert.equal(server.calls.surfUnified, 6);
    assert.equal(server.calls.echo, 3);
    assert.equal(server.calls.legacySurfX, 0);
    assert.equal(server.calls.legacySurfLast30Days, 0);
    assert.equal(server.calls.forbidden, 0);
    assert.equal(server.calls.unexpected, 0);

    duplicateSameIdResult = await runHermesCmoRuntime({
      ...sampleRequest,
      request_id: "req_m1_duplicate_same_id",
      session_id: "session_m1_duplicate_same_id",
      turn_id: "turn_m1_duplicate_same_id_001",
      intent: {
        ...sampleRequest.intent,
        user_message: "Check X signal for World App mini app and judge if CMO should use it this week.",
      },
    });

    assert.equal(server.serverFailure, null, "M1 contract server failed while handling duplicate-id fixture");
    assert.equal(duplicateSameIdResult.surfCalls, 1);
    assert.equal(duplicateSameIdResult.echoCalls, 0);
    assert.equal(duplicateSameIdResult.delegationSummary.length, 1);
    assert.equal(duplicateSameIdResult.delegationSummary[0].delegationId, "dlg_req_h6_msg_c7e41e48-0cc_surf_001");
    assert.equal(duplicateSameIdResult.delegationSummary[0].status, "completed");
    assert.match(duplicateSameIdResult.response.answer?.body ?? "", /One Surf result was enough/);

    duplicateFingerprintResult = await runHermesCmoRuntime({
      ...sampleRequest,
      request_id: "req_m1_duplicate_fingerprint",
      session_id: "session_m1_duplicate_fingerprint",
      turn_id: "turn_m1_duplicate_fingerprint_001",
      intent: {
        ...sampleRequest.intent,
        user_message: "Check X signal for World App mini app with no handoff id.",
      },
    });

    assert.equal(server.serverFailure, null, "M1 contract server failed while handling duplicate-fingerprint fixture");
    assert.equal(duplicateFingerprintResult.surfCalls, 1);
    assert.equal(duplicateFingerprintResult.echoCalls, 0);
    assert.equal(duplicateFingerprintResult.delegationSummary.length, 1);
    assert.equal(duplicateFingerprintResult.delegationSummary[0].status, "completed");

    duplicateDelegatedStopResult = await runHermesCmoRuntime({
      ...sampleRequest,
      request_id: "req_m1_duplicate_delegated_stop",
      session_id: "session_m1_duplicate_delegated_stop",
      turn_id: "turn_m1_duplicate_delegated_stop_001",
      intent: {
        ...sampleRequest.intent,
        user_message: "Repeat the same Surf delegation after it already completed.",
      },
    });

    assert.equal(server.serverFailure, null, "M1 contract server failed while handling duplicate delegated stop fixture");
    assert.equal(duplicateDelegatedStopResult.surfCalls, 1);
    assert.equal(duplicateDelegatedStopResult.echoCalls, 0);
    assert.equal(duplicateDelegatedStopResult.delegationSummary.length, 1);
    assert.equal(duplicateDelegatedStopResult.response.answer?.decision, "WAIT");
    assert.match(duplicateDelegatedStopResult.response.answer?.body ?? "", /Specialist completed; final CMO synthesis unresolved\./);
    assert.doesNotMatch(duplicateDelegatedStopResult.response.answer?.body ?? "", /Specialist execution did not complete/);
    assert.doesNotMatch(duplicateDelegatedStopResult.response.answer?.body ?? "", /caller should run Surf again/);
    assert.equal(duplicateDelegatedStopResult.response.structured_output?.completed_specialist_fallback, true);

    echoCompletedUnresolvedResult = await runHermesCmoRuntime({
      ...sampleRequest,
      request_id: "req_m1_echo_completed_unresolved",
      session_id: "session_m1_echo_completed_unresolved",
      turn_id: "turn_m1_echo_completed_unresolved_001",
      intent: {
        ...sampleRequest.intent,
        user_message: "Write 3 safe X posts, then simulate unresolved CMO final synthesis.",
      },
    });

    assert.equal(server.serverFailure, null, "M1 contract server failed while handling Echo completed unresolved fixture");
    assert.equal(echoCompletedUnresolvedResult.surfCalls, 0);
    assert.equal(echoCompletedUnresolvedResult.echoCalls, 1);
    assert.equal(echoCompletedUnresolvedResult.delegationSummary.length, 1);
    assert.equal(echoCompletedUnresolvedResult.delegationSummary[0].mode, "echo.default");
    assert.equal(echoCompletedUnresolvedResult.delegationSummary[0].status, "completed");
    assert.match(echoCompletedUnresolvedResult.response.answer?.body ?? "", /Specialist completed; final CMO synthesis unresolved\./);
    assert.match(echoCompletedUnresolvedResult.response.answer?.body ?? "", /Outputs:/);
    assert.doesNotMatch(echoCompletedUnresolvedResult.response.answer?.body ?? "", /Specialist execution did not complete/);
    assert.doesNotMatch(echoCompletedUnresolvedResult.response.answer?.body ?? "", /caller should run Echo again/);
    assert.equal(echoCompletedUnresolvedResult.response.structured_output?.completed_specialist_fallback, true);

    worldAppSignalResult = await runHermesCmoRuntime({
      ...sampleRequest,
      request_id: "req_m1_world_app_signal",
      session_id: "session_m1_world_app_signal",
      turn_id: "turn_m1_world_app_signal_001",
      intent: {
        ...sampleRequest.intent,
        user_message: "Check X xem co signal gi ve World App mini app khong, roi noi CMO co nen dung lam angle tuan nay khong.",
      },
    });

    assert.equal(server.serverFailure, null, "M1 contract server failed while handling World App signal fixture");
    assert.equal(worldAppSignalResult.surfCalls, 1);
    assert.equal(worldAppSignalResult.echoCalls, 0);
    assert.equal(worldAppSignalResult.delegationSummary.length, 1);
    assert.equal(worldAppSignalResult.delegationSummary[0].mode, "surf.x");
    assert.equal(worldAppSignalResult.delegationSummary[0].status, "completed");
    assert.match(worldAppSignalResult.response.answer?.body ?? "", /One Surf result was enough/);

    surfThenEchoResult = await runHermesCmoRuntime({
      ...sampleRequest,
      request_id: "req_m1_surf_then_echo",
      session_id: "session_m1_surf_then_echo",
      turn_id: "turn_m1_surf_then_echo_001",
      intent: {
        ...sampleRequest.intent,
        user_message: "Check X for usable signal, then write 2 safe test posts if usable.",
      },
    });

    assert.equal(server.serverFailure, null, "M1 contract server failed while handling Surf-then-Echo fixture");
    assert.equal(surfThenEchoResult.surfCalls, 1);
    assert.equal(surfThenEchoResult.echoCalls, 1);
    assert.deepEqual(surfThenEchoResult.agentsUsed, ["cmo", "surf", "echo"]);
    assert.equal(surfThenEchoResult.delegationSummary.length, 2);
    assert.equal(surfThenEchoResult.delegationSummary[0].mode, "surf.x");
    assert.equal(surfThenEchoResult.delegationSummary[1].mode, "echo.default");
    assert.match(surfThenEchoResult.response.answer?.body ?? "", /Final accepted answer after Surf and Echo execution/);
    assert.doesNotMatch(surfThenEchoResult.response.answer?.body ?? "", /Whitelisted specialist delegation/);

    echoRetryGoodResult = await runHermesCmoRuntime({
      ...sampleRequest,
      request_id: "req_m1_echo_retry_good",
      session_id: "session_m1_echo_retry_good",
      turn_id: "turn_m1_echo_retry_good_001",
      intent: {
        ...sampleRequest.intent,
        user_message: "Create 3 short X posts from the safest angle.",
      },
    });

    assert.equal(server.serverFailure, null, "M1 contract server failed while handling Echo retry success fixture");
    assert.equal(echoRetryGoodResult.surfCalls, 0);
    assert.equal(echoRetryGoodResult.echoCalls, 2);
    assert.equal(echoRetryGoodResult.delegationSummary.length, 2);
    assert.equal(echoRetryGoodResult.delegationSummary[0].status, "completed");
    assert.equal(echoRetryGoodResult.delegationSummary[1].status, "completed");
    assert.match(echoRetryGoodResult.response.answer?.body ?? "", /Echo retry accepted/);
    assert.doesNotMatch(echoRetryGoodResult.response.answer?.body ?? "", /CMO-written replacement copy/);

    echoRetryFailResult = await runHermesCmoRuntime({
      ...sampleRequest,
      request_id: "req_m1_echo_retry_fail",
      session_id: "session_m1_echo_retry_fail",
      turn_id: "turn_m1_echo_retry_fail_001",
      intent: {
        ...sampleRequest.intent,
        user_message: "Create 3 short X posts from the safest angle.",
      },
    });

    assert.equal(server.serverFailure, null, "M1 contract server failed while handling Echo retry failure fixture");
    assert.equal(echoRetryFailResult.surfCalls, 0);
    assert.equal(echoRetryFailResult.echoCalls, 2);
    assert.equal(echoRetryFailResult.delegationSummary.length, 2);
    assert.equal(echoRetryFailResult.delegationSummary[1].status, "failed");
    assert.equal(echoRetryFailResult.delegationSummary[1].failureReason, "Echo retry fixture unavailable");
    assert.equal(echoRetryFailResult.response.answer?.decision, "WAIT");
    assert.match(echoRetryFailResult.response.answer?.body ?? "", /Echo output unusable; retry required\./);
    assert.doesNotMatch(echoRetryFailResult.response.answer?.body ?? "", /Post 1:/);
    assert.equal(echoRetryFailResult.response.structured_output?.echo_retry_failed, true);

    const echoCallsBeforeRetryLimit = server.calls.echo;
    echoRetryLimitResult = await runHermesCmoRuntime({
      ...sampleRequest,
      request_id: "req_m1_echo_retry_limit",
      session_id: "session_m1_echo_retry_limit",
      turn_id: "turn_m1_echo_retry_limit_001",
      intent: {
        ...sampleRequest.intent,
        user_message: "Create 3 short X posts from the safest angle.",
      },
    });

    assert.equal(server.serverFailure, null, "M1 contract server failed while handling Echo retry limit fixture");
    assert.equal(echoRetryLimitResult.surfCalls, 0);
    assert.equal(echoRetryLimitResult.echoCalls, 2);
    assert.equal(server.calls.echo, echoCallsBeforeRetryLimit + 2);
    assert.equal(echoRetryLimitResult.delegationSummary.length, 2);
    assert.equal(echoRetryLimitResult.delegationSummary[1].status, "completed");
    assert.equal(echoRetryLimitResult.response.answer?.decision, "WAIT");
    assert.match(echoRetryLimitResult.response.answer?.body ?? "", /Echo output unusable; retry required\./);
    assert.doesNotMatch(echoRetryLimitResult.response.answer?.body ?? "", /Post 1:/);
    assert.equal(echoRetryLimitResult.response.structured_output?.echo_retry_failed, true);
    assert.equal(server.calls.cmo, 36);
    assert.equal(server.calls.surfUnified, 11);
    assert.equal(server.calls.echo, 11);
    assert.equal(server.calls.legacySurfX, 0);
    assert.equal(server.calls.legacySurfLast30Days, 0);
    assert.equal(server.calls.forbidden, 0);
    assert.equal(server.calls.unexpected, 0);

    const echoCallsBeforeMaxRounds = server.calls.echo;
    maxRoundsResult = await runHermesCmoRuntime({
      ...sampleRequest,
      request_id: "req_m1_max_rounds",
      session_id: "session_m1_max_rounds",
      turn_id: "turn_m1_max_rounds_001",
      intent: {
        ...sampleRequest.intent,
        user_message: "Keep delegating until the M1 max-round guard stops the loop.",
      },
    });

    assert.equal(server.serverFailure, null, "M1 contract server failed while handling max-round fixture");
    assert.equal(maxRoundsResult.surfCalls, 1);
    assert.equal(maxRoundsResult.echoCalls, 2);
    assert.equal(server.calls.echo, echoCallsBeforeMaxRounds + 2);
    assert.equal(maxRoundsResult.delegationSummary.length, 3);
    assert.equal(maxRoundsResult.response.answer?.decision, "WAIT");
    assert.match(maxRoundsResult.response.answer?.body ?? "", /Specialist completed; final CMO synthesis unresolved\./);
    assert.doesNotMatch(maxRoundsResult.response.answer?.body ?? "", /Specialist execution did not complete/);
    assert.doesNotMatch(maxRoundsResult.response.answer?.body ?? "", /caller should run the next specialist/);
    assert.equal(maxRoundsResult.response.structured_output?.completed_specialist_fallback, true);
    assert.equal(server.calls.cmo, 40);
    assert.equal(server.calls.surfUnified, 12);
    assert.equal(server.calls.echo, 13);
    assert.equal(server.calls.legacySurfX, 0);
    assert.equal(server.calls.legacySurfLast30Days, 0);
    assert.equal(server.calls.forbidden, 0);
    assert.equal(server.calls.unexpected, 0);

    translationFollowupResult = await runHermesCmoRuntime({
      ...sampleRequest,
      request_id: "req_m1_translation_followup",
      session_id: "session_m1_translation_followup",
      turn_id: "turn_m1_translation_followup_001",
      intent: {
        ...sampleRequest.intent,
        user_message: "3 bai post do doi thanh tieng Viet giup minh nhe",
      },
      context_pack: {
        ...sampleRequest.context_pack,
        selected_context: [
          {
            kind: "recent_chat_message",
            role: "assistant",
            content: translationSourceMaterial.join("\n\n"),
            full_content: translationSourceMaterial.join("\n\n"),
            truncated: false,
          },
        ],
      },
    });

    assert.equal(server.serverFailure, null, "M1 contract server failed while handling translation follow-up fixture");
    assert.equal(translationFollowupResult.surfCalls, 0);
    assert.equal(translationFollowupResult.echoCalls, 2);
    assert.deepEqual(translationFollowupResult.agentsUsed, ["cmo", "echo"]);
    assert.equal(translationFollowupResult.delegationSummary.length, 2);
    assert.equal(translationFollowupResult.delegationSummary[0].status, "completed");
    assert.equal(translationFollowupResult.delegationSummary[1].status, "completed");
    assert.match(translationFollowupResult.response.answer?.body ?? "", /POST 1:/);
    assert.match(translationFollowupResult.response.answer?.body ?? "", /POST 2:/);
    assert.match(translationFollowupResult.response.answer?.body ?? "", /POST 3:/);
    assert.doesNotMatch(translationFollowupResult.response.answer?.body ?? "", /Caller should retry Echo/);

    m43NativeConversationResult = await runHermesCmoRuntime({
      ...sampleRequest,
      request_id: "req_m43_native_conversation",
      session_id: "session_m43_native_conversation",
      turn_id: "turn_m43_native_conversation_001",
      intent: {
        ...sampleRequest.intent,
        user_message: "Ok thanks bro",
      },
      context_pack: {
        ...sampleRequest.context_pack,
        active_source_id: "source_review_fixture",
        artifacts_in: [
          {
            type: "session_local_source",
            schema_version: "cmo.session_local_source.v1",
            workspace_id: "feeback",
            session_id: "session_m43_native_conversation",
            turn_id: "turn_source_001",
            source_id: "source_review_fixture",
            source_type: "url",
            source_title: "Feeback",
            source_text_excerpt: "Feeback project source excerpt.",
            extraction_status: "completed",
            saved_to_vault: false,
            official_project_source: false,
            truth_status: "session_only",
            review_status: "temporary",
            no_auto_promote: true,
          },
        ],
      },
    });

    assert.equal(m43NativeConversationResult.response.answer_basis.mode, "native_conversation");
    assert.equal(m43NativeConversationResult.response.answer?.body, "Ok bro, rõ rồi.");
    assert.equal(m43NativeConversationResult.response.answer?.format, "markdown");
    assert.equal(m43NativeConversationResult.surfCalls, 0);
    assert.equal(m43NativeConversationResult.echoCalls, 0);
    assert.equal(m43NativeConversationResult.response.structured_output?.uses_session_local_source, true);
    assert.equal(m43NativeConversationResult.response.structured_output?.active_source_id, "source_review_fixture");
    assert.equal(
      m43NativeConversationResult.activity_events.some((event) => event.type === "cmo.intent.classified"),
      true,
      "M4.3C native conversation intent activity should pass validation",
    );
    assert.equal(
      m43NativeConversationResult.activity_events.some((event) => event.type === "cmo.source_context.loaded"),
      true,
      "M4.3C session-local source activity should pass validation",
    );

    const sourceAnswerRequest = {
      ...sampleRequest,
      session_id: "session_m43c3_source_answer",
      turn_id: "turn_m43c3_source_answer_001",
      context_pack: {
        ...sampleRequest.context_pack,
        active_source_id: "source_review_fixture",
        artifacts_in: [
          {
            type: "session_local_source",
            schema_version: "cmo.session_local_source.v1",
            workspace_id: "feeback",
            session_id: "session_m43c3_source_answer",
            turn_id: "turn_source_001",
            source_id: "source_review_fixture",
            source_type: "url",
            source_title: "Feeback",
            source_text_excerpt: "Feeback project source excerpt.",
            extraction_status: "completed",
            saved_to_vault: false,
            official_project_source: false,
            truth_status: "session_only",
            review_status: "temporary",
            no_auto_promote: true,
          },
        ],
      },
    };
    const sourceAnswerSummarizeResult = await runHermesCmoRuntime({
      ...sourceAnswerRequest,
      request_id: "req_m43c3_source_answer_summarize",
      intent: {
        ...sampleRequest.intent,
        user_message: "Tóm tắt nguồn này giúp mình.",
      },
    });
    const sourceAnswerQuestionResult = await runHermesCmoRuntime({
      ...sourceAnswerRequest,
      request_id: "req_m43c3_source_answer_question",
      intent: {
        ...sampleRequest.intent,
        user_message: "Feeback này áp dụng được cho sàn nào?",
      },
    });
    const sourceAnswerTranslateDirectResult = await runHermesCmoRuntime({
      ...sourceAnswerRequest,
      request_id: "req_m43c3_source_answer_translate_direct",
      intent: {
        ...sampleRequest.intent,
        user_message: "Dịch trực tiếp đoạn nguồn đang active.",
      },
    });

    for (const sourceAnswerResult of [sourceAnswerSummarizeResult, sourceAnswerQuestionResult, sourceAnswerTranslateDirectResult]) {
      assert.equal(sourceAnswerResult.response.answer_basis.mode, "source_answer");
      assert.equal(sourceAnswerResult.response.structured_output?.classification, "source_answer");
      assert.equal(sourceAnswerResult.response.structured_output?.response_style, "source_answer");
      assert.equal(sourceAnswerResult.response.structured_output?.tool_policy, "none");
      assert.equal(sourceAnswerResult.response.structured_output?.uses_session_local_source, true);
      assert.equal(sourceAnswerResult.response.answer?.format, "markdown");
      assert.equal(sourceAnswerResult.surfCalls, 0);
      assert.equal(sourceAnswerResult.echoCalls, 0);
    }
    assert.match(sourceAnswerSummarizeResult.response.answer?.body ?? "", /summary/i);
    assert.match(sourceAnswerQuestionResult.response.answer?.body ?? "", /session-local source/i);
    assert.match(sourceAnswerTranslateDirectResult.response.answer?.body ?? "", /Bản dịch trực tiếp/);

    const strategyOnlyReviewResult = await runHermesCmoRuntime({
      ...sourceAnswerRequest,
      request_id: "req_m43_strategy_only_review",
      session_id: "session_m43_strategy_only_review",
      turn_id: "turn_m43_strategy_only_review_001",
      intent: {
        ...sampleRequest.intent,
        user_message: "review giúp mình nhé",
      },
    });
    assert.equal(strategyOnlyReviewResult.response.answer_basis.mode, "fully_grounded");
    assert.equal(strategyOnlyReviewResult.response.structured_output?.classification, "strategy_only");
    assert.equal(strategyOnlyReviewResult.response.answer?.body, "Structured review body from the active session-local source.");
    assert.equal(strategyOnlyReviewResult.response.structured_output?.uses_session_local_source, true);
    assert.equal(strategyOnlyReviewResult.surfCalls, 0);
    assert.equal(strategyOnlyReviewResult.echoCalls, 0);
    assert.equal(
      strategyOnlyReviewResult.activity_events.some((event) => event.type === "cmo.source_context.loaded"),
      true,
      "legacy strategy_only review should accept source context activity",
    );
    assert.equal(
      strategyOnlyReviewResult.activity_events.some((event) => event.type === "plan.created"),
      true,
      "legacy strategy_only review should accept structured review activity",
    );

    m43SourceTranslateResult = await runHermesCmoRuntime({
      ...sampleRequest,
      request_id: "req_m43_source_translate",
      session_id: "session_m43_source_translate",
      turn_id: "turn_m43_source_translate_001",
      intent: {
        ...sampleRequest.intent,
        user_message: "Bạn dịch phần này sang tiếng Việt",
      },
      context_pack: {
        ...sampleRequest.context_pack,
        active_source_id: "source_review_fixture",
        artifacts_in: [
          {
            type: "session_local_source",
            schema_version: "cmo.session_local_source.v1",
            workspace_id: "feeback",
            session_id: "session_m43_source_translate",
            turn_id: "turn_source_001",
            source_id: "source_review_fixture",
            source_type: "url",
            source_title: "Feeback",
            source_text_excerpt: translationSourceMaterial.join("\n"),
            extraction_status: "completed",
            saved_to_vault: false,
            official_project_source: false,
            truth_status: "session_only",
            review_status: "temporary",
            no_auto_promote: true,
          },
        ],
      },
    });

    assert.equal(m43SourceTranslateResult.surfCalls, 0);
    assert.equal(m43SourceTranslateResult.echoCalls, 1);
    assert.deepEqual(m43SourceTranslateResult.agentsUsed, ["cmo", "echo"]);
    assert.equal(m43SourceTranslateResult.delegationSummary[0].targetAgent, "echo");
    assert.equal(m43SourceTranslateResult.delegationSummary[0].mode, "echo.source_translate");
    assert.equal(m43SourceTranslateResult.delegationSummary[0].status, "completed");

    const m44aContextLoadedResult = await runHermesCmoRuntime({
      ...sampleRequest,
      request_id: "req_m44a_context_loaded",
      session_id: "session_m44a_context_loaded",
      turn_id: "turn_m44a_context_loaded_001",
      intent: {
        ...sampleRequest.intent,
        user_message: "Fixture with M4.4A context loaded activity.",
      },
    });
    assert.equal(
      m44aContextLoadedResult.activity_events.some((event) => event.type === "cmo.context.loaded"),
      true,
      "M4.4A cmo.context.loaded activity must be accepted",
    );
    assert.equal(m44aContextLoadedResult.activity_events[0].data.context_pack_present, true);
    assert.equal(m44aContextLoadedResult.activity_events[0].data.context_item_count, 4);
    assert.equal(m44aContextLoadedResult.activity_events[0].data.has_source_answer_context, true);
    assert.equal(m44aContextLoadedResult.activity_events[0].data.workspace_id, "feeback");

    const m44aAnswerGroundedResult = await runHermesCmoRuntime({
      ...sampleRequest,
      request_id: "req_m44a_answer_grounded",
      session_id: "session_m44a_answer_grounded",
      turn_id: "turn_m44a_answer_grounded_001",
      intent: {
        ...sampleRequest.intent,
        user_message: "Fixture with M4.4A grounded answer activity.",
      },
    });
    assert.equal(
      m44aAnswerGroundedResult.activity_events.some((event) => event.type === "cmo.answer.grounded"),
      true,
      "M4.4A cmo.answer.grounded activity must be accepted",
    );
    assert.equal(m44aAnswerGroundedResult.activity_events[0].data.answer_basis_mode, "source_answer");
    assert.equal(m44aAnswerGroundedResult.activity_events[0].data.classification, "source_answer");
    assert.equal(m44aAnswerGroundedResult.activity_events[0].data.delegations_count, 0);
    assert.equal(m44aAnswerGroundedResult.activity_events[0].data.safe_metadata_only, true);

    const m44aDurableActionResult = await runHermesCmoRuntime({
      ...sampleRequest,
      request_id: "req_m44a_durable_action_proposed",
      session_id: "session_m44a_durable_action_proposed",
      turn_id: "turn_m44a_durable_action_proposed_001",
      intent: {
        ...sampleRequest.intent,
        user_message: "Fixture with M4.4A durable action proposal.",
      },
    });
    assert.equal(
      m44aDurableActionResult.activity_events.some((event) => event.type === "cmo.durable_action.proposed"),
      true,
      "M4.4A durable action proposal activity must be accepted as metadata only",
    );
    assert.equal(m44aDurableActionResult.response.structured_output?.classification, "save_to_vault");
    assert.equal(m44aDurableActionResult.forbidden_counters.vaultWrites, 0);

    const m44aToolReadResult = await runHermesCmoRuntime({
      ...sampleRequest,
      request_id: "req_m44a_tool_read",
      session_id: "session_m44a_tool_read",
      turn_id: "turn_m44a_tool_read_001",
      intent: {
        ...sampleRequest.intent,
        user_message: "Fixture with M4.4A tool read activity.",
      },
    });
    assert.equal(
      m44aToolReadResult.activity_events.some((event) => event.type === "cmo.tool_read.started"),
      true,
      "M4.4A cmo.tool_read.started activity must be accepted",
    );
    assert.equal(
      m44aToolReadResult.activity_events.some((event) => event.type === "cmo.tool_read.completed"),
      true,
      "M4.4A cmo.tool_read.completed activity must be accepted",
    );
    assert.equal(m44aToolReadResult.activity_events[0].data.tool_family, "web");
    assert.equal(m44aToolReadResult.activity_events[0].data.read_only, true);
    assert.equal(m44aToolReadResult.activity_events[1].data.http_status, 200);

    process.env.CMO_HERMES_CMO_TOOL_EXECUTE_ENABLED = "true";
    const m44d2ToolEndpointResult = await runHermesCmoRuntime({
      ...sampleRequest,
      request_id: "req_m44d2_tool_endpoint",
      session_id: "session_m44d2_tool_endpoint",
      turn_id: "turn_m44d2_tool_endpoint_001",
      workspace: {
        ...sampleRequest.workspace,
        workspace_id: "hold-pay",
        app_id: "hold-pay",
        app_name: "Hold Pay",
      },
      intent: {
        ...sampleRequest.intent,
        user_message: "Tóm tắt link đó",
      },
      context_pack: {
        ...sampleRequest.context_pack,
        active_source_id: "source_hold_pay_faq",
        source_answer_context: {
          type: "source_answer_context",
          schema_version: "cmo.source_answer_context.v1",
          workspace_id: "hold-pay",
          session_id: "session_m44d2_tool_endpoint",
          source_id: "source_hold_pay_faq",
          query: "Tóm tắt link đó",
          query_type: "summarize",
          action: "summarize",
          answerable: true,
          relevant_snippets: ["Home Menu Docs Login nav dump should not be primary evidence."],
          used_source_fields: ["source_text_cache"],
          source_title: "Holdstation Pay FAQ",
          original_url: "https://docs.holdstation.com/holdstation/holdstation-pay/holdstation-pay-faq",
          canonical_url: "https://docs.holdstation.com/holdstation/holdstation-pay/holdstation-pay-faq",
          truth_status: "session_only",
          saved_to_vault: false,
          no_auto_promote: true,
          extraction_quality: "low",
          extraction_coverage: "static_html",
          read_depth: "partial",
          cache_role: "fallback_only",
          nav_heavy: true,
          tool_read_recommended: true,
          warnings: ["nav_heavy"],
        },
        artifacts_in: [
          {
            type: "session_local_source",
            schema_version: "cmo.session_local_source.v1",
            workspace_id: "hold-pay",
            session_id: "session_m44d2_tool_endpoint",
            turn_id: "turn_m44d2_tool_endpoint_001",
            source_id: "source_hold_pay_faq",
            source_type: "url",
            source_title: "Holdstation Pay FAQ",
            original_url: "https://docs.holdstation.com/holdstation/holdstation-pay/holdstation-pay-faq",
            canonical_url: "https://docs.holdstation.com/holdstation/holdstation-pay/holdstation-pay-faq",
            extracted_summary: "Home Menu Docs Login nav dump",
            source_text_excerpt: "Home Menu Docs Login nav dump",
            extraction_status: "partial",
            main_content_quality: "low",
            extraction_coverage: "static_html",
            read_depth: "partial",
            cache_role: "fallback_only",
            nav_heavy: true,
            tool_read_recommended: true,
            saved_to_vault: false,
            official_project_source: false,
            truth_status: "session_only",
            review_status: "temporary",
            no_auto_promote: true,
          },
        ],
      },
      source_acquisition: {
        schema_version: "cmo.source_acquisition_role.v1",
        chat_role: "cache_fallback_context_provider",
        original_url: "https://docs.holdstation.com/holdstation/holdstation-pay/holdstation-pay-faq",
        canonical_url: "https://docs.holdstation.com/holdstation/holdstation-pay/holdstation-pay-faq",
        tool_read_recommended: true,
        extraction_quality: "low",
        extraction_coverage: "static_html",
        read_depth: "partial",
        cache_role: "fallback_only",
        nav_heavy: true,
        saved_to_vault: false,
        no_auto_promote: true,
      },
    });
    assert.equal(m44d2ToolEndpointResult.hermesCmoAgentPath, "/agents/cmo/tool-execute");
    assert.equal(m44d2ToolEndpointResult.hermesCmoEndpointKind, "tool_execute");
    assert.equal(m44d2ToolEndpointResult.hermesCmoEndpointTimeoutMs, 90000);
    assert.deepEqual(m44d2ToolEndpointResult.sideEffects, {
      vault_write: false,
      memory_mutation: false,
      gbrain_mutation: false,
      source_auto_save: false,
      knowledge_promotion: false,
      supabase_mutation: false,
      session_mutation: false,
      raw_capture: false,
      repo_mutation: false,
      publishing: false,
    });
    assert.equal(m44d2ToolEndpointResult.response.answer_basis.mode, "tool_read");
    assert.equal(m44d2ToolEndpointResult.response.answer?.body, "Holdstation Pay FAQ summary from a tool-capable CMO read.");
    assert.deepEqual(m44d2ToolEndpointResult.response.tools_used, ["browser_navigate", "browser_snapshot", "browser_console"]);
    assert.equal(m44d2ToolEndpointResult.response.tool_trace_summary?.tool_read_count, 3);
    assert.equal(m44d2ToolEndpointResult.response.activity_summary.events_count, 4);
    assert.equal(m44d2ToolEndpointResult.response.activity_summary.derived_from_activity_events, true);
    assert.equal(m44d2ToolEndpointResult.response.activity_summary.tool_reads_count, 3);
    assert.equal(
      m44d2ToolEndpointResult.activity_events.some((event) => event.type === "cmo.tool_read.completed"),
      true,
      "tool endpoint must preserve safe CMO tool-read activity",
    );
    assert.equal(
      m44d2ToolEndpointResult.activity_events.every((event) => event.source.mode === "cmo.tool_capable"),
      true,
      "tool endpoint must accept cmo.tool_capable activity source mode",
    );
    assert.equal(
      m44d2ToolEndpointResult.activity_events.some((event) => event.type === "cmo.answer.grounded" && event.data.used_live_tool_read === true),
      true,
      "tool endpoint must accept grounded live tool-read metadata",
    );

    await assert.rejects(
      () => runHermesCmoRuntime(m44dToolEndpointRequest("req_m44d_tool_endpoint_path_answer")),
      /Rejected field: answer_path_like/,
      "tool_read answer with path-like artifact text must be blocked by the final answer guard",
    );

    await assert.rejects(
      () => runHermesCmoRuntime(m44dToolEndpointRequest("req_m44d_tool_endpoint_side_effects_true")),
      /Hermes CMO Agent response included unsafe side_effects/,
      "tool endpoint response with any side effect=true must reject",
    );

    await assert.rejects(
      () => runHermesCmoRuntime(m44dToolEndpointRequest("req_m44d_tool_endpoint_creative_side_effects")),
      /Hermes CMO Agent response included unsafe side_effects/,
      "non-Creative response with executed_creative=true must reject",
    );

    await assert.rejects(
      () => runHermesCmoRuntime(m44dToolEndpointRequest("req_m44d_tool_endpoint_creative_execution_mode")),
      /Rejected field: source_invalid:mode=creative_execution/,
      "non-Creative response with source.mode=creative_execution must reject",
    );

    await assert.rejects(
      () => runHermesCmoRuntime(m44dToolEndpointRequest("req_m44d_tool_endpoint_unsafe_tool_result")),
      /Rejected field: data_unsafe:cmo\.tool_read\.completed key=data\.tool_result type=string reason=unsafe_key_name/,
      "tool endpoint activity data must reject raw tool_result",
    );

    await assert.rejects(
      () => runHermesCmoRuntime(m44dToolEndpointRequest("req_m44d_tool_endpoint_unsafe_trace")),
      /Rejected field: activity_summary_invalid:unsafe_tool_trace_summary key=tool_trace_summary\.html type=string reason=unsafe_key_name/,
      "tool endpoint response must reject unsafe tool_trace_summary metadata",
    );

    await assert.rejects(
      () => runHermesCmoRuntime(m44dToolEndpointRequest("req_m44d_tool_endpoint_vault_agent_source")),
      /Rejected field: source_invalid:agent=vault_agent/,
      "tool endpoint activity source must reject direct Vault Agent source",
    );

    await assert.rejects(
      () => runHermesCmoRuntime(m44dToolEndpointRequest("req_m44d_tool_endpoint_arbitrary_mode")),
      /Rejected field: source_invalid:mode=arbitrary_tool/,
      "tool endpoint activity source must reject arbitrary CMO source modes",
    );

    await assert.rejects(
      () =>
        runHermesCmoRuntime({
          ...sampleRequest,
          request_id: "req_m44d_unknown_answer_basis",
          session_id: "session_m44d_unknown_answer_basis",
          turn_id: "turn_m44d_unknown_answer_basis_001",
        }),
      /Rejected field: answer_basis_invalid:mode=tool_read/,
      "legacy hermes.cmo.response.v1 must still reject tool_read answer_basis mode",
    );

    const surfCallsBeforeExternalResearch = server.calls.surfUnified;
    const m44eExternalResearchResult = await runHermesCmoRuntime(m44eExternalResearchRequest("req_m44e_external_research_active_source"));
    assert.equal(m44eExternalResearchResult.hermesCmoAgentPath, "/agents/cmo/tool-execute");
    assert.equal(m44eExternalResearchResult.hermesCmoEndpointKind, "tool_execute");
    assert.equal(m44eExternalResearchResult.response.answer_basis.mode, "external_research");
    assert.equal(m44eExternalResearchResult.response.structured_output?.classification, "external_research");
    assert.match(m44eExternalResearchResult.response.answer?.body ?? "", /Surf-backed answer/);
    assert.equal(m44eExternalResearchResult.surfCalls, 1);
    assert.deepEqual(m44eExternalResearchResult.agentsUsed, ["cmo", "surf"]);
    assert.equal(server.calls.surfUnified, surfCallsBeforeExternalResearch + 1);
    const m44eSurfRequest = server.calls.surfRequests.find((request) => request.handoffId === "del_m44e_feeback_competitors");
    assert.ok(m44eSurfRequest, "external research route must execute Surf delegation");
    assert.equal(m44eSurfRequest.mode, "surf.default");
    assert.match(m44eSurfRequest.objective, /current products similar to Feeback/i);
    assert.match(m44eSurfRequest.brief, /workspace_id=feeback/);
    assert.match(m44eSurfRequest.brief, /app_name=Feeback/);
    assert.match(m44eSurfRequest.brief, /https:\/\/feeback\.org/);
    assert.equal(m44eSurfRequest.outputContract?.no_auto_save_13_sources, true);
    assert.equal(m44eSurfRequest.outputContract?.no_auto_promote_12_knowledge, true);
    assert.equal(m44eSurfRequest.outputContract?.no_gbrain_mutation, true);
    assert.equal(m44eSurfRequest.workspace, "feeback");
    assert.equal(m44eSurfRequest.workspaceId, "feeback");
    assert.equal(m44eSurfRequest.appId, "feeback");
    assert.equal(m44eSurfRequest.appName, "Feeback");
    assert.match(m44eSurfRequest.userQuestion, /Feeback/);
    assert.equal(m44eSurfRequest.researchObjective, "Research whether there are current products similar to Feeback.");
    assert.equal(m44eSurfRequest.activeSourceUrl, "https://feeback.org");
    assert.equal(m44eSurfRequest.expectedOutputFormat?.desired_format, "concise market landscape with sources and confidence");
    assert.equal(m44eSurfRequest.safetyConstraints?.read_only, true);
    assert.equal(m44eSurfRequest.safetyConstraints?.no_vault_write, true);
    assert.equal(m44eSurfRequest.safetyConstraints?.no_source_auto_save, true);
    assert.equal(m44eSurfRequest.safetyConstraints?.no_knowledge_promotion, true);
    assert.equal(m44eSurfRequest.safetyConstraints?.no_gbrain_mutation, true);
    assert.equal(m44eSurfRequest.sourceContext?.active_source_url, "https://feeback.org");

    const m44eSurfSafeFailResult = await runHermesCmoRuntime(m44eExternalResearchRequest("req_m44e_surf_safe_failure"));
    assert.equal(m44eSurfSafeFailResult.hermesCmoAgentPath, "/agents/cmo/tool-execute");
    assert.equal(m44eSurfSafeFailResult.hermesCmoEndpointKind, "tool_execute");
    assert.equal(m44eSurfSafeFailResult.surfCalls, 1);
    assert.equal(m44eSurfSafeFailResult.delegationSummary[0].mode, "surf.default");
    assert.equal(m44eSurfSafeFailResult.delegationSummary[0].status, "failed");
    assert.match(m44eSurfSafeFailResult.delegationSummary[0].failureReason, /endpoint=\/agents\/surf\/execute/);
    assert.match(m44eSurfSafeFailResult.delegationSummary[0].failureReason, /mode=surf\.default/);
    assert.match(m44eSurfSafeFailResult.delegationSummary[0].failureReason, /error_code=surf_contract_missing_query/);
    assert.match(m44eSurfSafeFailResult.delegationSummary[0].failureReason, /safe_reason=Surf needs a bounded research query or objective/);
    assert.match(m44eSurfSafeFailResult.response.answer?.body ?? "", /Surf did not complete/);
    assert.match(m44eSurfSafeFailResult.response.answer?.body ?? "", /surf_contract_missing_query/);

    const m44e6ResearchFollowupTableResult = await runHermesCmoRuntime(m44e6ResearchFollowupRequest("req_m44e6_research_followup_table"));
    assert.equal(m44e6ResearchFollowupTableResult.hermesCmoAgentPath, "/agents/cmo/tool-execute");
    assert.equal(m44e6ResearchFollowupTableResult.hermesCmoEndpointKind, "tool_execute");
    assert.equal(m44e6ResearchFollowupTableResult.surfCalls, 0);
    assert.equal(m44e6ResearchFollowupTableResult.response.answer_basis.schema_version, "cmo.answer_basis.v1");
    assert.equal(m44e6ResearchFollowupTableResult.response.answer_basis.mode, "session_research_artifact");
    assert.equal(m44e6ResearchFollowupTableResult.response.context_resolution?.schema_version, "cmo.context_resolution.v1");
    assert.equal(m44e6ResearchFollowupTableResult.response.context_resolution?.status, "resolved");
    assert.equal(m44e6ResearchFollowupTableResult.response.context_resolution?.semantic_intent?.primary, "research_followup");
    assert.equal(m44e6ResearchFollowupTableResult.response.context_resolution?.semantic_intent?.requires_surf, false);
    assert.equal(m44e6ResearchFollowupTableResult.response.context_resolution?.used_live_surf, false);
    assert.equal(m44e6ResearchFollowupTableResult.response.structured_output?.classification, "research_followup");
    assert.equal(m44e6ResearchFollowupTableResult.response.structured_output?.response_style, "research_followup");
    assert.equal(m44e6ResearchFollowupTableResult.response.structured_output?.used_session_local_research_result, true);
    assert.match(m44e6ResearchFollowupTableResult.response.answer?.body ?? "", /\| Product \| Similarity \| Note \|/);

    const m44e6ResearchFollowupRankResult = await runHermesCmoRuntime(
      m44e6ResearchFollowupRequest(
        "req_m44e6_research_followup_rank",
        "Trong 5 bên đó, bên nào giống Hold Pay nhất nếu xét merchant payout API + local fiat rail?",
      ),
    );
    assert.equal(m44e6ResearchFollowupRankResult.hermesCmoAgentPath, "/agents/cmo/tool-execute");
    assert.equal(m44e6ResearchFollowupRankResult.surfCalls, 0);
    assert.equal(m44e6ResearchFollowupRankResult.response.answer_basis.mode, "session_research_artifact");
    assert.equal(m44e6ResearchFollowupRankResult.response.context_resolution?.semantic_intent?.primary, "research_followup");
    assert.equal(m44e6ResearchFollowupRankResult.response.context_resolution?.semantic_intent?.subtype, "ranking_similarity");
    assert.equal(m44e6ResearchFollowupRankResult.response.structured_output?.classification, "research_followup");
    assert.equal(m44e6ResearchFollowupRankResult.response.structured_output?.response_style, "research_followup");
    assert.match(m44e6ResearchFollowupRankResult.response.answer?.body ?? "", /existing Surf results/);

    const m44eSourceKycResult = await runHermesCmoRuntime({
      ...m44dToolEndpointRequest("req_m44e_source_kyc_tool_endpoint"),
      intent: {
        ...sampleRequest.intent,
        user_message: "Merchant/Partner có chịu trách nhiệm KYC/AML không?",
      },
    });
    assert.equal(m44eSourceKycResult.hermesCmoAgentPath, "/agents/cmo/tool-execute");
    assert.equal(m44eSourceKycResult.hermesCmoEndpointKind, "tool_execute");
    assert.equal(m44eSourceKycResult.response.answer_basis.mode, "tool_read");
    assert.equal(m44eSourceKycResult.response.answer?.body, "Merchant/Partner KYC/AML answer from the active source.");

    const m44d2NativeExecuteResult = await runHermesCmoRuntime({
      ...sampleRequest,
      request_id: "req_m44d2_native_execute",
      session_id: "session_m44d2_native_execute",
      turn_id: "turn_m44d2_native_execute_001",
      intent: {
        ...sampleRequest.intent,
        user_message: "Thanks, that is clear.",
      },
    });
    assert.equal(m44d2NativeExecuteResult.hermesCmoAgentPath, "/agents/cmo/execute");
    assert.equal(m44d2NativeExecuteResult.hermesCmoEndpointKind, "execute");
    process.env.CMO_HERMES_CMO_TOOL_EXECUTE_ENABLED = "false";

    await assert.rejects(
      () =>
        runHermesCmoRuntime({
          ...sampleRequest,
          request_id: "req_m43_unknown_activity",
          session_id: "session_m43_unknown_activity",
          turn_id: "turn_m43_unknown_activity_001",
          intent: {
            ...sampleRequest.intent,
            user_message: "Fixture with unknown activity event.",
          },
        }),
      /activity_events did not match hermes\.activity\.event\.v1/,
      "unknown activity events must still be rejected",
    );

    await assert.rejects(
      () =>
        runHermesCmoRuntime({
          ...sampleRequest,
          request_id: "req_m44a_context_loaded_old_fields",
          session_id: "session_m44a_context_loaded_old_fields",
          turn_id: "turn_m44a_context_loaded_old_fields_001",
          intent: {
            ...sampleRequest.intent,
            user_message: "Fixture with old Hermes context loaded metadata fields.",
          },
        }),
      /Rejected field: data_unsafe:cmo\.context\.loaded key=data\.selected_context_count type=number reason=unknown_key/,
      "old cmo.context.loaded fields must be rejected now that Hermes emits Product-safe keys",
    );

    await assert.rejects(
      () =>
        runHermesCmoRuntime({
          ...sampleRequest,
          request_id: "req_m44a_context_loaded_raw_text",
          session_id: "session_m44a_context_loaded_raw_text",
          turn_id: "turn_m44a_context_loaded_raw_text_001",
          intent: {
            ...sampleRequest.intent,
            user_message: "Fixture with raw source text in context loaded metadata.",
          },
        }),
      /Rejected field: data_unsafe:cmo\.context\.loaded key=data\.source_text type=string reason=unsafe_key_name/,
      "cmo.context.loaded must reject raw source text fields",
    );

    await assert.rejects(
      () =>
        runHermesCmoRuntime({
          ...sampleRequest,
          request_id: "req_m44a_context_loaded_full_pack",
          session_id: "session_m44a_context_loaded_full_pack",
          turn_id: "turn_m44a_context_loaded_full_pack_001",
          intent: {
            ...sampleRequest.intent,
            user_message: "Fixture with full context pack in context loaded metadata.",
          },
        }),
      /Rejected field: data_unsafe:cmo\.context\.loaded key=data\.context_pack type=object reason=unsafe_key_name/,
      "cmo.context.loaded must reject full context_pack objects",
    );

    await assert.rejects(
      () =>
        runHermesCmoRuntime({
          ...sampleRequest,
          request_id: "req_m44a_answer_grounded_raw_text",
          session_id: "session_m44a_answer_grounded_raw_text",
          turn_id: "turn_m44a_answer_grounded_raw_text_001",
          intent: {
            ...sampleRequest.intent,
            user_message: "Fixture with raw source text in answer grounded metadata.",
          },
        }),
      /Rejected field: data_unsafe:cmo\.answer\.grounded key=data\.source_text type=string reason=unsafe_key_name/,
      "cmo.answer.grounded must reject raw source text fields",
    );

    await assert.rejects(
      () =>
        runHermesCmoRuntime({
          ...sampleRequest,
          request_id: "req_m44a_answer_grounded_unknown_key",
          session_id: "session_m44a_answer_grounded_unknown_key",
          turn_id: "turn_m44a_answer_grounded_unknown_key_001",
          intent: {
            ...sampleRequest.intent,
            user_message: "Fixture with unknown answer grounded metadata.",
          },
        }),
      /Rejected field: data_unsafe:cmo\.answer\.grounded key=data\.unexpected_grounding_key type=string reason=unknown_key/,
      "cmo.answer.grounded must reject unknown metadata keys",
    );

    await assert.rejects(
      () =>
        runHermesCmoRuntime({
          ...sampleRequest,
          request_id: "req_m44a_tool_read_completed_html",
          session_id: "session_m44a_tool_read_completed_html",
          turn_id: "turn_m44a_tool_read_completed_html_001",
          intent: {
            ...sampleRequest.intent,
            user_message: "Fixture with raw HTML in tool read completed metadata.",
          },
        }),
      /Rejected field: data_unsafe:cmo\.tool_read\.completed key=data\.html type=string reason=unsafe_key_name/,
      "cmo.tool_read.completed must reject raw HTML fields",
    );

    await assert.rejects(
      () =>
        runHermesCmoRuntime({
          ...sampleRequest,
          request_id: "req_m44a_durable_action_unsafe_write",
          session_id: "session_m44a_durable_action_unsafe_write",
          turn_id: "turn_m44a_durable_action_unsafe_write_001",
          intent: {
            ...sampleRequest.intent,
            user_message: "Fixture with unsafe durable action write metadata.",
          },
        }),
      /Rejected field: data_unsafe:cmo\.durable_action\.proposed key=data\.direct_write_performed type=boolean reason=raw_content_like_value/,
      "durable action metadata must reject direct write completion",
    );

    await assert.rejects(
      () =>
        runHermesCmoRuntime({
          ...sampleRequest,
          request_id: "req_m44a_activity_secret_value",
          session_id: "session_m44a_activity_secret_value",
          turn_id: "turn_m44a_activity_secret_value_001",
          intent: {
            ...sampleRequest.intent,
            user_message: "Fixture with secret-like activity metadata.",
          },
        }),
      /Rejected field: data_unsafe:cmo\.answer\.grounded key=data\.classification type=string reason=secret_like_value/,
      "activity metadata must reject secret-like values",
    );

    await assert.rejects(
      () =>
        runHermesCmoRuntime({
          ...sampleRequest,
          request_id: "req_m44a_unsafe_activity_data",
          session_id: "session_m44a_unsafe_activity_data",
          turn_id: "turn_m44a_unsafe_activity_data_001",
          intent: {
            ...sampleRequest.intent,
            user_message: "Fixture with unsafe activity data.",
          },
        }),
      /Rejected field: data_unsafe:cmo\.tool_read\.completed key=data\.raw_source_text type=string reason=unsafe_key_name/,
      "M4.4A metadata events must reject unsafe raw source text",
    );

    process.env.CMO_HERMES_CMO_ORCHESTRATION_ENABLED = "false";
    m13CreativeTimeoutDefaultResult = await runHermesCmoRuntime(m13CreativeExecutionRequest("req_m13_creative_timeout_default"));
    assert.equal(m13CreativeTimeoutDefaultResult.hermesCmoAgentPath, "/agents/cmo/execute");
    assert.equal(m13CreativeTimeoutDefaultResult.hermesCmoEndpointKind, "execute");
    assert.equal(m13CreativeTimeoutDefaultResult.hermesCmoRouteDecision, "creative_execution");
    assert.equal(m13CreativeTimeoutDefaultResult.hermesCmoEndpointTimeoutMs, 300000);
    assert.equal(m13CreativeTimeoutDefaultResult.hermesCmoEndpointTimeoutSource, "creative_execute");
    assert.deepEqual(
      server.calls.cmoRequests.find((cmoRequest) => cmoRequest.requestId === "req_m13_creative_timeout_default")?.allowedAgents,
      ["creative"],
    );
    m13CreativeTopLevelSuccessResult = await runHermesCmoRuntime(m13CreativeExecutionRequest("req_m13_creative_top_level_success"));
    assert.equal(m13CreativeTopLevelSuccessResult.response.status, "completed");
    assert.equal(m13CreativeTopLevelSuccessResult.response.routed_to_creative, true);
    assert.equal(m13CreativeTopLevelSuccessResult.response.image_path, "/tmp/creative-agent-smoke/hold-pay-top-level.png");
    assert.equal(m13CreativeTopLevelSuccessResult.response.bytes, 256);
    assert.equal(m13CreativeTopLevelSuccessResult.response.sha256, "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");
    assert.equal(m13CreativeTopLevelSuccessResult.response.model, "gpt-5.5");
    assert.equal(m13CreativeTopLevelSuccessResult.response.operation, "responses image_generation");
    assert.equal(m13CreativeTopLevelSuccessResult.response.structured_output.creative_response_received, true);
    assert.equal(m13CreativeTopLevelSuccessResult.response.structured_output.creative_metadata_present, true);
    assert.equal(m13CreativeTopLevelSuccessResult.response.structured_output.fallback_used, false);
    assert.equal(m13CreativeTopLevelSuccessResult.response.structured_output.product_artifact_status, "artifact_transport_missing");
    assert.equal(m13CreativeTopLevelSuccessResult.response.structured_output.side_effects_present, true);
    assert.equal(m13CreativeTopLevelSuccessResult.response.structured_output.side_effects_allowed_for_creative, true);
    assert.equal(m13CreativeTopLevelSuccessResult.response.artifacts[0].transport_status, "artifact_transport_missing");
    assert.deepEqual(m13CreativeTopLevelSuccessResult.sideEffects, {
      creative_generation: false,
      executed_creative: false,
      local_artifact_created: false,
      creative_asset_metadata: false,
      publishing: false,
      vault_write: false,
      supabase_mutation: false,
      credential_write: false,
      arbitrary_filesystem_write: false,
    });
    m13CreativeUploadedAssetResult = await runHermesCmoRuntime(m13CreativeExecutionRequest("req_m13_creative_uploaded_asset"));
    assert.equal(m13CreativeUploadedAssetResult.response.status, "completed");
    assert.equal(m13CreativeUploadedAssetResult.response.answer?.body, "Uploaded Product-owned Creative asset.");
    assert.equal(m13CreativeUploadedAssetResult.response.structured_output.product_artifact_status, "uploaded");
    assert.equal(m13CreativeUploadedAssetResult.response.artifacts[0].transport_status, "uploaded");
    assert.equal(m13CreativeUploadedAssetResult.response.artifacts[0].status, "stored");
    assert.equal(m13CreativeUploadedAssetResult.response.artifacts[0].render_url, "https://cmo.jayju.cloud/api/signed/creative_uploaded_fixture");
    assert.equal(m13CreativeUploadedAssetResult.response.artifacts[0].signed_url, "https://cmo.jayju.cloud/api/signed/creative_uploaded_fixture");
    assert.equal(m13CreativeUploadedAssetResult.response.artifacts[0].mime_type, "image/png");
    assert.equal(JSON.stringify(m13CreativeUploadedAssetResult.response.artifacts).includes("/tmp/"), false);
    assert.deepEqual(m13CreativeUploadedAssetResult.activity_events.map((event) => event.source.mode), ["creative_execution", "creative_execution"]);
    assert.deepEqual(m13CreativeUploadedAssetResult.activity_events.map((event) => event.type), ["creative.started", "creative.asset_ready"]);
    m13CmoOwnedCreativeExecutionResult = await runHermesCmoRuntime(m13CmoOwnedCreativeSessionExecutionRequest("req_m13_cmo_owned_creative_execution_live_shape"));
    assert.equal(m13CmoOwnedCreativeExecutionResult.hermesCmoRouteDecision, "creative_session");
    assert.equal(m13CmoOwnedCreativeExecutionResult.hermesCmoEndpointTimeoutMs, 300000);
    assert.equal(m13CmoOwnedCreativeExecutionResult.hermesCmoEndpointTimeoutSource, "creative_execute");
    assert.equal(m13CmoOwnedCreativeExecutionResult.response.answer_basis.mode, "creative_execution");
    assert.equal(m13CmoOwnedCreativeExecutionResult.response.structured_output.creative_execution_response_received, true);
    assert.equal(m13CmoOwnedCreativeExecutionResult.response.structured_output.creative_execution_owner, "cmo");
    assert.equal(m13CmoOwnedCreativeExecutionResult.response.structured_output.creative_execution_requested, false);
    assert.equal(m13CmoOwnedCreativeExecutionResult.response.structured_output.creative_execution_canonicalized, true);
    assert.equal(m13CmoOwnedCreativeExecutionResult.response.structured_output.activity_events_allowed_for_creative_execution, true);
    assert.equal(m13CmoOwnedCreativeExecutionResult.response.structured_output.creative_ideation_canonicalized, undefined);
    assert.equal(m13CmoOwnedCreativeExecutionResult.response.structured_output.activity_events_allowed_for_creative_ideation, undefined);
    assert.equal(m13CmoOwnedCreativeExecutionResult.response.structured_output.m1_validation_result, "accepted");
    assert.equal(m13CmoOwnedCreativeExecutionResult.response.structured_output.fallback_used, false);
    assert.equal(m13CmoOwnedCreativeExecutionResult.response.artifacts[0].transport_status, "uploaded");
    assert.equal(m13CmoOwnedCreativeExecutionResult.response.artifacts[0].render_url, "https://cmo.jayju.cloud/api/signed/creative_edited_fixture");
    assert.deepEqual(m13CmoOwnedCreativeExecutionResult.activity_events.map((event) => event.type), ["creative.started", "creative.generating"]);
    assert.deepEqual(m13CmoOwnedCreativeExecutionResult.activity_events.map((event) => event.source.mode), ["creative_execution", "creative_execution"]);
    m13CreativeConversationAdvisoryResult = await runHermesCmoRuntime(m13CmoOwnedCreativeSessionExecutionRequest("req_m13_creative_conversation_advisory"));
    assert.equal(m13CreativeConversationAdvisoryResult.response.status, "completed");
    assert.equal(m13CreativeConversationAdvisoryResult.response.answer_basis.mode, "creative_conversation");
    assert.match(m13CreativeConversationAdvisoryResult.response.answer?.body ?? "", /không bị hiền quá/i);
    assert.equal(m13CreativeConversationAdvisoryResult.response.structured_output.creative_conversation_response_received, true);
    assert.equal(m13CreativeConversationAdvisoryResult.response.structured_output.creative_conversation_mode, "advisory");
    assert.equal(m13CreativeConversationAdvisoryResult.response.structured_output.creative_assets_count, 0);
    assert.equal(m13CreativeConversationAdvisoryResult.response.structured_output.creative_asset_mutation, false);
    assert.equal(m13CreativeConversationAdvisoryResult.response.structured_output.creative_state_mutation, false);
    assert.equal(m13CreativeConversationAdvisoryResult.response.structured_output.m1_validation_result, "accepted");
    assert.equal(m13CreativeConversationAdvisoryResult.response.structured_output.fallback_used, false);
    assert.equal(m13CreativeConversationAdvisoryResult.response.artifacts.length, 0);
    m13CreativeOutboundSanitizedResult = await runHermesCmoRuntime(m13PollutedCmoOwnedCreativeSessionExecutionRequest("req_m13_creative_outbound_sanitized"));
    assert.equal(m13CreativeOutboundSanitizedResult.response.status, "completed");
    assert.equal(m13CreativeOutboundSanitizedResult.response.answer_basis.mode, "creative_conversation");
    assert.match(m13CreativeOutboundSanitizedResult.response.answer?.body ?? "", /clean and premium/i);
    assert.equal(m13CreativeOutboundSanitizedResult.response.structured_output.creative_conversation_response_received, true);
    assert.equal(m13CreativeOutboundSanitizedResult.response.structured_output.m1_validation_result, "accepted");
    assert.equal(m13CreativeOutboundSanitizedResult.response.structured_output.fallback_used, false);
    const outboundSanitizedServerRequest = server.calls.cmoRequests.find((request) => request.requestId === "req_m13_creative_outbound_sanitized");
    assert.ok(outboundSanitizedServerRequest, "Sanitized Creative request must be sent to fake Hermes");
    assert.equal(containsOutboundCallsiteForbiddenLiteral(outboundSanitizedServerRequest.rawBody), false, "Fetch body must contain zero call-site forbidden literals");
    assert.equal(outboundSanitizedServerRequest.body.outbound_hermes_payload_guard?.outbound_callsite_guard_version, "context-sanitizer-v2");
    const outboundTraceFiles = await readdir(m13TraceDir);
    const outboundRequestTraceName = outboundTraceFiles.find((fileName) =>
      fileName.includes("session_m13_creative_outbound_sanitized") && fileName.endsWith("_request.json")
    );
    assert.ok(outboundRequestTraceName, "Canonical request trace for sanitized Creative request must exist");
    const outboundRequestTraceText = await readFile(path.join(m13TraceDir, outboundRequestTraceName), "utf8");
    assert.equal(containsOutboundCallsiteForbiddenLiteral(outboundRequestTraceText), false, "Canonical request trace must contain zero call-site forbidden literals");
    const outboundRequestTrace = JSON.parse(outboundRequestTraceText);
    assert.equal(outboundRequestTrace.outbound_hermes_payload_guard?.outbound_callsite_guard_version, "context-sanitizer-v2");
    assert.equal(outboundRequestTrace.outbound_hermes_payload_guard?.outbound_callsite_guard_checked, true);
    assert.equal(outboundRequestTrace.outbound_hermes_payload_guard?.outbound_callsite_guard_blocked, false);
    assert.equal(outboundRequestTrace.request?.request_id, outboundSanitizedServerRequest.body.request_id);
    assert.equal(outboundRequestTrace.request?.outbound_hermes_payload_guard?.outbound_callsite_guard_version, "context-sanitizer-v2");
    const cmoCallsBeforeBlockedCallsiteGuard = server.calls.cmo;
    await assert.rejects(
      () => runHermesCmoRuntime(m13CallsiteGuardBlockedCreativeSessionRequest("req_m13_creative_callsite_guard_blocked")),
      /outbound_callsite_guard_version=context-sanitizer-v2/,
      "Call-site guard must block a payload with forbidden literals remaining after sanitizer",
    );
    assert.equal(server.calls.cmo, cmoCallsBeforeBlockedCallsiteGuard, "Call-site guard must block before fetch");
    m13CmoOwnedCreativeReferenceFetchFailedResult = await runHermesCmoRuntime(m13CmoOwnedCreativeSessionExecutionRequest("req_m13_cmo_owned_creative_reference_fetch_failed"));
    assert.equal(m13CmoOwnedCreativeReferenceFetchFailedResult.response.status, "failed");
    assert.equal(m13CmoOwnedCreativeReferenceFetchFailedResult.response.answer_basis.mode, "creative_execution");
    assert.equal(m13CmoOwnedCreativeReferenceFetchFailedResult.response.answer.body, "Creative reference image could not be fetched. Check artifact read access.");
    assert.equal(m13CmoOwnedCreativeReferenceFetchFailedResult.response.structured_output.creative_execution_response_received, true);
    assert.equal(m13CmoOwnedCreativeReferenceFetchFailedResult.response.structured_output.creative_execution_owner, "cmo");
    assert.equal(m13CmoOwnedCreativeReferenceFetchFailedResult.response.structured_output.creative_execution_requested, false);
    assert.equal(m13CmoOwnedCreativeReferenceFetchFailedResult.response.structured_output.creative_reference_fetch_failed, true);
    assert.equal(m13CmoOwnedCreativeReferenceFetchFailedResult.response.structured_output.error_code, "reference_asset_fetch_failed");
    assert.equal(m13CmoOwnedCreativeReferenceFetchFailedResult.response.structured_output.rejected_by_m1_validator, false);
    assert.equal(m13CmoOwnedCreativeReferenceFetchFailedResult.response.structured_output.m1_validation_result, "accepted");
    assert.equal(m13CmoOwnedCreativeReferenceFetchFailedResult.response.structured_output.fallback_used, false);
    assert.equal(m13CmoOwnedCreativeReferenceFetchFailedResult.response.structured_output.reference_assets_count, 1);
    assert.equal(
      validateHermesCmoRuntimeResponse(
        {
          schema_version: "hermes.cmo.response.v1",
          request_id: sampleRequest.request_id,
          session_id: sampleRequest.session_id,
          turn_id: sampleRequest.turn_id,
          status: "completed",
          answer_basis: {
            mode: "creative_execution",
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
            title: "Edited creative asset",
            summary: "Edited image uploaded.",
            decision: "execute",
            body: "Edited image uploaded.",
          },
          structured_output: null,
          creative_decision: {
            action: "execute",
            draft_id: "creative_draft_fixture",
            operation: "creative.generate_image",
          },
          creative_assets: [
            {
              schema_version: "cmo.creative_asset.v1",
              type: "creative_asset",
              asset_id: "creative_edited_fixture",
              asset_type: "image",
              agent: "creative",
              transport_status: "uploaded",
              status: "stored",
              render_url: "https://cmo.jayju.cloud/api/signed/creative_edited_fixture",
              signed_url: "https://cmo.jayju.cloud/api/signed/creative_edited_fixture",
              bytes: 4096,
              sha256: "7878787878787878787878787878787878787878787878787878787878787878",
              mime_type: "image/png",
            },
          ],
          artifacts: [
            {
              schema_version: "cmo.creative_asset.v1",
              type: "creative_asset",
              asset_id: "creative_edited_fixture",
              asset_type: "image",
              agent: "creative",
              transport_status: "uploaded",
              status: "stored",
              render_url: "https://cmo.jayju.cloud/api/signed/creative_edited_fixture",
              signed_url: "https://cmo.jayju.cloud/api/signed/creative_edited_fixture",
              bytes: 4096,
              sha256: "7878787878787878787878787878787878787878787878787878787878787878",
              mime_type: "image/png",
            },
          ],
          delegations: [],
          memory_suggestions: [],
          activity_summary: {
            events_count: 0,
            final_state: "completed",
          },
        },
        sampleRequest,
      ),
      false,
      "creative_execution answer basis must reject outside Creative-native execution context",
    );
    m13CreativeExecutedCreativeResult = await runHermesCmoRuntime(m13CreativeExecutionRequest("req_m13_creative_executed_creative_true"));
    assert.equal(m13CreativeExecutedCreativeResult.response.status, "completed");
    assert.equal(m13CreativeExecutedCreativeResult.response.routed_to_creative, true);
    assert.equal(m13CreativeExecutedCreativeResult.response.structured_output.product_artifact_status, "artifact_transport_missing");
    assert.equal(m13CreativeExecutedCreativeResult.response.structured_output.side_effects_present, true);
    assert.equal(m13CreativeExecutedCreativeResult.response.structured_output.side_effects_allowed_for_creative, true);
    assert.deepEqual(m13CreativeExecutedCreativeResult.sideEffects, {
      creative_generation: false,
      executed_creative: false,
      local_artifact_created: false,
      creative_asset_metadata: false,
      publishing: false,
      vault_write: false,
      supabase_mutation: false,
      credential_write: false,
      arbitrary_filesystem_write: false,
    });
    m13CreativeFalseOnlySideEffectsResult = await runHermesCmoRuntime(m13CreativeExecutionRequest("req_m13_creative_false_only_side_effects"));
    assert.equal(m13CreativeFalseOnlySideEffectsResult.response.status, "completed");
    assert.equal(m13CreativeFalseOnlySideEffectsResult.response.structured_output.product_artifact_status, "artifact_transport_missing");
    assert.equal(m13CreativeFalseOnlySideEffectsResult.response.structured_output.side_effects_present, true);
    assert.equal(m13CreativeFalseOnlySideEffectsResult.response.structured_output.side_effects_allowed_for_creative, true);
    assert.deepEqual(m13CreativeFalseOnlySideEffectsResult.sideEffects, {
      executed_echo: false,
      executed_surf: false,
      executed_vault_agent: false,
      published: false,
      scheduled: false,
      vault_mutation: false,
      database_mutation: false,
      credential_write: false,
      arbitrary_filesystem_write: false,
    });
    await assert.rejects(
      () => runHermesCmoRuntime(m13CreativeExecutionRequest("req_m13_creative_unsafe_side_effect")),
      /rejected_side_effect_type=publish/,
      "unsafe Creative side_effect types must be rejected",
    );
    await assert.rejects(
      () => runHermesCmoRuntime(m13CreativeExecutionRequest("req_m13_creative_executed_echo_true")),
      /rejected_side_effect_type=executed_echo/,
      "truthy executed_echo must be rejected for Creative execution",
    );
    await assert.rejects(
      () => runHermesCmoRuntime(m13CreativeExecutionRequest("req_m13_creative_executed_creative_missing_metadata")),
      /Hermes CMO Agent response included unsafe side_effects/,
      "executed_creative=true without Creative metadata must be rejected",
    );
    await assert.rejects(
      () => runHermesCmoRuntime(m13CreativeExecutionRequest("req_m13_creative_activity_invalid_type")),
      /Rejected field: source_invalid:mode=creative_execution/,
      "source.mode=creative_execution must be limited to canonical Creative lifecycle events",
    );
  } finally {
    for (const [key, value] of Object.entries(previousEnv)) {
      restoreEnvValue(key, value);
    }
    await server.close();
    await rm(tmpDir, { recursive: true, force: true });
    await rm(m13TraceDir, { recursive: true, force: true });
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        cmoCalls: server.calls.cmo,
        surfCalls: result.surfCalls,
        echoCalls: result.echoCalls,
        echoFailureGuarded: echoFailResult?.response.structured_output?.echo_failed === true,
        surfFailureGuarded: surfFailResult?.response.structured_output?.surf_failed === true,
        echoRetryGood: echoRetryGoodResult?.echoCalls === 2,
        echoRetryFailureGuarded: echoRetryFailResult?.response.structured_output?.echo_retry_failed === true,
        echoRetryLimited: echoRetryLimitResult?.echoCalls === 2,
        duplicateSameId: {
          surfCalls: duplicateSameIdResult?.surfCalls,
          delegationSummaryLength: duplicateSameIdResult?.delegationSummary.length,
        },
        duplicateFingerprint: {
          surfCalls: duplicateFingerprintResult?.surfCalls,
          delegationSummaryLength: duplicateFingerprintResult?.delegationSummary.length,
        },
        duplicateDelegatedStopGuarded: duplicateDelegatedStopResult?.response.structured_output?.completed_specialist_fallback === true,
        completedSpecialistFallback: {
          surf: duplicateDelegatedStopResult?.response.structured_output?.completed_specialist_fallback === true,
          echo: echoCompletedUnresolvedResult?.response.structured_output?.completed_specialist_fallback === true,
        },
        translationFollowup: {
          echoCalls: translationFollowupResult?.echoCalls,
          finalPostCount:
            (translationFollowupResult?.response.answer?.body.match(/POST [123]:/g) ?? []).length,
        },
        worldAppSignal: {
          surfCalls: worldAppSignalResult?.surfCalls,
          echoCalls: worldAppSignalResult?.echoCalls,
          delegationSummaryLength: worldAppSignalResult?.delegationSummary.length,
        },
        surfThenEcho: surfThenEchoResult?.surfCalls === 1 && surfThenEchoResult?.echoCalls === 1,
        maxRoundsGuarded: maxRoundsResult?.response.structured_output?.completed_specialist_fallback === true,
        creativeExecutionTimeout: {
          endpoint: m13CreativeTimeoutDefaultResult?.hermesCmoAgentPath,
          routeDecision: m13CreativeTimeoutDefaultResult?.hermesCmoRouteDecision,
          timeoutMs: m13CreativeTimeoutDefaultResult?.hermesCmoEndpointTimeoutMs,
          timeoutSource: m13CreativeTimeoutDefaultResult?.hermesCmoEndpointTimeoutSource,
        },
        creativeTopLevelSuccess: {
          status: m13CreativeTopLevelSuccessResult?.response.status,
          routedToCreative: m13CreativeTopLevelSuccessResult?.response.routed_to_creative,
          imagePathPresent: Boolean(m13CreativeTopLevelSuccessResult?.response.image_path),
          bytesPresent: typeof m13CreativeTopLevelSuccessResult?.response.bytes === "number",
          sha256Present: typeof m13CreativeTopLevelSuccessResult?.response.sha256 === "string",
          productArtifactStatus: m13CreativeTopLevelSuccessResult?.response.structured_output?.product_artifact_status,
          fallbackUsed: m13CreativeTopLevelSuccessResult?.response.structured_output?.fallback_used,
          sideEffectsPresent: m13CreativeTopLevelSuccessResult?.response.structured_output?.side_effects_present,
          sideEffectsAllowedForCreative: m13CreativeTopLevelSuccessResult?.response.structured_output?.side_effects_allowed_for_creative,
        },
        creativeUploadedAsset: {
          status: m13CreativeUploadedAssetResult?.response.status,
          productArtifactStatus: m13CreativeUploadedAssetResult?.response.structured_output?.product_artifact_status,
          transportStatus: m13CreativeUploadedAssetResult?.response.artifacts?.[0]?.transport_status,
          renderUrlPresent: typeof m13CreativeUploadedAssetResult?.response.artifacts?.[0]?.render_url === "string",
        },
        creativeExecutedCreative: {
          status: m13CreativeExecutedCreativeResult?.response.status,
          productArtifactStatus: m13CreativeExecutedCreativeResult?.response.structured_output?.product_artifact_status,
          sideEffectsAllowedForCreative: m13CreativeExecutedCreativeResult?.response.structured_output?.side_effects_allowed_for_creative,
          executedCreative: m13CreativeExecutedCreativeResult?.sideEffects?.executed_creative,
        },
        creativeFalseOnlySideEffects: {
          status: m13CreativeFalseOnlySideEffectsResult?.response.status,
          productArtifactStatus: m13CreativeFalseOnlySideEffectsResult?.response.structured_output?.product_artifact_status,
          sideEffectsAllowedForCreative: m13CreativeFalseOnlySideEffectsResult?.response.structured_output?.side_effects_allowed_for_creative,
          executedEcho: m13CreativeFalseOnlySideEffectsResult?.sideEffects?.executed_echo,
        },
        legacySurfXCalls: server.calls.legacySurfX,
        legacySurfLast30DaysCalls: server.calls.legacySurfLast30Days,
        forbiddenCounters: result.forbidden_counters,
        agentsUsed: result.agentsUsed,
        delegationSummary: result.delegationSummary.map((delegation) => ({
          targetAgent: delegation.targetAgent,
          mode: delegation.mode,
          status: delegation.status,
        })),
      },
      null,
      2,
    ),
  );
} catch (error) {
  console.error(
    JSON.stringify(
      {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      },
      null,
      2,
    ),
  );
  process.exitCode = 1;
}
