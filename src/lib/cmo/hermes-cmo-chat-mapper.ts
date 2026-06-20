import type {
  CMOAppChatResponse,
  CMOChatMessage,
  CMOContextNote,
  ContextItem,
  CmoSessionLocalResearchResult,
  CmoSessionLocalSource,
  HermesCmoAgentUsed,
  HermesCmoActivityEventSummary,
  HermesCmoChatMetadata,
  HermesCmoDelegationSummaryItem,
  HermesCmoForbiddenCounters,
  HermesCmoSafetyCounters,
  VaultNoteRef,
} from "@/lib/cmo/app-workspace-types";
import type {
  HermesCmoRuntimeActivityEvent,
  HermesCmoRuntimeRequest,
  HermesCmoRuntimeResponse,
  HermesCmoRuntimeResult,
} from "@/lib/cmo/hermes-cmo-runtime";
import type { HermesCmoAttachmentRef } from "@/lib/cmo/attachments";
import { isExplicitCreativeExecutionIntent, leadingIntentText } from "./app-routing-intent";
import type { CmoRuntimeTurnInput } from "@/lib/cmo/runtime";
import {
  resolveSessionWorkingMemory,
} from "./session-working-memory";

export const HERMES_CMO_PROPOSALS_ONLY = "proposals_only" as const;
export const HERMES_CMO_BOUNDED_DELEGATIONS = "echo_surf_bounded" as const;
export const LENS_READOUT_CONTEXT_CONTRACT = "lens.readout_context.v1" as const;
export const LENS_READOUT_CONTEXT_ARTIFACT_KIND = "lens_readout_context" as const;
export const LENS_READOUT_GROUNDING_RULE =
  "A Lens readout context may be attached under lens.readout_context.v1 in artifacts_in. Use it as evidence for app performance questions. Do not invent activation or retention metrics when the readout marks them as definition_needed. Do not treat Active Users as Activated Users. Do not treat Engagement Rate as Activation Rate. If the requested range has missing_snapshot, state that cached GA4 metrics need syncing." as const;

export const HERMES_CMO_FORBIDDEN_ZERO_COUNTERS = [
  "vaultAgentCalls",
  "vaultWrites",
  "openclawCalls",
  "directSupabaseMutations",
] as const;

export type HermesCmoForbiddenZeroCounter = (typeof HERMES_CMO_FORBIDDEN_ZERO_COUNTERS)[number];

export interface HermesCmoChatRequestInput extends CmoRuntimeTurnInput {
  sessionId: string;
  userMessageId: string;
  createdAt: string;
  inputMaterialAttachments?: HermesCmoAttachmentRef[];
  userIdentity?: {
    userId?: string;
    userEmail?: string;
    createdByEmail?: string;
  };
}

const MAX_REPLAY_MESSAGES = 16;
const MAX_REPLAY_MESSAGE_CHARS = 4000;

interface HermesCmoReplayMessage {
  role: "user" | "assistant";
  content: string;
  message_id: string;
  created_at: string;
}

type ReplayableCmoChatMessage = CMOChatMessage & { role: "user" | "assistant" };

export interface HermesCmoCounterValidation {
  ok: boolean;
  counters?: HermesCmoSafetyCounters;
  errorReason?: string;
}

export interface HermesCmoMappedChatResult {
  answer: string;
  assumptions: string[];
  suggestedActions: CMOAppChatResponse["suggestedActions"];
  runtimeStatus: "live";
  runtimeMode: "live";
  runtimeLabel: string;
  runtimeProvider: "hermes";
  runtimeAgent: "cmo";
  isDevelopmentFallback: false;
  isRuntimeFallback: false;
  calledHermesCmo: true;
  hermesCmoStatus: "live";
  delegationsMode: typeof HERMES_CMO_PROPOSALS_ONLY | typeof HERMES_CMO_BOUNDED_DELEGATIONS;
  hermesCmoCounters: HermesCmoSafetyCounters;
  hermesCmoMetadata: HermesCmoChatMetadata;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function compactText(value: string, maxChars = 1200): string {
  const compact = value.replace(/\s+/g, " ").trim();

  return compact.length > maxChars ? `${compact.slice(0, maxChars - 3).trimEnd()}...` : compact;
}

function compactMultilineText(value: string, maxChars = MAX_REPLAY_MESSAGE_CHARS): string {
  const compact = value
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return compact.length > maxChars ? `${compact.slice(0, maxChars - 3).trimEnd()}...` : compact;
}

function isPendingToolRunPlaceholder(message: CMOChatMessage): boolean {
  if (message.role !== "assistant") {
    return false;
  }

  if (message.cmoRunStatus === "pending" || message.cmoRunStatus === "running") {
    return true;
  }

  return /^CMO is working\.\.\.(?:\s+Researching signals\.\.\.\s+Synthesizing answer\.\.\.)?$/i.test(compactText(message.content, 220));
}

function replayableChatHistory(history: CMOChatMessage[]): ReplayableCmoChatMessage[] {
  return history.filter((message): message is ReplayableCmoChatMessage =>
    (message.role === "user" || message.role === "assistant") &&
    message.content.trim().length > 0 &&
    !isPendingToolRunPlaceholder(message)
  );
}

function contextItemSnapshot(item: ContextItem): Record<string, unknown> {
  return {
    id: item.id,
    kind: item.kind,
    title: item.title,
    source: item.source,
    inclusionReason: item.inclusionReason,
    exists: item.exists,
    content: item.content,
    contentPreview: item.contentPreview,
    contextQuality: item.contextQuality,
    tokenEstimate: item.tokenEstimate,
    truncated: item.truncated,
    ...(typeof item.itemCount === "number" ? { itemCount: item.itemCount } : {}),
  };
}

function noteSnapshot(note: CMOContextNote): Record<string, unknown> {
  return {
    title: note.title,
    path: note.path,
    type: note.type,
    exists: note.exists,
    content: note.content,
    truncated: note.truncated,
    frontmatterStatus: note.frontmatterStatus,
    contextQuality: note.contextQuality,
    qualityReason: note.qualityReason,
  };
}

function recentSessionSummary(history: CMOChatMessage[]): string | null {
  const recent = replayableChatHistory(history)
    .slice(-6)
    .map((message) => `${message.role}: ${compactText(message.content, 360)}`)
    .join("\n");

  return recent ? compactText(recent, 1600) : null;
}

function recentChatContext(history: CMOChatMessage[]): Record<string, unknown>[] {
  return replayableChatHistory(history)
    .slice(-6)
    .map((message, index) => ({
      id: `recent_chat_${index + 1}_${message.id}`,
      kind: "recent_chat_message",
      title: message.role === "assistant" ? "Prior CMO/Echo answer" : "Prior user message",
      source: {
        sourceId: "cmo-chat-history",
        type: "session-reference",
        label: message.role,
      },
      role: message.role,
      messageId: message.id,
      createdAt: message.createdAt,
      exists: true,
      content: message.content,
      full_content: message.content,
      truncated: false,
      inclusionReason: "Recent chat turn for follow-up intent resolution.",
      contextQuality: "confirmed",
    }));
}

function recentConversationMessages(history: CMOChatMessage[]): HermesCmoReplayMessage[] {
  return replayableChatHistory(history)
    .slice(-MAX_REPLAY_MESSAGES)
    .map((message) => ({
      role: message.role,
      content: compactMultilineText(message.content),
      message_id: message.id,
      created_at: message.createdAt,
    }));
}

function vaultAgentContextPackArtifact(input: HermesCmoChatRequestInput): Record<string, unknown> | null {
  const contextPack = input.contextPackage.contextPack.vaultAgentContextPack;

  if (!contextPack?.hidden_text) {
    return null;
  }

  return {
    type: "vault_context_pack",
    schema_version: contextPack.schema_version,
    title: "Vault Context Pack",
    content: contextPack.hidden_text,
    sources: contextPack.sources,
    source_count: contextPack.source_count,
    read_only: true,
    gbrain_called: contextPack.gbrain_called,
    vault_mutation: false,
    promotion_performed: false,
  };
}

function sourceReviewContextArtifact(input: HermesCmoChatRequestInput): Record<string, unknown> | null {
  const reviewContext = input.contextPackage.sourceReviewContext ?? input.contextPackage.contextPack.sourceReviewContext;

  if (!reviewContext) {
    return null;
  }

  return reviewContext as unknown as Record<string, unknown>;
}

function sourceAnswerContextArtifact(input: HermesCmoChatRequestInput): Record<string, unknown> | null {
  const answerContext = input.contextPackage.sourceAnswerContext ?? input.contextPackage.contextPack.sourceAnswerContext;

  if (!answerContext || answerContext.workspace_id !== input.request.workspaceId || answerContext.session_id !== input.sessionId) {
    return null;
  }

  return answerContext as unknown as Record<string, unknown>;
}

function lensReadoutContextArtifact(context: Record<string, unknown> | null): Record<string, unknown> | null {
  if (!context || context.contract !== LENS_READOUT_CONTEXT_CONTRACT) {
    return null;
  }

  return {
    contract: LENS_READOUT_CONTEXT_CONTRACT,
    kind: LENS_READOUT_CONTEXT_ARTIFACT_KIND,
    content: context,
  };
}

function isMissingAcceptedProjectContextItem(item: ContextItem): boolean {
  return item.kind === "project_context" && item.exists === false;
}

function isMissingAcceptedProjectContextRef(note: VaultNoteRef): boolean {
  return note.exists === false &&
    note.contextQuality === "missing" &&
    /accepted project context/i.test(note.title) &&
    /12 Knowledge\/Workspace Lessons\//i.test(note.path);
}

function creativeContextQualitySummary(input: HermesCmoChatRequestInput, omittedMissingCount: number): Record<string, unknown> {
  const summary = input.contextPackage.contextQualitySummary;

  if (omittedMissingCount <= 0) {
    return { ...summary };
  }

  return {
    ...summary,
    missingCount: Math.max(0, summary.missingCount - omittedMissingCount),
    creative_execution_context_policy: "accepted_project_context_optional",
    creative_execution_direct_prompt_sufficient: true,
    omitted_blocking_missing_context_count: omittedMissingCount,
  };
}

function sessionLocalSourceNavHeavy(source: CmoSessionLocalSource): boolean {
  return source.nav_heavy === true || (Array.isArray(source.warnings) && source.warnings.includes("nav_heavy"));
}

function sessionLocalSourceReadDepth(source: CmoSessionLocalSource): string {
  if (source.read_depth) {
    return source.read_depth;
  }

  if (sessionLocalSourceNavHeavy(source) || source.main_content_quality === "low" || source.extraction_status === "partial") {
    return "partial";
  }

  if (source.extraction_coverage === "rendered_dom") {
    return "browser_rendered";
  }

  if (source.extraction_coverage === "deep_crawl") {
    return "full_doc";
  }

  if (source.source_text_cache || source.extracted_summary) {
    return "extracted_text";
  }

  return "snippet";
}

function sessionLocalSourceCacheRole(source: CmoSessionLocalSource): string {
  if (source.cache_role) {
    return source.cache_role;
  }

  if (source.extraction_status === "completed" && source.main_content_quality === "good" && !sessionLocalSourceNavHeavy(source)) {
    return "high_quality_evidence";
  }

  if (source.original_url && (sessionLocalSourceNavHeavy(source) || source.main_content_quality === "low" || source.extraction_status === "partial")) {
    return "fallback_only";
  }

  return "context_hint";
}

function sessionLocalSourceToolReadRecommended(source: CmoSessionLocalSource): boolean {
  return (
    source.tool_read_recommended === true ||
    Boolean(source.original_url || source.canonical_url) &&
      (sessionLocalSourceNavHeavy(source) || source.main_content_quality !== "good" || source.extraction_status !== "completed")
  );
}

function sessionLocalSourceArtifacts(input: HermesCmoChatRequestInput): Record<string, unknown>[] {
  return (input.contextPackage.sessionLocalSources ?? [])
    .filter((source) => source.workspace_id === input.request.workspaceId)
    .filter((source) => source.session_id === input.sessionId)
    .map((source) => {
      const navHeavy = sessionLocalSourceNavHeavy(source);
      const readDepth = sessionLocalSourceReadDepth(source);
      const cacheRole = sessionLocalSourceCacheRole(source);
      const toolReadRecommended = sessionLocalSourceToolReadRecommended(source);

      return {
        type: "session_local_source",
        schema_version: "cmo.session_local_source.v1",
        workspace_id: source.workspace_id,
        session_id: source.session_id,
        turn_id: source.turn_id,
        source_id: source.source_id,
        source_type: source.source_type,
        source_title: source.source_title,
        ...(source.original_url ? { original_url: source.original_url } : {}),
        ...(source.canonical_url ? { canonical_url: source.canonical_url } : {}),
        ...(source.original_filename ? { original_filename: source.original_filename } : {}),
        ...(source.extracted_summary ? { extracted_summary: source.extracted_summary } : {}),
        ...(source.source_text_excerpt ? { source_text_excerpt: source.source_text_excerpt } : {}),
        extraction_status: source.extraction_status,
        ...(source.main_content_quality ? { main_content_quality: source.main_content_quality, extraction_quality: source.main_content_quality } : {}),
        ...(source.extraction_coverage ? { extraction_coverage: source.extraction_coverage } : {}),
        read_depth: readDepth,
        cache_role: cacheRole,
        nav_heavy: navHeavy,
        tool_read_recommended: toolReadRecommended,
        ...(source.warnings ? { warnings: source.warnings } : {}),
        ...(source.full_artifact_ref ? { full_artifact_ref: source.full_artifact_ref } : {}),
        ...(source.content_hash ? { content_hash: source.content_hash } : {}),
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
    });
}

function researchItemName(value: Record<string, unknown> | string): string | null {
  if (typeof value === "string") {
    return value.trim() || null;
  }

  for (const key of ["name", "title", "label", "product", "company"]) {
    if (typeof value[key] === "string" && value[key].trim()) {
      return value[key].trim();
    }
  }

  return null;
}

function comparisonSetFromResearchResult(result: CmoSessionLocalResearchResult): string[] {
  return [...(result.competitors ?? []), ...(result.adjacent_products ?? [])]
    .map(researchItemName)
    .filter((name): name is string => Boolean(name))
    .slice(0, 8);
}

function sessionLocalResearchResultArtifacts(input: HermesCmoChatRequestInput): Record<string, unknown>[] {
  return (input.contextPackage.sessionLocalResearchResults ?? [])
    .slice(0, 3)
    .map((result: CmoSessionLocalResearchResult) => {
      const comparisonSet = comparisonSetFromResearchResult(result);

      return {
        type: "session_local_research_result",
        schema_version: "cmo.session_local_research_result.v1",
        artifact_id: result.research_id,
        tenant_id: result.tenant_id,
        workspace_id: result.workspace_id,
        app_id: result.app_id,
        user_id: result.user_id,
        session_id: result.session_id,
        turn_id: result.turn_id,
        created_turn_id: result.created_turn_id,
        research_id: result.research_id,
        subject: input.request.appName,
        ...(comparisonSet.length > 0 ? { comparison_set: comparisonSet } : {}),
        source_agent: result.source_agent,
        research_type: result.research_type,
        user_question: result.user_question,
        ...(result.competitors ? { competitors: result.competitors.slice(0, 8) } : {}),
        ...(result.adjacent_products ? { adjacent_products: result.adjacent_products.slice(0, 8) } : {}),
        ...(result.sources_used ? { sources_used: result.sources_used.slice(0, 12) } : {}),
        ...(result.key_findings ? { key_findings: result.key_findings.slice(0, 12) } : {}),
        ...(result.evidence_gaps ? { evidence_gaps: result.evidence_gaps.slice(0, 8) } : {}),
        created_at: result.created_at,
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
    });
}

function userId(input: HermesCmoChatRequestInput): string {
  return (
    input.userIdentity?.userId?.trim() ||
    input.userIdentity?.userEmail?.trim() ||
    input.userIdentity?.createdByEmail?.trim() ||
    "legacy_dashboard_user"
  );
}

function displayName(input: HermesCmoChatRequestInput): string | null {
  return input.userIdentity?.userEmail?.trim() || input.userIdentity?.createdByEmail?.trim() || null;
}

export function mapCmoChatToHermesCmoRequest(input: HermesCmoChatRequestInput): HermesCmoRuntimeRequest {
  const contextItems = input.contextPackage.contextPack.items;
  const vaultContextPack = vaultAgentContextPackArtifact(input);
  const sourceReviewContext = sourceReviewContextArtifact(input);
  const sourceAnswerContext = sourceAnswerContextArtifact(input);
  const lensReadoutContext = isRecord(input.contextPackage.lensReadoutContext) ? input.contextPackage.lensReadoutContext : null;
  const lensReadoutArtifact = lensReadoutContextArtifact(lensReadoutContext);
  const contextGroundingRules = lensReadoutArtifact ? [LENS_READOUT_GROUNDING_RULE] : [];
  const sessionLocalSources = sessionLocalSourceArtifacts(input);
  const sessionWorkingMemoryResolution = resolveSessionWorkingMemory({
    scope: {
      tenantId: input.request.tenantId ?? "holdstation",
      workspaceId: input.request.workspaceId,
      appId: input.request.appId,
      userId: userId(input),
      sessionId: input.sessionId,
    },
    researchResults: input.contextPackage.sessionLocalResearchResults,
  });
  const sessionWorkingMemory = sessionWorkingMemoryResolution.workingMemory;
  const sessionLocalResearchResults = sessionLocalResearchResultArtifacts({
    ...input,
    contextPackage: {
      ...input.contextPackage,
      sessionLocalResearchResults: sessionWorkingMemoryResolution.scopedResearchResults,
    },
  });
  const hasScopedResearchArtifact = sessionLocalResearchResults.length > 0;
  const toolReadRecommended =
    sourceAnswerContext?.tool_read_recommended === true ||
    sessionLocalSources.some((source) => source.tool_read_recommended === true);
  const navHeavySourceCount = sessionLocalSources.filter((source) => source.nav_heavy === true).length;
  const activeSessionLocalSource =
    (input.contextPackage.activeSourceId
      ? sessionLocalSources.find((source) => source.source_id === input.contextPackage.activeSourceId)
      : undefined) ?? sessionLocalSources[0];
  const currentPriority = contextItems
    .filter((item) => item.exists && item.kind === "current_priority")
    .map(contextItemSnapshot);
  const indexedContextSupplement = contextItems
    .filter((item) => item.exists && item.kind === "indexed_context_supplement")
    .map(contextItemSnapshot);
  const inputMaterial = {
    attachments: input.inputMaterialAttachments ?? [],
  };
  const creativeExecutionIntent = isExplicitCreativeExecutionIntent(input.message);
  const creativeExecutionMode = /\b(video|motion)\b/.test(leadingIntentText(input.message)) ? "creative.generate_video" : "creative.generate_image";
  const omittedCreativeMissingContext = creativeExecutionIntent
    ? input.missingContext.filter(isMissingAcceptedProjectContextRef)
    : [];
  const missingContextForHermes = creativeExecutionIntent
    ? input.missingContext.filter((note) => !isMissingAcceptedProjectContextRef(note))
    : input.missingContext;
  const allContextItemsForHermes = creativeExecutionIntent
    ? contextItems.filter((item) => !isMissingAcceptedProjectContextItem(item))
    : contextItems;
  const contextQualitySummaryForHermes = creativeExecutionIntent
    ? creativeContextQualitySummary(input, omittedCreativeMissingContext.length)
    : input.contextPackage.contextQualitySummary;

  return {
    schema_version: "hermes.cmo.request.v1",
    request_id: `req_h6_${input.userMessageId}`,
    session_id: input.sessionId,
    turn_id: input.userMessageId,
    created_at: input.createdAt,
    workspace: {
      workspace_id: input.request.workspaceId,
      app_id: input.request.appId,
      app_name: input.request.appName,
      source_id: input.contextPackage.sourceId,
      runtime_workspace_id: input.contextPackage.runtimeWorkspaceId ?? null,
    },
    user: {
      user_id: userId(input),
      display_name: displayName(input),
    },
    intent: {
      mode: "cmo.default",
      user_message: input.message,
      explicit_command: creativeExecutionIntent ? creativeExecutionMode : null,
    },
    input: {
      input_material: inputMaterial,
      ...(creativeExecutionIntent
        ? {
            creative_execution_intent: {
              requested: true,
              agent: "creative",
              mode: creativeExecutionMode,
              direct_user_prompt_is_sufficient_execution_input: true,
              accepted_project_context_required: false,
              accepted_workspace_context_required: false,
              return_local_paths: true,
              include_metadata: true,
              require_review_before_publish: true,
              factual_claim_guardrails: [
                "Do not invent unsupported product mechanics, rewards, APY, WLD, eligibility, or roadmap claims.",
                "Use the user-supplied visual direction as the brief when accepted workspace context is missing.",
                "If product facts are missing, produce generic brand-safe visual direction instead of blocking execution.",
              ],
            },
          }
        : {}),
    },
    input_material: inputMaterial,
    messages: recentConversationMessages(input.history),
    context_pack: {
      current_priority: currentPriority,
      selected_context: [...input.contextPackage.selectedContext.map(noteSnapshot), ...recentChatContext(input.history)],
      recent_session_summary: recentSessionSummary(input.history),
      indexed_context_supplement: indexedContextSupplement,
      artifacts_in: [vaultContextPack, ...sessionLocalSources, ...sessionLocalResearchResults, sourceAnswerContext, lensReadoutArtifact].filter((artifact): artifact is Record<string, unknown> => Boolean(artifact)),
      ...(input.contextPackage.activeSourceId ? { active_source_id: input.contextPackage.activeSourceId } : {}),
      ...(sourceReviewContext ? { source_review_context: sourceReviewContext } : {}),
      ...(sourceAnswerContext ? { source_answer_context: sourceAnswerContext } : {}),
      ...(lensReadoutContext ? { lens_readout_context: lensReadoutContext } : {}),
      ...(sessionLocalResearchResults.length > 0
        ? {
            research_context: {
              schema_version: "cmo.session_research_context.v1",
              artifact_count: sessionLocalResearchResults.length,
              truth_status: "session_only",
              saved_to_vault: false,
              no_auto_promote: true,
              artifacts: sessionLocalResearchResults,
            },
          }
        : {}),
      session_working_memory: sessionWorkingMemory,
      read_only_snapshot: true,
      context_quality_summary: contextQualitySummaryForHermes,
      context_graph: {
        graphHints: input.contextPackage.graphHints ?? [],
        graphHintCount: input.contextPackage.graphHintCount ?? input.contextPackage.graphHints?.length ?? 0,
        graphStatus: input.contextPackage.graphStatus ?? "empty",
      },
      all_context_items: allContextItemsForHermes.map(contextItemSnapshot),
      missing_context: missingContextForHermes,
      ...(creativeExecutionIntent
        ? {
            optional_context_gaps: omittedCreativeMissingContext.map((note) => ({
              title: note.title,
              path: note.path,
              reason: "Accepted project context is optional for explicit Creative execution when the user prompt supplies the visual brief.",
            })),
          }
        : {}),
      context_used: input.contextUsed,
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
      delegations_mode: HERMES_CMO_PROPOSALS_ONLY,
      allowSubAgentExecution: false,
      allowSurfExecution: false,
      allowEchoExecution: false,
      allowVaultAgentExecution: false,
      allowVaultWrites: false,
      allowSupabaseWrites: false,
      allowSessionWrites: false,
      allowRawCaptureWrites: false,
      allowOpenClawCalls: false,
      no_direct_supabase_mutation: true,
      no_direct_session_write: true,
      no_direct_raw_capture_write: true,
      execution_boundary: {
        sub_agent_execution_allowed: false,
        surf_execution_allowed: false,
        echo_execution_allowed: false,
        vault_agent_execution_allowed: false,
        vault_writes_allowed: false,
        supabase_writes_allowed: false,
        session_writes_allowed: false,
        raw_capture_writes_allowed: false,
        openclaw_calls_allowed: false,
      },
      ...(creativeExecutionIntent
        ? {
            creative_execution_requested: true,
            creative_execution_mode: creativeExecutionMode,
            accepted_project_context_required: false,
            accepted_workspace_context_required: false,
            missing_accepted_context_blocks_creative_execution: false,
          }
        : {}),
    },
    ui: {
      activity_stream_required: true,
      heartbeat_required: true,
      existing_cmo_chat_response_shape_required: true,
    },
    tool_policy: {
      schema_version: "cmo.hermes.tool_policy.v1",
      role: "product_shell_context_provider",
      allowed_agents: ["echo", "surf"],
      allowed_surf_modes: ["surf.default", "surf.x", "surf.trend", "surf.pulse"],
      delegations_mode: HERMES_CMO_PROPOSALS_ONLY,
      read_web_allowed: true,
      read_browser_allowed: true,
      read_file_allowed: true,
      read_attachments_allowed: inputMaterial.attachments.length > 0,
      terminal_read_only_allowed: true,
      code_execution_allowed: true,
      vision_allowed: true,
      session_search_allowed: true,
      clarify_allowed: true,
      todo_allowed: true,
      memory_read_allowed: true,
      delegation_allowed: true,
      ...(creativeExecutionIntent
        ? {
            creative_execution_requested: true,
            creative_execution_mode: creativeExecutionMode,
            direct_user_prompt_is_sufficient_execution_input: true,
            accepted_project_context_required: false,
            missing_accepted_context_blocks_creative_execution: false,
            factual_claim_guardrails: [
              "No unsupported rewards, APY, WLD, eligibility, or roadmap claims.",
              "Generic user-specified visual style is allowed without accepted project context.",
              "When context is missing, execute a safe generic creative instead of returning a context-blocking answer.",
            ],
          }
        : {}),
      context_grounding_rules: contextGroundingRules,
      durable_writes_require_confirmation: true,
      allowed_toolsets: [
        "web",
        "browser",
        "file",
        "terminal_read_only",
        "code_execution",
        "vision",
        "skills",
        "session_search",
        "clarify",
        "todo",
        "memory_read",
        "delegation",
      ],
      disabled_toolsets: ["messaging", "cronjob", "kanban"],
      allow_sub_agent_execution: false,
      allow_vault_agent_execution: false,
      allow_vault_writes: false,
      allow_supabase_writes: false,
      allow_session_writes: false,
      allow_raw_capture_writes: false,
      allow_openclaw_calls: false,
      durable_writes: {
        session_log_owned_by_cmo_engine: true,
        vault_writes_require_explicit_save_flow: true,
        source_ingestion_requires_inputs_priorities_or_explicit_save: true,
        no_auto_save_13_sources: true,
        no_auto_promote_12_knowledge: true,
        no_gbrain_mutation: true,
      },
    },
    product_boundary: {
      schema_version: "cmo.product_gateway_boundary.v1",
      cmo_engine_role: "product_shell_session_owner_permission_boundary",
      hermes_cmo_role: "source_gathering_reasoning_agent",
      vault_agent_role: "safe_durable_memory_boundary",
      engine_owns_session: true,
      engine_owns_turn_logging: true,
      durable_write_requires_approval: true,
      no_auto_save_13_sources: true,
      no_auto_promote_12_knowledge: true,
      no_gbrain_mutation: true,
      final_answer_owner_when_live: "hermes_cmo",
      cmo_engine_may_cache_source_artifacts: true,
      cmo_engine_must_not_synthesize_source_review_when_live: true,
      cmo_engine_must_not_synthesize_source_answer_when_live: true,
      fallback_requires_disabled_unavailable_or_invalid_hermes: true,
    },
    source_acquisition: {
      schema_version: "cmo.source_acquisition_role.v1",
      chat_role: "cache_fallback_context_provider",
      official_ingestion_role: "inputs_priorities_sources_ui",
      active_source_id: input.contextPackage.activeSourceId ?? null,
      session_local_sources_count: sessionLocalSources.length,
      user_uploaded_attachments_count: inputMaterial.attachments.length,
      source_answer_context_available: Boolean(sourceAnswerContext),
      source_review_context_available: Boolean(sourceReviewContext),
      session_local_research_results_count: sessionLocalResearchResults.length,
      research_followup_has_session_artifact: hasScopedResearchArtifact,
      research_followup_missing_session_artifact: !hasScopedResearchArtifact,
      ...(hasScopedResearchArtifact
        ? {
            scoped_session_research_artifact_available: true,
            scope_validated_by_product: true,
          }
        : {
            research_followup_requested: false,
            research_followup_action: null,
            active_context_kind: "none",
            should_call_surf: false,
          }),
      tool_read_recommended: toolReadRecommended,
      nav_heavy_source_count: navHeavySourceCount,
      ...(activeSessionLocalSource?.original_url ? { original_url: activeSessionLocalSource.original_url } : {}),
      ...(activeSessionLocalSource?.canonical_url ? { canonical_url: activeSessionLocalSource.canonical_url } : {}),
      ...(activeSessionLocalSource?.extraction_quality ? { extraction_quality: activeSessionLocalSource.extraction_quality } : {}),
      ...(activeSessionLocalSource?.extraction_coverage ? { extraction_coverage: activeSessionLocalSource.extraction_coverage } : {}),
      ...(activeSessionLocalSource?.read_depth ? { read_depth: activeSessionLocalSource.read_depth } : {}),
      ...(activeSessionLocalSource?.cache_role ? { cache_role: activeSessionLocalSource.cache_role } : {}),
      ...(typeof activeSessionLocalSource?.nav_heavy === "boolean" ? { nav_heavy: activeSessionLocalSource.nav_heavy } : {}),
      no_auto_save_13_sources: true,
      no_auto_promote_12_knowledge: true,
    },
    session_context_pack: null,
    runtime_context: input.contextPackage.runtimeContext ?? {
      now_iso: input.createdAt,
      timezone: "Asia/Ho_Chi_Minh",
      timezone_label: "Vietnam time",
      locale: "vi-VN",
      ...(displayName(input) ? { user_display_name: displayName(input) } : {}),
    },
  };
}

function counterNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function extractCounterRecord(value: unknown): Record<string, unknown> | null {
  if (!isRecord(value)) {
    return null;
  }

  if (isRecord(value.safety_counters)) {
    return value.safety_counters;
  }

  if (isRecord(value.safety) && isRecord(value.safety.counters)) {
    return value.safety.counters;
  }

  return null;
}

function extractForbiddenCounterRecord(value: unknown): Record<string, unknown> | null {
  if (!isRecord(value)) {
    return null;
  }

  if (isRecord(value.forbidden_counters)) {
    return value.forbidden_counters;
  }

  return extractCounterRecord(value);
}

function extractForbiddenCounters(result: unknown): HermesCmoForbiddenCounters | null {
  const rawCounters = extractForbiddenCounterRecord(result);

  if (!rawCounters) {
    return null;
  }

  const directSupabaseMutations = counterNumber(rawCounters.directSupabaseMutations ?? rawCounters.supabaseWrites);
  const vaultAgentCalls = rawCounters.vaultAgentCalls === undefined ? 0 : counterNumber(rawCounters.vaultAgentCalls);
  const vaultWrites = counterNumber(rawCounters.vaultWrites);
  const openclawCalls = counterNumber(rawCounters.openclawCalls);

  if (vaultAgentCalls === null || vaultWrites === null || openclawCalls === null || directSupabaseMutations === null) {
    return null;
  }

  return {
    vaultAgentCalls,
    vaultWrites,
    openclawCalls,
    directSupabaseMutations,
  };
}

export function validateHermesCmoChatCounters(result: unknown): HermesCmoCounterValidation {
  const rawCounters = extractCounterRecord(result);
  const forbiddenCounters = extractForbiddenCounters(result);

  if (!rawCounters || !forbiddenCounters) {
    return { ok: false, errorReason: "invalid_counters_schema:missing_safety_counters" };
  }

  for (const key of HERMES_CMO_FORBIDDEN_ZERO_COUNTERS) {
    const value = forbiddenCounters[key];

    if (value !== 0) {
      return { ok: false, errorReason: `forbidden_counter_non_zero:${key}=${value}` };
    }
  }

  const surfCalls = counterNumber(rawCounters.surfCalls);
  const echoCalls = counterNumber(rawCounters.echoCalls);
  const vaultAgentCalls = counterNumber(rawCounters.vaultAgentCalls);

  if (surfCalls === null || echoCalls === null || vaultAgentCalls === null) {
    return { ok: false, errorReason: "invalid_counters_schema:execution_counters" };
  }

  return {
    ok: true,
    counters: {
      surfCalls,
      echoCalls,
      vaultAgentCalls,
      vaultWrites: forbiddenCounters.vaultWrites,
      directSupabaseMutations: forbiddenCounters.directSupabaseMutations,
      openclawCalls: forbiddenCounters.openclawCalls,
    },
  };
}

function assumptionText(value: string | Record<string, unknown>): string {
  if (typeof value === "string") {
    return value;
  }

  const assumption = typeof value.assumption === "string" ? value.assumption : "";
  const reason = typeof value.reason === "string" ? value.reason : "";
  const impact = typeof value.impact === "string" ? value.impact : "";

  return [assumption, reason ? `Reason: ${reason}` : "", impact ? `Impact: ${impact}` : ""]
    .filter(Boolean)
    .join(" ");
}

function classificationFromResponse(response: HermesCmoRuntimeResponse): string {
  const structured = isRecord(response.structured_output) ? response.structured_output : {};
  const value = response.classification ?? structured.classification ?? response.answer_basis.mode;

  return typeof value === "string" ? value : "";
}

function contextResolutionFromResponse(response: HermesCmoRuntimeResponse): Record<string, unknown> {
  return isRecord(response.context_resolution) ? response.context_resolution : {};
}

function toolsUsedFromResponse(response: HermesCmoRuntimeResponse): string[] {
  const traceSummary = isRecord(response.tool_trace_summary) ? response.tool_trace_summary : {};
  const tools = [
    ...(Array.isArray(response.tools_used) ? response.tools_used : []),
    ...(Array.isArray(traceSummary.tools_used) ? traceSummary.tools_used : []),
  ].filter((tool): tool is string => typeof tool === "string" && tool.trim().length > 0);

  return Array.from(new Set(tools));
}

function toolReadsCountFromResponse(response: HermesCmoRuntimeResponse, activityEvents: HermesCmoActivityEventSummary[]): number | undefined {
  const traceSummary = isRecord(response.tool_trace_summary) ? response.tool_trace_summary : {};

  if (typeof traceSummary.tool_reads_count === "number" && Number.isFinite(traceSummary.tool_reads_count)) {
    return traceSummary.tool_reads_count;
  }

  if (typeof traceSummary.tool_read_count === "number" && Number.isFinite(traceSummary.tool_read_count)) {
    return traceSummary.tool_read_count;
  }

  const count = activityEvents.filter((event) => event.type === "cmo.tool_read.started" || event.type === "cmo.tool_read.completed").length;

  return count > 0 ? count : undefined;
}

function echoOutputText(value: unknown): string | null {
  if (!isRecord(value)) {
    return null;
  }

  const copy = typeof value.copy === "string" ? value.copy.trim() : "";
  const text = typeof value.text === "string" ? value.text.trim() : "";
  const content = typeof value.content === "string" ? value.content.trim() : "";

  return copy || text || content || null;
}

function sourceTransformAnswerFromDelegations(result: HermesCmoRuntimeResult): string | null {
  const completedSourceTransform = result.delegationSummary.find((delegation) =>
    delegation.targetAgent === "echo" &&
    delegation.status === "completed" &&
    (delegation.mode === "echo.source_translate" || delegation.mode === "echo.default") &&
    isRecord(delegation.response) &&
    Array.isArray(delegation.response.outputs),
  );
  const response = isRecord(completedSourceTransform?.response) ? completedSourceTransform.response : null;
  const outputs = Array.isArray(response?.outputs)
    ? response.outputs.map(echoOutputText).filter((output): output is string => Boolean(output))
    : [];

  return outputs.length ? outputs.join("\n\n") : null;
}

function answerFromHermes(response: HermesCmoRuntimeResponse, result?: HermesCmoRuntimeResult): string {
  if (!response.answer) {
    const question = response.clarifying_question.question ?? "Please provide the missing context before CMO continues.";

    return ["## Need Clarification", "", question].join("\n");
  }

  const classification = classificationFromResponse(response);
  const transformed = (classification === "source_translate" || classification === "source_transform") && result
    ? sourceTransformAnswerFromDelegations(result)
    : null;

  if (transformed) {
    return transformed;
  }

  const answer = response.answer;
  const body = answer.body.trim();

  return body || answer.summary.trim();
}

function labelFromUnknown(value: unknown): string | null {
  if (typeof value === "string") {
    return value.trim() || null;
  }

  if (!isRecord(value)) {
    return null;
  }

  for (const key of ["label", "title", "action", "step", "recommendation", "summary", "objective"]) {
    if (typeof value[key] === "string" && value[key].trim()) {
      return value[key].trim();
    }
  }

  return null;
}

function suggestedActionsFromHermes(response: HermesCmoRuntimeResponse): CMOAppChatResponse["suggestedActions"] {
  const structured = isRecord(response.structured_output) ? response.structured_output : {};
  const nextSteps = Array.isArray(structured.next_steps) ? structured.next_steps : [];
  const recommendations = Array.isArray(structured.recommendations) ? structured.recommendations : [];
  const actionLabels = [...nextSteps, ...recommendations].map(labelFromUnknown).filter((label): label is string => Boolean(label));
  const delegationLabels = response.delegations
    .map((delegation) => {
      const target = isRecord(delegation.target) && typeof delegation.target.agent === "string" ? delegation.target.agent : "specialist";
      const objective = typeof delegation.objective === "string" ? delegation.objective : "proposed delegation";

      return `Review proposed ${target} delegation: ${objective}`;
    });
  const memorySuggestionLabels = response.memory_suggestions
    .map((suggestion) => labelFromUnknown(suggestion) ?? "Review Hermes CMO memory suggestion");

  const actions = [...actionLabels, ...delegationLabels, ...memorySuggestionLabels]
    .slice(0, 5)
    .map((label, index) => ({
      type: index < actionLabels.length ? "hermes_cmo_next_step" : "hermes_cmo_proposal",
      label,
    }));

  return actions.length
    ? actions
    : [
        {
          type: "capture_to_raw_vault",
          label: "Capture this session",
        },
      ];
}

function delegationSummaryFromHermes(result: HermesCmoRuntimeResult): HermesCmoDelegationSummaryItem[] {
  return result.delegationSummary.map((delegation) => ({
    delegationId: delegation.delegationId,
    targetAgent: delegation.targetAgent,
    mode: delegation.mode,
    objective: delegation.objective,
    status: delegation.status,
    summary: delegation.summary,
    ...(delegation.failureReason ? { failureReason: delegation.failureReason } : {}),
  }));
}

function executedAgentCounts(delegationSummary: HermesCmoDelegationSummaryItem[]): Pick<HermesCmoSafetyCounters, "surfCalls" | "echoCalls"> {
  return {
    surfCalls: delegationSummary.filter((delegation) => delegation.targetAgent === "surf").length,
    echoCalls: delegationSummary.filter((delegation) => delegation.targetAgent === "echo").length,
  };
}

function countersFromExecutedDelegations(
  counters: HermesCmoSafetyCounters,
  delegationSummary: HermesCmoDelegationSummaryItem[],
): HermesCmoSafetyCounters {
  const executedCounts = executedAgentCounts(delegationSummary);

  return {
    ...counters,
    surfCalls: executedCounts.surfCalls,
    echoCalls: executedCounts.echoCalls,
  };
}

function agentsUsedFromExecutedDelegations(delegationSummary: HermesCmoDelegationSummaryItem[]): HermesCmoAgentUsed[] {
  return Array.from(new Set<HermesCmoAgentUsed>(["cmo", ...delegationSummary.map((delegation) => delegation.targetAgent)]));
}

function agentsUsedFromMetadata(
  delegationSummary: HermesCmoDelegationSummaryItem[],
  activityEvents: HermesCmoActivityEventSummary[],
): HermesCmoAgentUsed[] {
  return Array.from(new Set<HermesCmoAgentUsed>([
    ...agentsUsedFromExecutedDelegations(delegationSummary),
    ...activityEvents
      .map((event) => event.sourceAgent)
      .filter((agent): agent is HermesCmoAgentUsed => agent === "cmo" || agent === "echo" || agent === "surf" || agent === "creative"),
  ]));
}

function executedDelegationMatchKeys(delegationSummary: HermesCmoDelegationSummaryItem[]): Set<string> {
  return new Set(delegationSummary.map((delegation) => `${delegation.targetAgent}:${delegation.mode}`));
}

function activityEventsFromHermes(
  result: HermesCmoRuntimeResult,
  delegationSummary: HermesCmoDelegationSummaryItem[],
): HermesCmoActivityEventSummary[] {
  const executedMatches = executedDelegationMatchKeys(delegationSummary);

  return result.activity_events
    .map((event: HermesCmoRuntimeActivityEvent) => ({
      eventId: event.event_id,
      type: event.type,
      status: event.status,
      message: event.message,
      userVisible: event.user_visible,
      sourceAgent: event.source.agent,
      sourceMode: event.source.mode,
    }))
    .filter((event) => {
      if (event.sourceAgent !== "surf" && event.sourceAgent !== "echo") {
        return true;
      }

      return executedMatches.has(`${event.sourceAgent}:${event.sourceMode}`);
    });
}

function metadataFromHermes(
  result: HermesCmoRuntimeResult,
  counters: HermesCmoSafetyCounters,
  forbiddenCounters: HermesCmoForbiddenCounters,
): HermesCmoChatMetadata {
  const delegationSummary = delegationSummaryFromHermes(result);
  const activityEvents = activityEventsFromHermes(result, delegationSummary);
  const executedCounts = executedAgentCounts(delegationSummary);
  const toolsUsed = toolsUsedFromResponse(result.response);
  const toolTraceSummary = isRecord(result.response.tool_trace_summary) ? result.response.tool_trace_summary : {};
  const toolReadsCount = toolReadsCountFromResponse(result.response, activityEvents);
  const contextResolution = contextResolutionFromResponse(result.response);
  const answerBasis = isRecord(result.response.answer_basis) ? result.response.answer_basis : {};
  const attachmentTraceSummary = isRecord(result.response.attachment_trace_summary) ? result.response.attachment_trace_summary : undefined;
  const cmoCallSurfUsed = toolsUsed.includes("cmo_call_surf") || executedCounts.surfCalls > 0;
  const cmoCallEchoUsed = toolsUsed.includes("cmo_call_echo") || executedCounts.echoCalls > 0;

  return {
    runtimeMode: "hermes_cmo",
    runtimeStatus: "live",
    calledHermesCmo: true,
    hermesRequestSent: true,
    productRenderSource: "hermes_cmo",
    selectedHermesEndpoint: result.hermesCmoAgentPath,
    hermesEndpointKind: result.hermesCmoEndpointKind,
    endpoint_kind: result.hermesCmoEndpointKind,
    runtime_kind: "ai_agent",
    requested_endpoint: result.hermesCmoAgentPath,
    hermesEndpointTimeoutMs: result.hermesCmoEndpointTimeoutMs,
    hermesEndpointTimeoutSource: result.hermesCmoEndpointTimeoutSource,
    route_decision: result.hermesCmoRouteDecision,
    ...(result.hermesCmoRouteDecision === "creative_execution" ? { creative_execution_requested: true } : {}),
    hermesToolEndpointEnabled: result.hermesCmoToolEndpointEnabled,
    ...(result.hermesCmoEndpointKind === "tool_execute" ? { tool_capable_cmo: true } : {}),
    ...(result.sideEffects !== undefined ? { sideEffects: result.sideEffects } : {}),
    delegationsMode: delegationSummary.length > 0 ? HERMES_CMO_BOUNDED_DELEGATIONS : HERMES_CMO_PROPOSALS_ONLY,
    counters,
    forbiddenCounters,
    requestId: result.response.request_id,
    responseStatus: result.response.status,
    ...(toolsUsed.length > 0 ? { toolsUsed, tools_used: toolsUsed } : {}),
    ...(Object.keys(toolTraceSummary).length > 0 ? { toolTraceSummary, tool_trace_summary: toolTraceSummary } : {}),
    ...(cmoCallSurfUsed ? { cmo_call_surf_used: true } : {}),
    ...(cmoCallEchoUsed ? { cmo_call_echo_used: true } : {}),
    ...(toolReadsCount !== undefined ? { toolReadsCount } : {}),
    ...(attachmentTraceSummary ? { attachmentTraceSummary, attachment_trace_summary: attachmentTraceSummary } : {}),
    ...(Object.keys(contextResolution).length > 0 ? { contextResolution, context_resolution: contextResolution } : {}),
    ...(Object.keys(answerBasis).length > 0 ? { answerBasis, answer_basis: answerBasis } : {}),
    ...(result.strategyMode ? { strategyMode: result.strategyMode } : {}),
    ...(result.mainBottleneck ? { mainBottleneck: result.mainBottleneck } : {}),
    ...(result.decisionLabel ? { decisionLabel: result.decisionLabel } : {}),
    ...(result.currentStep ? { currentStep: result.currentStep } : {}),
    activityEventsCount: activityEvents.length,
    activityEvents,
    delegationSummary,
    agentsUsed: agentsUsedFromMetadata(delegationSummary, activityEvents),
    surfCalls: executedCounts.surfCalls,
    echoCalls: executedCounts.echoCalls,
  };
}

export function sanitizeHermesCmoMappedChatResult(result: HermesCmoMappedChatResult): HermesCmoMappedChatResult {
  const delegationSummary = result.hermesCmoMetadata.delegationSummary ?? [];
  const counters = countersFromExecutedDelegations(result.hermesCmoCounters, delegationSummary);
  const activityEvents = (result.hermesCmoMetadata.activityEvents ?? []).filter((event) => {
    if (event.sourceAgent !== "surf" && event.sourceAgent !== "echo") {
      return true;
    }

    return executedDelegationMatchKeys(delegationSummary).has(`${event.sourceAgent}:${event.sourceMode}`);
  });
  const executedCounts = executedAgentCounts(delegationSummary);
  const metadata: HermesCmoChatMetadata = {
    ...result.hermesCmoMetadata,
    counters,
    activityEventsCount: activityEvents.length,
    activityEvents,
    delegationSummary,
    agentsUsed: agentsUsedFromMetadata(delegationSummary, activityEvents),
    surfCalls: executedCounts.surfCalls,
    echoCalls: executedCounts.echoCalls,
  };

  return {
    ...result,
    delegationsMode: delegationSummary.length > 0 ? HERMES_CMO_BOUNDED_DELEGATIONS : HERMES_CMO_PROPOSALS_ONLY,
    hermesCmoCounters: counters,
    hermesCmoMetadata: metadata,
  };
}

export function mapHermesCmoResponseToChatResult(result: HermesCmoRuntimeResult): HermesCmoMappedChatResult {
  const validation = validateHermesCmoChatCounters(result);

  if (!validation.ok || !validation.counters) {
    throw new Error(validation.errorReason ?? "invalid_counters_schema");
  }

  const forbiddenCounters = extractForbiddenCounters(result);

  if (!forbiddenCounters) {
    throw new Error("invalid_counters_schema:missing_forbidden_counters");
  }

  const delegationSummary = delegationSummaryFromHermes(result);
  const counters = countersFromExecutedDelegations(validation.counters, delegationSummary);

  return sanitizeHermesCmoMappedChatResult({
    answer: answerFromHermes(result.response, result),
    assumptions: result.response.answer_basis.assumptions_used.map(assumptionText),
    suggestedActions: suggestedActionsFromHermes(result.response),
    runtimeStatus: "live",
    runtimeMode: "live",
    runtimeLabel: "Hermes CMO live runtime",
    runtimeProvider: "hermes",
    runtimeAgent: "cmo",
    isDevelopmentFallback: false,
    isRuntimeFallback: false,
    calledHermesCmo: true,
    hermesCmoStatus: "live",
    delegationsMode: delegationSummary.length > 0 ? HERMES_CMO_BOUNDED_DELEGATIONS : HERMES_CMO_PROPOSALS_ONLY,
    hermesCmoCounters: counters,
    hermesCmoMetadata: metadataFromHermes(result, counters, forbiddenCounters),
  });
}
