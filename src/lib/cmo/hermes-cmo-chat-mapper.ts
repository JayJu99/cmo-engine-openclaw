import type {
  CMOAppChatResponse,
  CMOChatMessage,
  CMOContextNote,
  ContextItem,
  CmoCreativeWorkingState,
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
  HermesCmoRuntimeRequest,
  HermesCmoRuntimeResponse,
  HermesCmoRuntimeResult,
} from "@/lib/cmo/hermes-cmo-runtime";
import type { HermesCmoAttachmentRef } from "@/lib/cmo/attachments";
import {
  cmoActivityEventSourceAgent,
  cmoActivityEventSourceMode,
  normalizeCmoActivityEvents,
} from "@/lib/cmo/activity-events";
import { createLensCapabilityContext } from "@/lib/cmo/lens-measurement-result";
import {
  isExplicitCreativeExecutionIntent,
} from "./app-routing-intent";
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
  creativeWorkingState?: CmoCreativeWorkingState;
  creativeIdeationDetected?: boolean;
  creativeSessionFollowupDetected?: boolean;
  activeCreativeAssetResolutionSource?: "creativeWorkingState" | "sessionArtifacts" | "messageCreativeAssets" | "none";
  userIdentity?: {
    userId?: string;
    userEmail?: string;
    createdByEmail?: string;
  };
}

const MAX_REPLAY_MESSAGES = 16;
const MAX_REPLAY_MESSAGE_CHARS = 4000;
const CMO_DEFAULT_PUBLIC_APP_URL = "https://cmo.jayju.cloud" as const;
const CMO_CREATIVE_ARTIFACT_AUTH_REF = "cmo_creative_artifact_read_key" as const;
const CMO_CREATIVE_ARTIFACT_AUTH_HEADER = "x-cmo-creative-artifact-key" as const;

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

function arrayValue<T = unknown>(value: unknown): T[] {
  return Array.isArray(value) ? value as T[] : [];
}

function hermesAgentUsedValue(value: unknown): HermesCmoAgentUsed | undefined {
  return value === "cmo" ||
    value === "echo" ||
    value === "surf" ||
    value === "creative" ||
    value === "lens" ||
    value === "vault_agent"
    ? value
    : undefined;
}

function hermesAgentUsedFromActivitySource(value: unknown): HermesCmoAgentUsed | undefined {
  return value === "vault" ? "vault_agent" : hermesAgentUsedValue(value);
}

function hasCreativeExecutionMetadata(value: unknown): boolean {
  if (!isRecord(value)) {
    return false;
  }

  if (value.routed_to_creative === true) {
    return true;
  }

  return ["image_path", "path", "preview_url", "signed_url", "url", "storage_path", "storagePath", "sha256", "model", "operation"]
    .some((field) => typeof value[field] === "string" && Boolean(value[field].trim())) ||
    ["bytes", "width", "height"].some((field) => typeof value[field] === "number" && Number.isFinite(value[field]));
}

function compactText(value: string, maxChars = 1200): string {
  const compact = value.replace(/\s+/g, " ").trim();

  return compact.length > maxChars ? `${compact.slice(0, maxChars - 3).trimEnd()}...` : compact;
}

function compactMultilineText(value: string, maxChars = MAX_REPLAY_MESSAGE_CHARS): string {
  const compact = value
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/g, "").replace(/([^\s])[ \t]{2,}([^\s])/g, "$1 $2"))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return compact.length > maxChars ? `${compact.slice(0, maxChars - 3).trimEnd()}...` : compact;
}

function isInternalArtifactPathText(value: string): boolean {
  const compact = compactMultilineText(value, 1600);

  if (!compact) {
    return false;
  }

  if (!/(\[hermes_local_artifact_path_redacted\]|(?:^|\s)(?:file:|[A-Za-z]:[\\/]|\/(?:tmp|var|Users|home|private|Volumes)\b))/i.test(compact)) {
    return false;
  }

  const withoutInternalPaths = stripInternalArtifactPaths(compact);

  return withoutInternalPaths.length === 0;
}

function stripInternalArtifactPaths(value: string): string {
  return value
    .replace(/\[hermes_local_artifact_path_redacted\][^\s]*/gi, "")
    .replace(/(?:file:|[A-Za-z]:[\\/]|\/(?:tmp|var|Users|home|private|Volumes)\b)[^\s]*/gi, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function canonicalAssistantText(value: unknown, maxChars = MAX_REPLAY_MESSAGE_CHARS): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const compact = compactMultilineText(stripInternalArtifactPaths(value), maxChars);

  if (!compact || isInternalArtifactPathText(compact)) {
    return null;
  }

  return compact;
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

function isStaleFailureAssistantContext(message: CMOChatMessage): boolean {
  if (message.role !== "assistant") {
    return false;
  }

  const metadata = message.hermesCmoMetadata;

  return Boolean(
    message.runtimeErrorReason ||
      message.hermesCmoErrorReason ||
      message.creativeRejectedByM1Validator === true ||
      metadata?.assistant_response_suppressed_for_noop === true ||
      metadata?.creative_noop_acknowledgement === true ||
      metadata?.product_contract_violation === true ||
      metadata?.creative_conversation_rejected === true ||
      metadata?.product_outbound_payload_blocked === true ||
      metadata?.rejected_by_m1_validator === true,
  );
}

function isMachineWrapperCreativeDraftText(value: string): boolean {
  const compact = compactText(value, 600).toLowerCase();

  return /^creative[_\s-]*image[_\s-]*asset\b/.test(compact) && (
    /\brefine\b/.test(compact) ||
    /\bexisting generated asset\b/.test(compact) ||
    /\bgenerated asset\b/.test(compact)
  );
}

const OUTBOUND_REPLAY_FORBIDDEN_TEXT_PATTERN =
  /(\[hermes_local_artifact_path_redacted\]|hermes_local_artifact_path_redacted|\.png_redact|(?:^|\s)file:|(?:^|[^A-Za-z0-9])[A-Za-z]:[\\/]|\/(?:tmp|var|Users|home|mnt|private|Volumes)\b|conversion_h_|creative-agent-images|cmo-creative-execute|creative[_\s-]*image[_\s-]*asset[_\s-]*refine|\bredacted\s+(?:prompt|brief|content|answer)\b|(?:prompt|brief|content|answer)\s+redacted\b)/i;

function hasUnsafeOutboundReplayText(value: string): boolean {
  return OUTBOUND_REPLAY_FORBIDDEN_TEXT_PATTERN.test(compactMultilineText(value, MAX_REPLAY_MESSAGE_CHARS)) ||
    isMachineWrapperCreativeDraftText(value);
}

function safeCreativeReplayText(value: unknown, maxChars = MAX_REPLAY_MESSAGE_CHARS): string | undefined {
  if (typeof value === "string" && hasUnsafeOutboundReplayText(value)) {
    return undefined;
  }

  const text = canonicalAssistantText(value, maxChars);

  if (!text || hasUnsafeOutboundReplayText(text)) {
    return undefined;
  }

  return text;
}

function safeCreativeReplayMetadataValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    const items = value
      .map(safeCreativeReplayMetadataValue)
      .filter((item) => item !== undefined);

    return items.length ? items : undefined;
  }

  if (isRecord(value)) {
    const entries = Object.entries(value)
      .map(([key, item]) => [key, safeCreativeReplayMetadataValue(item)] as const)
      .filter(([, item]) => item !== undefined);

    return entries.length ? Object.fromEntries(entries) : undefined;
  }

  if (typeof value === "string") {
    return safeCreativeReplayText(value, 1200);
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? value : undefined;
  }

  if (typeof value === "boolean" || value === null) {
    return value;
  }

  return undefined;
}

function safeCreativeReplayMetadataRecord(value: unknown): Record<string, unknown> | undefined {
  const normalized = safeCreativeReplayMetadataValue(value);

  return isRecord(normalized) ? normalized : undefined;
}

function sanitizeCreativeWorkingStateForHermes(state: CmoCreativeWorkingState | undefined): CmoCreativeWorkingState | undefined {
  if (!state) {
    return undefined;
  }

  const drafts = state.drafts.map((draft) => ({
    draft_id: draft.draft_id,
    kind: draft.kind,
    ...(safeCreativeReplayText(draft.title, 300) ? { title: safeCreativeReplayText(draft.title, 300) } : {}),
    ...(safeCreativeReplayText(draft.brief, 1200) ? { brief: safeCreativeReplayText(draft.brief, 1200) } : {}),
    ...(safeCreativeReplayText(draft.prompt, 3000) ? { prompt: safeCreativeReplayText(draft.prompt, 3000) } : {}),
    ...(safeCreativeReplayText(draft.negative_prompt, 800) ? { negative_prompt: safeCreativeReplayText(draft.negative_prompt, 800) } : {}),
    ...(safeCreativeReplayText(draft.format, 160) ? { format: safeCreativeReplayText(draft.format, 160) } : {}),
    ...(draft.status ? { status: draft.status } : {}),
    ...(draft.created_turn_id ? { created_turn_id: draft.created_turn_id } : {}),
    ...(draft.updated_turn_id ? { updated_turn_id: draft.updated_turn_id } : {}),
  }));
  const assets = (state.assets ?? []).map((asset) => ({
    ...asset,
    ...(safeCreativeReplayText(asset.prompt, 3000) ? { prompt: safeCreativeReplayText(asset.prompt, 3000) } : { prompt: undefined }),
    ...(safeCreativeReplayText(asset.visual_summary, 1200) ? { visual_summary: safeCreativeReplayText(asset.visual_summary, 1200) } : { visual_summary: undefined }),
    ...(safeCreativeReplayMetadataRecord(asset.visual_inspection) ? { visual_inspection: safeCreativeReplayMetadataRecord(asset.visual_inspection) } : { visual_inspection: undefined }),
    ...(safeCreativeReplayMetadataValue(asset.dominant_palette) !== undefined ? { dominant_palette: safeCreativeReplayMetadataValue(asset.dominant_palette) } : { dominant_palette: undefined }),
    ...(safeCreativeReplayMetadataValue(asset.detected_text) !== undefined ? { detected_text: safeCreativeReplayMetadataValue(asset.detected_text) } : { detected_text: undefined }),
    ...(safeCreativeReplayMetadataValue(asset.safe_crop_notes) !== undefined ? { safe_crop_notes: safeCreativeReplayMetadataValue(asset.safe_crop_notes) } : { safe_crop_notes: undefined }),
    ...(safeCreativeReplayText(asset.format, 160) ? { format: safeCreativeReplayText(asset.format, 160) } : { format: undefined }),
  }));

  return {
    ...state,
    drafts,
    assets,
  };
}

function latestCreativeDraftForReplay(state: CmoCreativeWorkingState | undefined): CmoCreativeWorkingState["drafts"][number] | undefined {
  if (!state?.drafts.length) {
    return undefined;
  }

  if (state.active_draft_id) {
    const activeDraft = state.drafts.find((draft) => draft.draft_id === state.active_draft_id);

    if (activeDraft) {
      return activeDraft;
    }
  }

  return state.drafts.at(-1);
}

function creativeDraftReplayText(state: CmoCreativeWorkingState | undefined): string | null {
  const draft = latestCreativeDraftForReplay(state);

  if (!draft) {
    return null;
  }

  const title = safeCreativeReplayText(draft.title, 300);
  const brief = safeCreativeReplayText(draft.brief, 1200);
  const prompt = safeCreativeReplayText(draft.prompt, 3000);
  const negativePrompt = safeCreativeReplayText(draft.negative_prompt, 800);
  const format = safeCreativeReplayText(draft.format, 160);
  const lines = [
    title ? `Creative draft: ${title}` : null,
    brief ? `Brief: ${brief}` : null,
    prompt ? `Prompt: ${prompt}` : null,
    negativePrompt ? `Negative prompt: ${negativePrompt}` : null,
    format ? `Format: ${format}` : null,
  ].filter((line): line is string => Boolean(line));

  return lines.length ? compactMultilineText(lines.join("\n"), MAX_REPLAY_MESSAGE_CHARS) : null;
}

function creativeDraftRecordReplayText(value: unknown): string | null {
  if (!isRecord(value)) {
    return null;
  }

  const title = safeCreativeReplayText(value.title, 300);
  const brief = safeCreativeReplayText(value.brief, 1200);
  const prompt = safeCreativeReplayText(value.prompt, 3000);
  const negativePrompt = safeCreativeReplayText(value.negative_prompt ?? value.negativePrompt, 800);
  const format = safeCreativeReplayText(value.format, 160);
  const lines = [
    title ? `Creative draft: ${title}` : null,
    brief ? `Brief: ${brief}` : null,
    prompt ? `Prompt: ${prompt}` : null,
    negativePrompt ? `Negative prompt: ${negativePrompt}` : null,
    format ? `Format: ${format}` : null,
  ].filter((line): line is string => Boolean(line));

  return lines.length ? compactMultilineText(lines.join("\n"), MAX_REPLAY_MESSAGE_CHARS) : null;
}

function draftArrayFromRecord(value: Record<string, unknown>): unknown[] {
  if (Array.isArray(value.drafts_upsert)) {
    return value.drafts_upsert;
  }

  if (Array.isArray(value.draftsUpsert)) {
    return value.draftsUpsert;
  }

  if (Array.isArray(value.drafts)) {
    return value.drafts;
  }

  return [];
}

function creativeDraftReplayTextFromContainer(value: unknown): string | null {
  if (!isRecord(value)) {
    return null;
  }

  const activeDraftId = canonicalAssistantText(value.active_draft_id ?? value.activeDraftId, 300);
  const drafts = draftArrayFromRecord(value);
  const activeDraft = activeDraftId
    ? drafts.find((draft) => isRecord(draft) && (draft.draft_id === activeDraftId || draft.draftId === activeDraftId))
    : undefined;
  const selectedDraft = activeDraft ?? drafts.at(-1);

  return creativeDraftRecordReplayText(selectedDraft);
}

function creativeDraftNarrativeFromHermesValue(value: unknown): string | null {
  if (!isRecord(value)) {
    return null;
  }

  const structuredOutput = isRecord(value.structured_output) ? value.structured_output : undefined;
  const containers = [
    value,
    value.suggested_creative_state_update,
    value.suggestedCreativeStateUpdate,
    value.creative_working_state,
    value.creativeWorkingState,
    structuredOutput,
    structuredOutput?.suggested_creative_state_update,
    structuredOutput?.suggestedCreativeStateUpdate,
    structuredOutput?.creative_working_state,
    structuredOutput?.creativeWorkingState,
  ];

  for (const container of containers) {
    const replayText = creativeDraftReplayTextFromContainer(container);

    if (replayText) {
      return replayText;
    }
  }

  return null;
}

function firstCanonicalStringFromRecord(value: unknown, keys: string[], maxChars = MAX_REPLAY_MESSAGE_CHARS): string | null {
  if (!isRecord(value)) {
    return null;
  }

  for (const key of keys) {
    const candidate = safeCreativeReplayText(value[key], maxChars);

    if (candidate) {
      return candidate;
    }
  }

  return null;
}

function creativeAssetReplayText(message: CMOChatMessage): string | null {
  const assets = [
    ...(message.creativeAssets ?? []),
    ...(message.creative_assets ?? []),
    ...(message.sessionArtifacts ?? []),
    ...(message.creativeWorkingState?.assets ?? []),
  ];
  const replayKeys = ["visual_summary", "visualSummary", "prompt", "prompt_used", "promptUsed", "notes", "note"];

  for (const asset of assets) {
    const replayText = firstCanonicalStringFromRecord(asset, replayKeys, 3000);

    if (replayText) {
      return replayText;
    }
  }

  return null;
}

function canonicalReplayContent(message: CMOChatMessage): string | null {
  const directContent = safeCreativeReplayText(message.content);

  if (message.role === "assistant") {
    if (typeof message.content !== "string" || !message.content.trim()) {
      return null;
    }
  }

  if (directContent) {
    return directContent;
  }

  if (message.role !== "assistant") {
    return null;
  }

  return creativeDraftReplayText(message.creativeWorkingState) ?? creativeAssetReplayText(message);
}

function replayableChatHistory(history: CMOChatMessage[]): ReplayableCmoChatMessage[] {
  return history.flatMap((message): ReplayableCmoChatMessage[] => {
    if ((message.role !== "user" && message.role !== "assistant") || isPendingToolRunPlaceholder(message) || isStaleFailureAssistantContext(message)) {
      return [];
    }

    const content = canonicalReplayContent(message);

    return content ? [{ ...message, content, role: message.role }] : [];
  });
}

function contextItemSnapshot(item: ContextItem): Record<string, unknown> {
  const title = safeCreativeReplayText(item.title, 300);
  const inclusionReason = safeCreativeReplayText(item.inclusionReason, 600);
  const content = safeCreativeReplayText(item.content, 4000);
  const contentPreview = safeCreativeReplayText(item.contentPreview, 1200);
  const sourceLabel = safeCreativeReplayText(item.source.label, 300);
  const sourcePath = safeCreativeReplayText(item.source.path, 600);

  return {
    id: item.id,
    kind: item.kind,
    ...(title ? { title } : {}),
    source: {
      sourceId: item.source.sourceId,
      type: item.source.type,
      ...(sourceLabel ? { label: sourceLabel } : {}),
      ...(sourcePath ? { path: sourcePath } : {}),
    },
    ...(inclusionReason ? { inclusionReason } : {}),
    exists: item.exists,
    ...(content ? { content } : {}),
    ...(contentPreview ? { contentPreview } : {}),
    contextQuality: item.contextQuality,
    tokenEstimate: item.tokenEstimate,
    truncated: item.truncated,
    ...(typeof item.itemCount === "number" ? { itemCount: item.itemCount } : {}),
  };
}

function noteSnapshot(note: CMOContextNote): Record<string, unknown> {
  const title = safeCreativeReplayText(note.title, 300);
  const path = safeCreativeReplayText(note.path, 600);
  const content = safeCreativeReplayText(note.content, 4000);
  const qualityReason = safeCreativeReplayText(note.qualityReason, 600);

  return {
    ...(title ? { title } : {}),
    ...(path ? { path } : {}),
    type: note.type,
    exists: note.exists,
    ...(content ? { content } : {}),
    truncated: note.truncated,
    frontmatterStatus: note.frontmatterStatus,
    contextQuality: note.contextQuality,
    ...(qualityReason ? { qualityReason } : {}),
  };
}

function vaultNoteRefSnapshot(note: VaultNoteRef): Record<string, unknown> {
  const title = safeCreativeReplayText(note.title, 300);
  const path = safeCreativeReplayText(note.path, 600);
  const reason = safeCreativeReplayText(note.reason, 600);
  const contentPreview = safeCreativeReplayText(note.contentPreview, 1200);
  const qualityReason = safeCreativeReplayText(note.qualityReason, 600);

  return {
    id: note.id,
    ...(title ? { title } : {}),
    ...(path ? { path } : {}),
    type: note.type,
    ...(reason ? { reason } : {}),
    ...(typeof note.selected === "boolean" ? { selected: note.selected } : {}),
    ...(typeof note.exists === "boolean" ? { exists: note.exists } : {}),
    ...(contentPreview ? { contentPreview } : {}),
    ...(note.frontmatterStatus ? { frontmatterStatus: note.frontmatterStatus } : {}),
    ...(note.contextQuality ? { contextQuality: note.contextQuality } : {}),
    ...(qualityReason ? { qualityReason } : {}),
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

function creativeWorkingStateForHermesCamelCase(state: CmoCreativeWorkingState): Record<string, unknown> {
  return {
    activeDraftId: state.active_draft_id ?? null,
    activeAssetId: state.active_asset_id ?? null,
    drafts: state.drafts.map((draft) => ({
      draftId: draft.draft_id,
      kind: draft.kind,
      ...(draft.title ? { title: draft.title } : {}),
      ...(draft.brief ? { brief: draft.brief } : {}),
      ...(draft.prompt ? { prompt: draft.prompt } : {}),
      ...(draft.negative_prompt ? { negativePrompt: draft.negative_prompt } : {}),
      ...(draft.format ? { format: draft.format } : {}),
      ...(draft.status ? { status: draft.status } : {}),
      ...(draft.created_turn_id ? { createdTurnId: draft.created_turn_id } : {}),
      ...(draft.updated_turn_id ? { updatedTurnId: draft.updated_turn_id } : {}),
    })),
    assets: (state.assets ?? []).map((asset) => ({
      assetId: asset.asset_id,
      kind: asset.kind,
      ...(asset.status ? { status: asset.status } : {}),
      ...(asset.prompt ? { prompt: asset.prompt } : {}),
      ...(asset.visual_summary ? { visualSummary: asset.visual_summary } : {}),
      ...(asset.visual_inspection ? { visualInspection: asset.visual_inspection } : {}),
      ...(asset.dominant_palette !== undefined ? { dominantPalette: asset.dominant_palette } : {}),
      ...(asset.detected_text !== undefined ? { detectedText: asset.detected_text } : {}),
      ...(asset.safe_crop_notes !== undefined ? { safeCropNotes: asset.safe_crop_notes } : {}),
      ...(asset.model ? { model: asset.model } : {}),
      ...(asset.operation ? { operation: asset.operation } : {}),
      ...(asset.mime_type ? { mimeType: asset.mime_type } : {}),
      ...(asset.format ? { format: asset.format } : {}),
      ...(asset.fetch_url ? { fetchUrl: asset.fetch_url } : {}),
      ...(asset.preview_url ? { previewUrl: asset.preview_url } : {}),
      ...(asset.render_url ? { renderUrl: asset.render_url } : {}),
      ...(asset.signed_url ? { signedUrl: asset.signed_url } : {}),
      ...(asset.sha256 ? { sha256: asset.sha256 } : {}),
      ...(typeof asset.bytes === "number" ? { bytes: asset.bytes } : {}),
      ...(typeof asset.width === "number" ? { width: asset.width } : {}),
      ...(typeof asset.height === "number" ? { height: asset.height } : {}),
      ...(typeof asset.aspect_ratio === "number" ? { aspectRatio: asset.aspect_ratio } : {}),
    })),
  };
}

function productPublicOrigin(): string {
  return (process.env.CMO_PUBLIC_APP_URL?.trim() || CMO_DEFAULT_PUBLIC_APP_URL).replace(/\/+$/g, "");
}

function creativeAssetDownloadFetchUrl(appId: string, assetId: string): string {
  return `${productPublicOrigin()}/api/cmo/apps/${encodeURIComponent(appId)}/creative/assets/${encodeURIComponent(assetId)}/download`;
}

function creativeReferenceAssetsForHermes(
  state: CmoCreativeWorkingState | undefined,
  appId: string,
): Record<string, unknown>[] {
  if (!state) {
    return [];
  }

  const activeAsset = state.assets?.find((asset) => asset.asset_id === state.active_asset_id) ?? state.assets?.at(-1);

  if (!activeAsset || activeAsset.kind !== "image" || !activeAsset.asset_id) {
    return [];
  }

  const fetchUrl = creativeAssetDownloadFetchUrl(appId, activeAsset.asset_id);

  return [
    {
      asset_id: activeAsset.asset_id,
      assetId: activeAsset.asset_id,
      kind: "image",
      role: "source_image",
      ...(activeAsset.mime_type ? { mime_type: activeAsset.mime_type, mimeType: activeAsset.mime_type } : {}),
      ...(activeAsset.sha256 ? { sha256: activeAsset.sha256 } : {}),
      ...(typeof activeAsset.bytes === "number" ? { bytes: activeAsset.bytes } : {}),
      ...(typeof activeAsset.width === "number" ? { width: activeAsset.width } : {}),
      ...(typeof activeAsset.height === "number" ? { height: activeAsset.height } : {}),
      fetch_url: creativeAssetDownloadFetchUrl(appId, activeAsset.asset_id),
      fetchUrl,
      auth_ref: CMO_CREATIVE_ARTIFACT_AUTH_REF,
      authRef: CMO_CREATIVE_ARTIFACT_AUTH_REF,
      auth_header: CMO_CREATIVE_ARTIFACT_AUTH_HEADER,
      authHeader: CMO_CREATIVE_ARTIFACT_AUTH_HEADER,
    },
  ];
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
  const lensCapabilityContext = createLensCapabilityContext({
    tenantId: input.request.tenantId,
    workspaceId: input.request.workspaceId,
    appId: input.request.appId,
    rangeKey: input.request.rangeKey,
  });
  const contextGroundingRules = lensReadoutArtifact ? [LENS_READOUT_GROUNDING_RULE] : [];
  const sessionLocalSources = sessionLocalSourceArtifacts(input);
  const sessionWorkingMemoryResolution = resolveSessionWorkingMemory({
    scope: {
      tenantId: input.request.tenantId ?? input.request.workspaceId ?? input.request.appId,
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
  const sanitizedCreativeWorkingState = sanitizeCreativeWorkingStateForHermes(input.creativeWorkingState);
  const creativeWorkingStateForHermes = sanitizedCreativeWorkingState &&
    (
      sanitizedCreativeWorkingState.drafts.length > 0 ||
      (sanitizedCreativeWorkingState.assets?.length ?? 0) > 0 ||
      sanitizedCreativeWorkingState.active_draft_id ||
      sanitizedCreativeWorkingState.active_asset_id
    )
    ? sanitizedCreativeWorkingState
    : undefined;
  const creativeWorkingStatePresent = Boolean(creativeWorkingStateForHermes);
  const creativeIdeationDetected = input.creativeIdeationDetected === true;
  const creativeSessionFollowupDetected = input.creativeSessionFollowupDetected === true;
  const creativeNativeSession = creativeWorkingStatePresent || creativeIdeationDetected || creativeSessionFollowupDetected;
  const creativeExecutionIntent = isExplicitCreativeExecutionIntent(input.message) && !creativeNativeSession;
  const cmoOwnedCreativeDecisionEnvelope = creativeNativeSession || creativeExecutionIntent;
  const creativeConversationIntentMetadata = {};
  const creativeMutationIntentMetadata = {};
  const creativeWorkingStateCamelCase = creativeWorkingStateForHermes
    ? creativeWorkingStateForHermesCamelCase(creativeWorkingStateForHermes)
    : undefined;
  const creativeReferenceAssets = creativeReferenceAssetsForHermes(creativeWorkingStateForHermes, input.request.appId);
  const activeCreativeAssetResolutionSource = input.activeCreativeAssetResolutionSource ??
    (creativeReferenceAssets.length > 0 ? "creativeWorkingState" : "none");
  const creativeCapabilities = cmoOwnedCreativeDecisionEnvelope
      ? {
        creative: {
          canProposeDraft: true,
          canUpdateDraftState: true,
          canExecuteImageGeneration: true,
          canInspectImage: true,
          requiresUserConfirmationBeforeExecute: true,
        },
      }
    : undefined;
  const hermesCapabilities = {
    ...(creativeCapabilities ?? {}),
    lens: lensCapabilityContext,
  };
  const creativeSideEffectPolicy = cmoOwnedCreativeDecisionEnvelope
    ? {
        creativeMutationAllowed: true,
        requiresExplicitUserIntentForMutation: true,
      }
    : undefined;
  const productIntentHint = cmoOwnedCreativeDecisionEnvelope
    ? {
        possible_domain: "creative",
        confidence: creativeNativeSession ? 0.7 : 0.72,
        reason: creativeNativeSession
          ? "Creative working state or asset references are present."
          : "Creative capability may be relevant to this turn.",
      }
    : undefined;
  const creativeAllowedAgents: Array<"echo" | "surf" | "vault_agent" | "creative"> = cmoOwnedCreativeDecisionEnvelope
    ? ["echo", "surf", "vault_agent", "creative"]
    : ["echo", "surf"];
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
    tenant_id: lensCapabilityContext.scope.tenant_id,
    workspace_id: lensCapabilityContext.scope.workspace_id,
    app_id: lensCapabilityContext.scope.app_id,
    workspace: {
      tenant_id: lensCapabilityContext.scope.tenant_id,
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
      ...(productIntentHint ? { product_intent_hint: productIntentHint } : {}),
      ...(creativeNativeSession ? { creative_session: true } : {}),
      ...(creativeIdeationDetected ? { creative_ideation_detected: true } : {}),
      ...(creativeSessionFollowupDetected ? { creative_session_followup_detected: true } : {}),
      ...creativeConversationIntentMetadata,
      ...creativeMutationIntentMetadata,
    },
    input: {
      input_material: inputMaterial,
      ...(creativeIdeationDetected
        ? {
            creative_ideation_intent: {
              requested: true,
              agent: "creative",
              cmo_owns_creative_decision: true,
              product_must_not_choose_creative_execution: true,
            },
          }
        : {}),
      ...(creativeNativeSession
        ? {
            creativeSession: true,
            cmoOwnsCreativeDecision: true,
            creativeDecisionOwnerWhenLive: "hermes_cmo",
            ...creativeConversationIntentMetadata,
            ...creativeMutationIntentMetadata,
          }
        : {}),
      ...(creativeWorkingStateForHermes ? { creative_working_state: creativeWorkingStateForHermes } : {}),
      ...(creativeWorkingStateCamelCase ? { creativeWorkingState: creativeWorkingStateCamelCase } : {}),
      ...(creativeReferenceAssets.length ? { reference_assets: creativeReferenceAssets, referenceAssets: creativeReferenceAssets } : {}),
      ...(creativeExecutionIntent
        ? {
            creative_decision_context: {
              agent: "creative",
              direct_user_prompt_is_sufficient_execution_input: true,
              accepted_project_context_required: false,
              accepted_workspace_context_required: false,
              return_local_paths: true,
              include_metadata: true,
              require_review_before_publish: true,
              cmo_owns_creative_decision: true,
              product_must_not_choose_creative_execution: true,
              factual_claim_guardrails: [
                "Do not invent unsupported product mechanics, rewards, APY, WLD, eligibility, or roadmap claims.",
                "Use the user-supplied visual direction as the brief when accepted workspace context is missing.",
                "If product facts are missing, produce generic brand-safe visual direction instead of blocking execution.",
              ],
            },
          }
        : {}),
    },
    ...(creativeWorkingStateForHermes ? { creative_working_state: creativeWorkingStateForHermes } : {}),
    ...(creativeWorkingStateCamelCase ? { creativeWorkingState: creativeWorkingStateCamelCase } : {}),
    ...(creativeReferenceAssets.length ? { reference_assets: creativeReferenceAssets, referenceAssets: creativeReferenceAssets } : {}),
    ...(creativeNativeSession
      ? {
          creativeSession: true,
          creative_session: true,
          cmoOwnsCreativeDecision: true,
          cmo_owns_creative_decision: true,
          creativeDecisionOwnerWhenLive: "hermes_cmo",
          creative_decision_owner_when_live: "hermes_cmo",
          ...creativeConversationIntentMetadata,
          ...creativeMutationIntentMetadata,
        }
      : {}),
    ...(creativeExecutionIntent
      ? {
          cmoOwnsCreativeDecision: true,
          cmo_owns_creative_decision: true,
          creativeDecisionOwnerWhenLive: "hermes_cmo",
          creative_decision_owner_when_live: "hermes_cmo",
        }
      : {}),
    capabilities: hermesCapabilities,
    ...(creativeSideEffectPolicy ? { sideEffectPolicy: creativeSideEffectPolicy } : {}),
    ...(productIntentHint ? { product_intent_hint: productIntentHint } : {}),
    ...(creativeIdeationDetected ? { creative_ideation_detected: true } : {}),
    ...(creativeSessionFollowupDetected ? { creative_session_followup_detected: true } : {}),
    input_material: inputMaterial,
    messages: recentConversationMessages(input.history),
    context_pack: {
      current_priority: currentPriority,
      selected_context: [...input.contextPackage.selectedContext.map(noteSnapshot), ...recentChatContext(input.history)],
      recent_session_summary: recentSessionSummary(input.history),
      indexed_context_supplement: indexedContextSupplement,
      artifacts_in: [vaultContextPack, ...sessionLocalSources, ...sessionLocalResearchResults, sourceAnswerContext, lensReadoutArtifact].filter((artifact): artifact is Record<string, unknown> => Boolean(artifact)),
      lens_request_context: lensCapabilityContext,
      ...(input.contextPackage.activeSourceId ? { active_source_id: input.contextPackage.activeSourceId } : {}),
      ...(sourceReviewContext ? { source_review_context: sourceReviewContext } : {}),
      ...(sourceAnswerContext ? { source_answer_context: sourceAnswerContext } : {}),
      ...(lensReadoutContext ? { lens_readout_context: lensReadoutContext } : {}),
      ...(creativeWorkingStateForHermes ? { creative_working_state: creativeWorkingStateForHermes } : {}),
      ...(creativeWorkingStateCamelCase ? { creativeWorkingState: creativeWorkingStateCamelCase } : {}),
      ...(creativeReferenceAssets.length ? { reference_assets: creativeReferenceAssets, referenceAssets: creativeReferenceAssets } : {}),
      ...(creativeNativeSession
        ? {
            creativeSession: true,
            cmoOwnsCreativeDecision: true,
            creativeDecisionOwnerWhenLive: "hermes_cmo",
            ...creativeConversationIntentMetadata,
            ...creativeMutationIntentMetadata,
            capabilities: hermesCapabilities,
          }
        : {}),
      ...(creativeIdeationDetected ? { creative_ideation_detected: true } : {}),
      ...(creativeSessionFollowupDetected ? { creative_session_followup_detected: true } : {}),
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
      missing_context: missingContextForHermes.map(vaultNoteRefSnapshot),
      ...(creativeExecutionIntent
        ? {
            optional_context_gaps: omittedCreativeMissingContext.map((note) => ({
              title: note.title,
              path: note.path,
              reason: "Accepted project context is optional for explicit Creative execution when the user prompt supplies the visual brief.",
            })),
          }
        : {}),
      context_used: input.contextUsed.map(vaultNoteRefSnapshot),
    },
    constraints: {
      no_direct_vault_write: true,
      no_direct_memory_mutation: true,
      vault_agent_delegation_allowed: false,
      vault_agent_requires_save_intent: true,
      kanban_enabled: false,
      demo_mode: true,
      allowed_agents: creativeAllowedAgents,
      allowed_surf_modes: ["surf.default", "surf.x", "surf.trend", "surf.pulse"],
      delegations_mode: HERMES_CMO_PROPOSALS_ONLY,
      capabilities: hermesCapabilities,
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
            creative_execution_may_be_requested_by_cmo: true,
            creative_decision_owner_when_live: "hermes_cmo",
            product_intent_hint: productIntentHint,
            sideEffectPolicy: creativeSideEffectPolicy,
            accepted_project_context_required: false,
            accepted_workspace_context_required: false,
            missing_accepted_context_blocks_creative_execution: false,
          }
        : {}),
      ...(creativeWorkingStateForHermes
        ? {
            creative_working_state_present: true,
            creative_active_draft_id: creativeWorkingStateForHermes.active_draft_id ?? null,
            active_creative_context_present: true,
            active_creative_asset_resolved: creativeReferenceAssets.length > 0,
            active_creative_asset_resolution_source: activeCreativeAssetResolutionSource,
            active_creative_asset_id: creativeWorkingStateForHermes.active_asset_id ?? null,
            creative_drafts_count: creativeWorkingStateForHermes.drafts.length,
            creative_assets_count: creativeWorkingStateForHermes.assets?.length ?? 0,
            reference_assets_count: creativeReferenceAssets.length,
            reference_asset_fetch_url_present: creativeReferenceAssets.some((asset) => typeof asset.fetch_url === "string"),
            reference_asset_sha256_present: creativeReferenceAssets.some((asset) => typeof asset.sha256 === "string"),
            reference_asset_bytes_present: creativeReferenceAssets.some((asset) => typeof asset.bytes === "number"),
            creative_session_from_asset: Boolean(creativeWorkingStateForHermes.active_asset_id || (creativeWorkingStateForHermes.assets?.length ?? 0) > 0),
            creative_session_followup_detected: creativeSessionFollowupDetected,
            ...creativeConversationIntentMetadata,
            ...creativeMutationIntentMetadata,
            creative_side_effects_allowed: true,
            requires_user_confirmation_before_creative_execute: true,
            cmo_owns_creative_decision: true,
            product_must_not_choose_creative_execution: true,
          }
        : {}),
      ...(creativeIdeationDetected
        ? {
            creative_ideation_detected: true,
            ...creativeConversationIntentMetadata,
            ...creativeMutationIntentMetadata,
            creative_side_effects_allowed: true,
            requires_user_confirmation_before_creative_execute: true,
            cmo_owns_creative_decision: true,
            product_must_not_choose_creative_execution: true,
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
      allowed_agents: creativeAllowedAgents,
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
      capabilities: hermesCapabilities,
      ...(creativeExecutionIntent
        ? {
            creative_execution_may_be_requested_by_cmo: true,
            creative_decision_owner_when_live: "hermes_cmo",
            product_intent_hint: productIntentHint,
            sideEffectPolicy: creativeSideEffectPolicy,
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
      ...(creativeWorkingStateForHermes
        ? {
            creative_working_state_present: true,
            creative_active_draft_id: creativeWorkingStateForHermes.active_draft_id ?? null,
            active_creative_context_present: true,
            active_creative_asset_resolved: creativeReferenceAssets.length > 0,
            active_creative_asset_resolution_source: activeCreativeAssetResolutionSource,
            active_creative_asset_id: creativeWorkingStateForHermes.active_asset_id ?? null,
            creative_drafts_count: creativeWorkingStateForHermes.drafts.length,
            creative_assets_count: creativeWorkingStateForHermes.assets?.length ?? 0,
            reference_assets_count: creativeReferenceAssets.length,
            reference_asset_fetch_url_present: creativeReferenceAssets.some((asset) => typeof asset.fetch_url === "string"),
            reference_asset_sha256_present: creativeReferenceAssets.some((asset) => typeof asset.sha256 === "string"),
            reference_asset_bytes_present: creativeReferenceAssets.some((asset) => typeof asset.bytes === "number"),
            creative_session_from_asset: Boolean(creativeWorkingStateForHermes.active_asset_id || (creativeWorkingStateForHermes.assets?.length ?? 0) > 0),
            creative_session_followup_detected: creativeSessionFollowupDetected,
            ...creativeConversationIntentMetadata,
            ...creativeMutationIntentMetadata,
            creative_execution_may_be_requested_by_cmo: true,
            creative_side_effects_allowed: true,
            requires_user_confirmation_before_creative_execute: true,
            cmo_owns_creative_decision: true,
            product_must_not_choose_creative_execution: true,
          }
        : {}),
      ...(creativeIdeationDetected
        ? {
            creative_ideation_detected: true,
            ...creativeConversationIntentMetadata,
            ...creativeMutationIntentMetadata,
            creative_execution_may_be_requested_by_cmo: true,
            creative_side_effects_allowed: true,
            requires_user_confirmation_before_creative_execute: true,
            cmo_owns_creative_decision: true,
            product_must_not_choose_creative_execution: true,
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
      cmo_engine_must_not_synthesize_creative_answer_when_live: true,
      creative_decision_owner_when_live: "hermes_cmo",
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
  const answerBasis: Record<string, unknown> = isRecord(response.answer_basis) ? response.answer_basis : {};
  const value = response.classification ?? structured.classification ?? answerBasis.mode;

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
  const completedSourceTransform = arrayValue<Record<string, unknown>>(result.delegationSummary).find((delegation) =>
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

function creativeNarrativeFromHermes(response: HermesCmoRuntimeResponse, result?: HermesCmoRuntimeResult): string {
  const narrativeKeys = ["visual_summary", "visualSummary", "notes", "note"];
  const directNarrative = firstCanonicalStringFromRecord(response, narrativeKeys, 1200);

  if (directNarrative) {
    return directNarrative;
  }

  const resultNarrative = firstCanonicalStringFromRecord(result?.response, narrativeKeys, 1200);

  if (resultNarrative) {
    return resultNarrative;
  }

  const creativeAssets = Array.isArray(response.creative_assets)
    ? response.creative_assets
    : Array.isArray(result?.response.creative_assets)
      ? result.response.creative_assets
      : [];
  const assetNarrative = creativeAssets
    .map((asset) => firstCanonicalStringFromRecord(asset, narrativeKeys, 1200))
    .find((value): value is string => Boolean(value));

  return assetNarrative ?? "";
}

function userVisibleAnswerFromHermes(response: HermesCmoRuntimeResponse): string | null {
  const userVisible = isRecord(response.user_visible) ? response.user_visible : null;

  return canonicalAssistantText(userVisible?.answer);
}

function answerFromHermes(response: HermesCmoRuntimeResponse, result?: HermesCmoRuntimeResult): string {
  const userVisibleAnswer = userVisibleAnswerFromHermes(response);

  if (typeof response.answer === "string") {
    return canonicalAssistantText(response.answer) ?? userVisibleAnswer ?? "";
  }

  if (!response.answer) {
    if (userVisibleAnswer) {
      return userVisibleAnswer;
    }

    const creativeDraftNarrative = creativeDraftNarrativeFromHermesValue(response) ?? creativeDraftNarrativeFromHermesValue(result?.response);

    if (creativeDraftNarrative) {
      return creativeDraftNarrative;
    }

    if (hasCreativeExecutionMetadata(response) || hasCreativeExecutionMetadata(result?.response)) {
      return creativeNarrativeFromHermes(response, result);
    }

    const clarifyingQuestion: Record<string, unknown> = isRecord(response.clarifying_question) ? response.clarifying_question : {};
    const question = typeof clarifyingQuestion.question === "string" ? clarifyingQuestion.question.trim() : "";

    return question ? ["## Need Clarification", "", question].join("\n") : "";
  }

  const classification = classificationFromResponse(response);
  const transformed = (classification === "source_translate" || classification === "source_transform") && result
    ? sourceTransformAnswerFromDelegations(result)
    : null;
  const canonicalTransformed = canonicalAssistantText(transformed);

  if (canonicalTransformed) {
    return canonicalTransformed;
  }

  const answer = response.answer;
  const body = canonicalAssistantText(answer.body);
  const content = canonicalAssistantText(answer.content);
  const summary = canonicalAssistantText(answer.summary);
  const creativeDraftNarrative = creativeDraftNarrativeFromHermesValue(response) ?? creativeDraftNarrativeFromHermesValue(result?.response);

  return body ?? content ?? userVisibleAnswer ?? summary ?? creativeDraftNarrative ?? (
    hasCreativeExecutionMetadata(response) || hasCreativeExecutionMetadata(result?.response)
      ? creativeNarrativeFromHermes(response, result)
      : ""
  );
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

const CREATIVE_B_DIAGNOSTIC_KEYS = [
  "reference_asset_fetch_status",
  "local_image_path_available",
  "creative_visual_inspection_attempted",
  "creative_visual_inspection_used",
  "creative_visual_inspection_status",
  "creative_visual_inspection_error",
  "creative_answer_source",
  "creative_visual_observations",
  "creative_post_generation_visual_inspection_attempted",
  "creative_post_generation_visual_inspection_used",
  "creative_post_generation_visual_inspection_status",
  "creative_post_generation_visual_metadata",
] as const;

function creativeBDiagnosticsFromRecords(records: Array<Record<string, unknown> | undefined>): Record<string, unknown> {
  const diagnostics: Record<string, unknown> = {};

  for (const key of CREATIVE_B_DIAGNOSTIC_KEYS) {
    for (const record of records) {
      if (record && record[key] !== undefined) {
        diagnostics[key] = record[key];
        break;
      }
    }
  }

  return diagnostics;
}

function suggestedActionsFromHermes(response: HermesCmoRuntimeResponse): CMOAppChatResponse["suggestedActions"] {
  const structured = isRecord(response.structured_output) ? response.structured_output : {};
  const nextSteps = Array.isArray(structured.next_steps) ? structured.next_steps : [];
  const recommendations = Array.isArray(structured.recommendations) ? structured.recommendations : [];
  const actionLabels = [...nextSteps, ...recommendations].map(labelFromUnknown).filter((label): label is string => Boolean(label));
  const delegationLabels = arrayValue<Record<string, unknown>>(response.delegations)
    .map((delegation) => {
      const target = isRecord(delegation.target) && typeof delegation.target.agent === "string" ? delegation.target.agent : "specialist";
      const objective = typeof delegation.objective === "string" ? delegation.objective : "proposed delegation";

      return `Review proposed ${target} delegation: ${objective}`;
    });
  const memorySuggestionLabels = arrayValue(response.memory_suggestions)
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
  return arrayValue<HermesCmoDelegationSummaryItem>(result.delegationSummary).map((delegation) => ({
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
      .map((event) => hermesAgentUsedFromActivitySource(cmoActivityEventSourceAgent(event)))
      .filter((agent): agent is HermesCmoAgentUsed => Boolean(agent)),
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

  return normalizeCmoActivityEvents(result.activity_events, {
    sessionId: result.request.session_id,
    turnId: result.request.turn_id,
    requestId: result.request.request_id,
    createdAt: result.request.created_at,
  })
    .filter((event) => {
      const sourceAgent = cmoActivityEventSourceAgent(event);

      if (sourceAgent !== "surf" && sourceAgent !== "echo") {
        return true;
      }

      return executedMatches.has(`${sourceAgent}:${cmoActivityEventSourceMode(event)}`);
    }) as HermesCmoActivityEventSummary[];
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
  const structuredOutput: Record<string, unknown> = isRecord(result.response.structured_output) ? result.response.structured_output : {};
  const activitySummary: Record<string, unknown> | undefined = isRecord(result.response.activity_summary) ? result.response.activity_summary : undefined;
  const creativeBDiagnostics = creativeBDiagnosticsFromRecords([structuredOutput, result.response, activitySummary]);
  const answerBasis: Record<string, unknown> = isRecord(result.response.answer_basis) ? result.response.answer_basis : {};
  const answerBasisMode = typeof answerBasis.mode === "string" ? answerBasis.mode : undefined;
  const creativeIdeationResponseReceived = answerBasisMode === "creative_ideation";
  const creativeSessionResponseReceived = answerBasisMode === "creative_session" || answerBasisMode === "creative_refinement";
  const creativeConversationResponseReceived = answerBasisMode === "creative_conversation";
  const creativeExecutionResponseReceived = answerBasisMode === "creative_execution";
  const creativeNativeResponseReceived = creativeIdeationResponseReceived || creativeSessionResponseReceived || creativeConversationResponseReceived || creativeExecutionResponseReceived;
  const creativeStateUpdatePresent =
    result.response.suggested_creative_state_update !== undefined ||
    structuredOutput.suggested_creative_state_update !== undefined ||
    result.response.drafts_upsert !== undefined ||
    structuredOutput.drafts_upsert !== undefined;
  const creativeDecisionRecord = isRecord(result.response.creative_decision)
    ? result.response.creative_decision
    : isRecord(structuredOutput.creative_decision)
      ? structuredOutput.creative_decision
      : undefined;
  const creativeDecisionPresent = Boolean(creativeDecisionRecord);
  const creativeDecisionAction = typeof creativeDecisionRecord?.action === "string" ? creativeDecisionRecord.action : undefined;
  const creativeDecisionDraftId = typeof creativeDecisionRecord?.draft_id === "string"
    ? creativeDecisionRecord.draft_id
    : typeof creativeDecisionRecord?.draftId === "string"
      ? creativeDecisionRecord.draftId
      : undefined;
  const creativeDecisionOperation = typeof creativeDecisionRecord?.operation === "string" ? creativeDecisionRecord.operation : undefined;
  const creativeConversationMode = typeof structuredOutput.creative_conversation_mode === "string" && structuredOutput.creative_conversation_mode.trim()
    ? structuredOutput.creative_conversation_mode.trim()
    : creativeConversationResponseReceived && (creativeDecisionAction === "review" || creativeDecisionAction === "critique")
      ? "review"
      : creativeConversationResponseReceived && creativeDecisionAction === "ask_clarification"
        ? "clarify"
        : creativeConversationResponseReceived && (creativeDecisionAction === "ideate" || creativeDecisionAction === "propose_prompt")
          ? "ideation"
          : creativeConversationResponseReceived
            ? "advisory"
            : undefined;
  const creativeConversationOnly = typeof structuredOutput.creative_conversation_only === "boolean"
    ? structuredOutput.creative_conversation_only
    : undefined;
  const creativeNoopAcknowledgement = typeof structuredOutput.creative_noop_acknowledgement === "boolean"
    ? structuredOutput.creative_noop_acknowledgement
    : undefined;
  const creativePromptProposalOnly = typeof structuredOutput.creative_prompt_proposal_only === "boolean"
    ? structuredOutput.creative_prompt_proposal_only
    : undefined;
  const creativeMutationRequested = typeof structuredOutput.creative_mutation_requested === "boolean"
    ? structuredOutput.creative_mutation_requested
    : undefined;
  const activityEventTypes = activityEvents.map((event) => event.type);
  const rawActivityEventTypes = Array.isArray(structuredOutput.raw_activity_event_types)
    ? structuredOutput.raw_activity_event_types.filter((item): item is string => typeof item === "string")
    : [];
  const activityEventsAllowedForCreativeIdeation =
    typeof structuredOutput.activity_events_allowed_for_creative_ideation === "boolean"
      ? structuredOutput.activity_events_allowed_for_creative_ideation
      : undefined;
  const activityEventsAllowedForCreativeExecution =
    typeof structuredOutput.activity_events_allowed_for_creative_execution === "boolean"
      ? structuredOutput.activity_events_allowed_for_creative_execution
      : undefined;
  const activityEventRepaired = typeof structuredOutput.activity_event_repaired === "boolean"
    ? structuredOutput.activity_event_repaired
    : undefined;
  const activityEventRepairReason =
    typeof structuredOutput.activity_event_repair_reason === "string" && structuredOutput.activity_event_repair_reason.trim()
      ? structuredOutput.activity_event_repair_reason.trim()
      : undefined;
  const activityEventIgnoredForCreativeConversation =
    typeof structuredOutput.activity_event_ignored_for_creative_conversation === "boolean"
      ? structuredOutput.activity_event_ignored_for_creative_conversation
      : undefined;
  const activityEventIgnoreReason =
    typeof structuredOutput.activity_event_ignore_reason === "string" && structuredOutput.activity_event_ignore_reason.trim()
      ? structuredOutput.activity_event_ignore_reason.trim()
      : undefined;
  const responseCreativeAssetsCount = typeof structuredOutput.creative_assets_count === "number" && Number.isFinite(structuredOutput.creative_assets_count)
    ? Math.max(0, Math.floor(structuredOutput.creative_assets_count))
    : undefined;
  const rawHermesResponseAnswerPreview = typeof structuredOutput.raw_hermes_response_answer_preview === "string"
    ? structuredOutput.raw_hermes_response_answer_preview
    : undefined;
  const traceResponseAnswerPreview = typeof structuredOutput.trace_response_answer_preview === "string"
    ? structuredOutput.trace_response_answer_preview
    : undefined;
  const responseTraceRedactionApplied = typeof structuredOutput.response_trace_redaction_applied === "boolean"
    ? structuredOutput.response_trace_redaction_applied
    : undefined;
  const m1ValidationAnswerSource = structuredOutput.m1_validation_answer_source === "canonical_answer" ||
    structuredOutput.m1_validation_answer_source === "raw_hermes_response" ||
    structuredOutput.m1_validation_answer_source === "trace_response" ||
    structuredOutput.m1_validation_answer_source === "mapped_response"
    ? structuredOutput.m1_validation_answer_source
    : undefined;
  const diagnosticPreviewIgnoredForM1 = typeof structuredOutput.diagnostic_preview_ignored_for_m1 === "boolean"
    ? structuredOutput.diagnostic_preview_ignored_for_m1
    : undefined;
  const creativeIdeationCanonicalized =
    typeof structuredOutput.creative_ideation_canonicalized === "boolean"
      ? structuredOutput.creative_ideation_canonicalized
      : undefined;
  const creativeSessionCanonicalized =
    typeof structuredOutput.creative_session_canonicalized === "boolean"
      ? structuredOutput.creative_session_canonicalized
      : undefined;
  const creativeExecutionCanonicalized =
    typeof structuredOutput.creative_execution_canonicalized === "boolean"
      ? structuredOutput.creative_execution_canonicalized
      : undefined;
  const rejectedActivityEventType =
    typeof structuredOutput.rejected_activity_event_type === "string" && structuredOutput.rejected_activity_event_type.trim()
      ? structuredOutput.rejected_activity_event_type.trim()
      : undefined;
  const requestInput = isRecord(result.request.input) ? result.request.input : {};
  const requestConstraints: Record<string, unknown> = isRecord(result.request.constraints) ? result.request.constraints : {};
  const requestCreativeState = isRecord(result.request.creative_working_state)
    ? result.request.creative_working_state
    : isRecord(requestInput.creative_working_state)
      ? requestInput.creative_working_state
      : {};
  const requestActiveDraftId =
    typeof requestCreativeState.active_draft_id === "string" && requestCreativeState.active_draft_id.trim()
      ? requestCreativeState.active_draft_id.trim()
      : undefined;
  const creativeSubprocessExecuted = hasCreativeExecutionMetadata(result.response);
  const artifactTransportAttempted = isRecord(result.request.artifact_transport);
  const artifactTransportMode = artifactTransportAttempted && typeof result.request.artifact_transport?.mode === "string"
    ? result.request.artifact_transport.mode
    : undefined;
  const referenceAssetsCount = Array.isArray(result.request.reference_assets)
    ? result.request.reference_assets.length
    : Array.isArray(result.request.referenceAssets)
      ? result.request.referenceAssets.length
      : undefined;
  const attachmentTraceSummary = isRecord(result.response.attachment_trace_summary) ? result.response.attachment_trace_summary : undefined;
  const responseRoute = result.response.route;
  const responseIntentDecision = result.response.intent_decision;
  const responseSpecialistCalls = Array.isArray(result.response.specialist_calls) ? result.response.specialist_calls : undefined;
  const responseCreativeDecision = result.response.creative_decision ?? structuredOutput.creative_decision;
  const responseDiagnostics = isRecord(result.response.diagnostics) ? result.response.diagnostics : undefined;
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
    ...(responseRoute !== undefined ? { route: responseRoute, hermes_route: responseRoute } : {}),
    ...(responseIntentDecision !== undefined ? { intent_decision: responseIntentDecision } : {}),
    ...(responseSpecialistCalls ? { specialist_calls: responseSpecialistCalls } : {}),
    ...(isRecord(responseCreativeDecision) ? { creative_decision: responseCreativeDecision } : {}),
    ...(responseDiagnostics ? { diagnostics: responseDiagnostics, hermes_diagnostics: responseDiagnostics } : {}),
    artifact_transport_attempted: artifactTransportAttempted,
    ...(artifactTransportMode ? { artifact_transport_mode: artifactTransportMode } : {}),
    creative_long_running_turn: result.creativeLongRunningTurn,
    ...(result.creativeLongRunningTurn ? { creative_timeout_ms: result.hermesCmoEndpointTimeoutMs } : {}),
    ...(result.creativeLongRunningTurn ? { timeout_source: result.hermesCmoEndpointTimeoutSource } : {}),
    ...(result.creativeLongRunningTurn ? { outer_timeout_source: "creative_execute" } : {}),
    ...(result.creativeLongRunningTurn ? { workspace_fallback_suppressed_for_creative: true } : {}),
    fallback_used: false,
    ...(result.hermesCmoRouteDecision === "creative_execution" ? { creative_execution_requested: true } : {}),
    ...(answerBasisMode ? { answer_basis_mode: answerBasisMode } : {}),
    ...creativeBDiagnostics,
    ...(creativeNativeResponseReceived
      ? {
          ...(creativeIdeationResponseReceived ? { creative_ideation_response_received: true } : {}),
          ...(creativeSessionResponseReceived ? { creative_session_response_received: true } : {}),
          ...(creativeConversationResponseReceived ? {
            creative_conversation_response_received: true,
            creative_conversation_mode: creativeConversationMode,
            ...(typeof creativeConversationOnly === "boolean" ? { creative_conversation_only: creativeConversationOnly } : {}),
            ...(typeof creativeNoopAcknowledgement === "boolean" ? { creative_noop_acknowledgement: creativeNoopAcknowledgement } : {}),
            ...(typeof creativePromptProposalOnly === "boolean" ? { creative_prompt_proposal_only: creativePromptProposalOnly } : {}),
            ...(typeof creativeMutationRequested === "boolean" ? { creative_mutation_requested: creativeMutationRequested } : {}),
            creative_asset_mutation: false,
            creative_state_mutation: false,
            m1_validation_result: "accepted",
          } : {}),
          ...(rawHermesResponseAnswerPreview ? { raw_hermes_response_answer_preview: rawHermesResponseAnswerPreview } : {}),
          ...(traceResponseAnswerPreview ? { trace_response_answer_preview: traceResponseAnswerPreview } : {}),
          ...(typeof responseTraceRedactionApplied === "boolean" ? { response_trace_redaction_applied: responseTraceRedactionApplied } : {}),
          ...(m1ValidationAnswerSource ? { m1_validation_answer_source: m1ValidationAnswerSource } : {}),
          ...(typeof diagnosticPreviewIgnoredForM1 === "boolean" ? { diagnostic_preview_ignored_for_m1: diagnosticPreviewIgnoredForM1 } : {}),
          ...(creativeConversationResponseReceived ? { user_visible_answer_source: "raw_hermes_response" as const } : {}),
          ...(creativeExecutionResponseReceived ? {
            creative_execution_response_received: true,
            creative_execution_owner: "cmo",
            creative_execution_requested: false,
            m1_validation_result: "accepted",
          } : {}),
          creative_state_update_present: creativeStateUpdatePresent,
          creative_decision_present: creativeDecisionPresent,
          ...(creativeDecisionAction ? { creative_session_decision_action: creativeDecisionAction } : {}),
          ...(creativeDecisionDraftId || requestActiveDraftId
            ? { creative_session_active_draft_id: creativeDecisionDraftId ?? requestActiveDraftId }
            : {}),
          ...(requestConstraints.creative_session_followup_detected === true
            ? { creative_session_followup_detected: true }
            : {}),
          ...(requestConstraints.creative_working_state_present === true ? { creative_working_state_present: true } : {}),
          ...(typeof requestConstraints.active_creative_asset_id === "string" ? { active_creative_asset_id: requestConstraints.active_creative_asset_id } : {}),
          ...(creativeConversationResponseReceived
            ? { creative_assets_count: responseCreativeAssetsCount ?? 0 }
            : typeof requestConstraints.creative_assets_count === "number"
              ? { creative_assets_count: requestConstraints.creative_assets_count }
              : {}),
          ...(typeof referenceAssetsCount === "number" ? { reference_assets_count: referenceAssetsCount } : {}),
          ...(artifactTransportMode ? { artifact_transport_mode: artifactTransportMode } : {}),
          ...(creativeDecisionAction === "execute"
            ? { execute_decision_source: "hermes_cmo_creative_decision" }
            : {}),
          creative_subprocess_executed: creativeSubprocessExecuted,
          artifact_transport_attempted: artifactTransportAttempted,
          ...(creativeDecisionOperation ? { creative_decision_operation: creativeDecisionOperation } : {}),
          activity_event_types: activityEventTypes,
          ...(rawActivityEventTypes.length > 0 ? { raw_activity_event_types: rawActivityEventTypes } : {}),
          ...(typeof activityEventsAllowedForCreativeIdeation === "boolean"
            ? { activity_events_allowed_for_creative_ideation: activityEventsAllowedForCreativeIdeation }
            : {}),
          ...(typeof activityEventsAllowedForCreativeExecution === "boolean"
            ? { activity_events_allowed_for_creative_execution: activityEventsAllowedForCreativeExecution }
            : {}),
          ...(typeof activityEventRepaired === "boolean" ? { activity_event_repaired: activityEventRepaired } : {}),
          ...(activityEventRepairReason ? { activity_event_repair_reason: activityEventRepairReason } : {}),
          ...(typeof activityEventIgnoredForCreativeConversation === "boolean"
            ? { activity_event_ignored_for_creative_conversation: activityEventIgnoredForCreativeConversation }
            : {}),
          ...(activityEventIgnoreReason ? { activity_event_ignore_reason: activityEventIgnoreReason } : {}),
          ...(typeof creativeIdeationCanonicalized === "boolean"
            ? { creative_ideation_canonicalized: creativeIdeationCanonicalized }
            : {}),
          ...(typeof creativeSessionCanonicalized === "boolean"
            ? { creative_session_canonicalized: creativeSessionCanonicalized }
            : {}),
          ...(typeof creativeExecutionCanonicalized === "boolean"
            ? { creative_execution_canonicalized: creativeExecutionCanonicalized }
            : {}),
          ...(rejectedActivityEventType ? { rejected_activity_event_type: rejectedActivityEventType } : {}),
          rejected_by_m1_validator: false,
        }
      : {}),
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
    const sourceAgent = cmoActivityEventSourceAgent(event);

    if (sourceAgent !== "surf" && sourceAgent !== "echo") {
      return true;
    }

    return executedDelegationMatchKeys(delegationSummary).has(`${sourceAgent}:${cmoActivityEventSourceMode(event)}`);
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
    answer: canonicalAssistantText(result.answer) ?? "",
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
    assumptions: isRecord(result.response.answer_basis) && Array.isArray(result.response.answer_basis.assumptions_used)
      ? result.response.answer_basis.assumptions_used.map(assumptionText)
      : [],
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
