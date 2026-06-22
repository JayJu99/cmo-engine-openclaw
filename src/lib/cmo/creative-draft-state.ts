import type {
  CmoCreativeDecision,
  CmoCreativeDecisionAction,
  CmoCreativeAssetState,
  CmoCreativeDraft,
  CmoCreativeDraftKind,
  CmoCreativeWorkingState,
} from "@/lib/cmo/app-workspace-types";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function normalizeCreativeDraftKind(value: unknown): CmoCreativeDraftKind | undefined {
  return value === "image" || value === "video" ? value : undefined;
}

export function normalizeCreativeDraft(value: unknown): CmoCreativeDraft | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const draftId = stringValue(value.draft_id ?? value.draftId);
  const kind = normalizeCreativeDraftKind(value.kind) ?? "image";

  if (!draftId) {
    return undefined;
  }

  return {
    draft_id: draftId,
    kind,
    ...(stringValue(value.title) ? { title: stringValue(value.title) } : {}),
    ...(stringValue(value.brief) ? { brief: stringValue(value.brief) } : {}),
    ...(stringValue(value.prompt) ? { prompt: stringValue(value.prompt) } : {}),
    ...(stringValue(value.negative_prompt ?? value.negativePrompt) ? { negative_prompt: stringValue(value.negative_prompt ?? value.negativePrompt) } : {}),
    ...(stringValue(value.format) ? { format: stringValue(value.format) } : {}),
    ...(stringValue(value.status) ? { status: stringValue(value.status) } : {}),
    ...(stringValue(value.created_turn_id ?? value.createdTurnId) ? { created_turn_id: stringValue(value.created_turn_id ?? value.createdTurnId) } : {}),
    ...(stringValue(value.updated_turn_id ?? value.updatedTurnId) ? { updated_turn_id: stringValue(value.updated_turn_id ?? value.updatedTurnId) } : {}),
  };
}

export function normalizeCreativeAssetState(value: unknown): CmoCreativeAssetState | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const assetId = stringValue(value.asset_id ?? value.assetId ?? value.id);
  const kind = normalizeCreativeDraftKind(value.kind ?? value.asset_type ?? value.assetType ?? value.type) ?? "image";

  if (!assetId) {
    return undefined;
  }

  return {
    asset_id: assetId,
    kind,
    ...(stringValue(value.status) ? { status: stringValue(value.status) } : {}),
    ...(stringValue(value.prompt ?? value.prompt_used ?? value.promptUsed) ? { prompt: stringValue(value.prompt ?? value.prompt_used ?? value.promptUsed) } : {}),
    ...(stringValue(value.visual_summary ?? value.visualSummary ?? value.notes) ? { visual_summary: stringValue(value.visual_summary ?? value.visualSummary ?? value.notes) } : {}),
    ...(stringValue(value.model) ? { model: stringValue(value.model) } : {}),
    ...(stringValue(value.operation) ? { operation: stringValue(value.operation) } : {}),
    ...(stringValue(value.mime_type ?? value.mimeType) ? { mime_type: stringValue(value.mime_type ?? value.mimeType) } : {}),
    ...(stringValue(value.render_url ?? value.renderUrl ?? value.preview_url ?? value.previewUrl ?? value.url) ? { render_url: stringValue(value.render_url ?? value.renderUrl ?? value.preview_url ?? value.previewUrl ?? value.url) } : {}),
    ...(stringValue(value.signed_url ?? value.signedUrl) ? { signed_url: stringValue(value.signed_url ?? value.signedUrl) } : {}),
    ...(stringValue(value.sha256) ? { sha256: stringValue(value.sha256) } : {}),
    ...(numberValue(value.bytes) !== undefined ? { bytes: numberValue(value.bytes) } : {}),
  };
}

export function normalizeCreativeWorkingState(value: unknown): CmoCreativeWorkingState | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const drafts = Array.isArray(value.drafts)
    ? value.drafts.map(normalizeCreativeDraft).filter((draft): draft is CmoCreativeDraft => Boolean(draft))
    : [];
  const dedupedDrafts = Array.from(new Map(drafts.map((draft) => [draft.draft_id, draft])).values());
  const assets = Array.isArray(value.assets)
    ? value.assets.map(normalizeCreativeAssetState).filter((asset): asset is CmoCreativeAssetState => Boolean(asset))
    : [];
  const dedupedAssets = Array.from(new Map(assets.map((asset) => [asset.asset_id, asset])).values());
  const activeDraftId = value.active_draft_id === null
    ? null
    : stringValue(value.active_draft_id ?? value.activeDraftId);
  const activeAssetId = value.active_asset_id === null
    ? null
    : stringValue(value.active_asset_id ?? value.activeAssetId);

  if (!dedupedDrafts.length && !dedupedAssets.length && !activeDraftId && !activeAssetId) {
    return undefined;
  }

  return {
    ...(activeDraftId !== undefined ? { active_draft_id: activeDraftId } : {}),
    ...(activeAssetId !== undefined ? { active_asset_id: activeAssetId } : {}),
    drafts: dedupedDrafts,
    ...(dedupedAssets.length ? { assets: dedupedAssets } : {}),
  };
}

function normalizeSuggestedCreativeStateUpdate(value: unknown): { active_draft_id?: string | null; drafts_upsert: CmoCreativeDraft[] } | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const container = isRecord(value.creative_working_state) ? value.creative_working_state : value;
  const draftCandidates = Array.isArray(value.drafts_upsert)
    ? value.drafts_upsert
    : Array.isArray(value.draftsUpsert)
      ? value.draftsUpsert
      : Array.isArray(container.drafts)
        ? container.drafts
        : [];
  const draftsUpsert = draftCandidates
    .map(normalizeCreativeDraft)
    .filter((draft): draft is CmoCreativeDraft => Boolean(draft));
  const activeDraftId = value.active_draft_id === null || container.active_draft_id === null
    ? null
    : stringValue(value.active_draft_id ?? value.activeDraftId ?? container.active_draft_id ?? container.activeDraftId);

  if (!draftsUpsert.length && activeDraftId === undefined) {
    return undefined;
  }

  return {
    ...(activeDraftId !== undefined ? { active_draft_id: activeDraftId } : {}),
    drafts_upsert: draftsUpsert,
  };
}

export function applySuggestedCreativeStateUpdate(
  current: CmoCreativeWorkingState | undefined,
  update: unknown,
): CmoCreativeWorkingState | undefined {
  const normalizedUpdate = normalizeSuggestedCreativeStateUpdate(update);

  if (!normalizedUpdate) {
    return current;
  }

  const draftsById = new Map<string, CmoCreativeDraft>();

  for (const draft of current?.drafts ?? []) {
    draftsById.set(draft.draft_id, draft);
  }

  for (const draft of normalizedUpdate.drafts_upsert) {
    draftsById.set(draft.draft_id, {
      ...(draftsById.get(draft.draft_id) ?? {}),
      ...draft,
    });
  }

  const activeDraftId = Object.prototype.hasOwnProperty.call(normalizedUpdate, "active_draft_id")
    ? normalizedUpdate.active_draft_id
    : current?.active_draft_id;

  const nextState = normalizeCreativeWorkingState({
    ...(activeDraftId !== undefined ? { active_draft_id: activeDraftId } : {}),
    drafts: Array.from(draftsById.values()),
  });

  return nextState;
}

export function applyCreativeAssetStateUpdate(
  current: CmoCreativeWorkingState | undefined,
  assetsInput: unknown[],
): CmoCreativeWorkingState | undefined {
  const assets = assetsInput
    .map(normalizeCreativeAssetState)
    .filter((asset): asset is CmoCreativeAssetState => Boolean(asset));

  if (!assets.length) {
    return current;
  }

  const assetsById = new Map<string, CmoCreativeAssetState>();

  for (const asset of current?.assets ?? []) {
    assetsById.set(asset.asset_id, asset);
  }

  for (const asset of assets) {
    assetsById.set(asset.asset_id, {
      ...(assetsById.get(asset.asset_id) ?? {}),
      ...asset,
    });
  }

  const activeAssetId = assets[assets.length - 1]?.asset_id ?? current?.active_asset_id;

  return normalizeCreativeWorkingState({
    ...(current?.active_draft_id !== undefined ? { active_draft_id: current.active_draft_id } : {}),
    ...(activeAssetId !== undefined ? { active_asset_id: activeAssetId } : {}),
    drafts: current?.drafts ?? [],
    assets: Array.from(assetsById.values()),
  });
}

export function extractSuggestedCreativeStateUpdate(response: unknown): unknown {
  if (!isRecord(response)) {
    return undefined;
  }

  if (response.suggested_creative_state_update !== undefined) {
    return response.suggested_creative_state_update;
  }

  const structured = isRecord(response.structured_output) ? response.structured_output : {};

  return structured.suggested_creative_state_update;
}

function normalizeCreativeDecisionAction(value: unknown): CmoCreativeDecisionAction | undefined {
  return value === "propose_draft" ||
    value === "present_draft" ||
    value === "show_draft" ||
    value === "refine_draft" ||
    value === "execute" ||
    value === "ask_clarification" ||
    value === "blocked" ||
    value === "cancel" ||
    value === "none"
    ? value
    : undefined;
}

export function normalizeCreativeDecision(value: unknown): CmoCreativeDecision | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const action = normalizeCreativeDecisionAction(value.action);

  if (!action) {
    return undefined;
  }

  return {
    action,
    ...(stringValue(value.draft_id ?? value.draftId) ? { draft_id: stringValue(value.draft_id ?? value.draftId) } : {}),
    ...(stringValue(value.operation) ? { operation: stringValue(value.operation) } : {}),
    ...(stringValue(value.question) ? { question: stringValue(value.question) } : {}),
    ...(stringValue(value.reason) ? { reason: stringValue(value.reason) } : {}),
  };
}

export function extractCreativeDecision(response: unknown): CmoCreativeDecision | undefined {
  if (!isRecord(response)) {
    return undefined;
  }

  const structured = isRecord(response.structured_output) ? response.structured_output : {};

  return normalizeCreativeDecision(response.creative_decision ?? structured.creative_decision);
}

export function hasCreativeWorkingStateDrafts(state: CmoCreativeWorkingState | undefined): boolean {
  return Boolean(state && (state.drafts.length > 0 || state.active_draft_id || (state.assets?.length ?? 0) > 0 || state.active_asset_id));
}
