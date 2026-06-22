import type {
  CmoCreativeDecision,
  CmoCreativeDecisionAction,
  CmoCreativeAssetState,
  CmoCreativeDraft,
  CmoCreativeDraftKind,
  CmoCreativeWorkingState,
} from "./app-workspace-types";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

const PRODUCT_CREATIVE_ASSET_ID_PATTERN = /^creative_asset_/;
const SYNTHETIC_CREATIVE_ASSET_ID_PATTERN = /^creative_(?:creative_)?msg_/;
const LOCAL_OR_REDACTED_ARTIFACT_PATTERN = /^(?:file:|[A-Za-z]:[\\/]|\/(?:tmp|var|Users|home|private|Volumes)\b|\[hermes_local_artifact_path_redacted\])/i;
const RENDERABLE_CREATIVE_ASSET_STATUSES = new Set(["stored", "uploaded", "available", "completed", "success"]);
const RENDERABLE_CREATIVE_TRANSPORT_STATUSES = new Set(["uploaded", "available"]);
const RENDERABLE_CREATIVE_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "video/mp4", "video/webm"]);

function normalizeCreativeDraftKind(value: unknown): CmoCreativeDraftKind | undefined {
  return value === "image" || value === "video" ? value : undefined;
}

function normalizedAssetPreviewIdentity(asset: CmoCreativeAssetState): string | undefined {
  const value = stringValue(asset.signed_url ?? asset.render_url ?? asset.preview_url ?? asset.storage_path ?? asset.sha256);

  if (!value) {
    return undefined;
  }

  if (LOCAL_OR_REDACTED_ARTIFACT_PATTERN.test(value)) {
    return undefined;
  }

  if (/^https?:\/\//i.test(value)) {
    try {
      const url = new URL(value);
      return `${url.origin}${url.pathname}`;
    } catch {
      return value;
    }
  }

  return value;
}

function isExplicitProductBackedCreativeAsset(asset: CmoCreativeAssetState): boolean {
  const transportStatus = stringValue(asset.transport_status);
  const storagePath = stringValue(asset.storage_path);
  const assetId = stringValue(asset.asset_id);

  return Boolean(
    assetId && PRODUCT_CREATIVE_ASSET_ID_PATTERN.test(assetId) ||
      transportStatus && RENDERABLE_CREATIVE_TRANSPORT_STATUSES.has(transportStatus) ||
      storagePath && !LOCAL_OR_REDACTED_ARTIFACT_PATTERN.test(storagePath),
  );
}

function dedupeRenderableCreativeAssets(assets: CmoCreativeAssetState[]): CmoCreativeAssetState[] {
  const byAssetId = new Map<string, CmoCreativeAssetState>();
  const byIdentity = new Map<string, CmoCreativeAssetState>();

  for (const asset of assets) {
    const existingById = byAssetId.get(asset.asset_id);
    const merged = existingById ? { ...existingById, ...asset } : asset;
    const identity = normalizedAssetPreviewIdentity(merged);
    const existingByIdentity = identity ? byIdentity.get(identity) : undefined;
    const next = existingByIdentity ? { ...existingByIdentity, ...merged } : merged;

    byAssetId.delete(next.asset_id);
    byAssetId.set(next.asset_id, next);

    if (identity) {
      byIdentity.delete(identity);
      byIdentity.set(identity, next);
    }
  }

  const identityWinners = new Set(byIdentity.values());

  return Array.from(byAssetId.values()).filter((asset) => {
    const identity = normalizedAssetPreviewIdentity(asset);

    return !identity || identityWinners.has(asset);
  });
}

export function isSyntheticCreativeAssetId(value: unknown): boolean {
  return typeof value === "string" && SYNTHETIC_CREATIVE_ASSET_ID_PATTERN.test(value.trim());
}

export function isProductBackedRenderableCreativeAsset(value: unknown): boolean {
  const asset = normalizeCreativeAssetState(value);

  if (!asset || isSyntheticCreativeAssetId(asset.asset_id)) {
    return false;
  }

  if (!asset.mime_type || !RENDERABLE_CREATIVE_MIME_TYPES.has(asset.mime_type)) {
    return false;
  }

  if (asset.kind !== "image" && asset.kind !== "video") {
    return false;
  }

  if (asset.status && !RENDERABLE_CREATIVE_ASSET_STATUSES.has(asset.status)) {
    return false;
  }

  if (!isExplicitProductBackedCreativeAsset(asset)) {
    return false;
  }

  const pathValues = [asset.storage_path, asset.render_url, asset.preview_url, asset.signed_url].filter((item): item is string => Boolean(item));

  if (pathValues.some((item) => LOCAL_OR_REDACTED_ARTIFACT_PATTERN.test(item))) {
    return false;
  }

  return Boolean(normalizedAssetPreviewIdentity(asset) || asset.transport_status === "uploaded");
}

export function sanitizeCreativeAssetStates(values: unknown[]): CmoCreativeAssetState[] {
  const assets = values
    .map(normalizeCreativeAssetState)
    .filter((asset): asset is CmoCreativeAssetState => Boolean(asset))
    .filter(isProductBackedRenderableCreativeAsset);

  return dedupeRenderableCreativeAssets(assets);
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
    ...(normalizeCreativeDraftKind(value.asset_type ?? value.assetType) ? { asset_type: normalizeCreativeDraftKind(value.asset_type ?? value.assetType) } : {}),
    ...(stringValue(value.storage_path ?? value.storagePath) ? { storage_path: stringValue(value.storage_path ?? value.storagePath) } : {}),
    ...(stringValue(value.preview_url ?? value.previewUrl) ? { preview_url: stringValue(value.preview_url ?? value.previewUrl) } : {}),
    ...(stringValue(value.render_url ?? value.renderUrl ?? value.preview_url ?? value.previewUrl ?? value.url) ? { render_url: stringValue(value.render_url ?? value.renderUrl ?? value.preview_url ?? value.previewUrl ?? value.url) } : {}),
    ...(stringValue(value.signed_url ?? value.signedUrl) ? { signed_url: stringValue(value.signed_url ?? value.signedUrl) } : {}),
    ...(stringValue(value.transport_status ?? value.transportStatus) ? { transport_status: stringValue(value.transport_status ?? value.transportStatus) } : {}),
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
    ? sanitizeCreativeAssetStates(value.assets)
    : [];
  const dedupedAssets = dedupeRenderableCreativeAssets(assets);
  const activeDraftId = value.active_draft_id === null
    ? null
    : stringValue(value.active_draft_id ?? value.activeDraftId);
  const rawActiveAssetId = value.active_asset_id === null
    ? null
    : stringValue(value.active_asset_id ?? value.activeAssetId);
  const activeAssetId = rawActiveAssetId && dedupedAssets.some((asset) => asset.asset_id === rawActiveAssetId)
    ? rawActiveAssetId
    : dedupedAssets.at(-1)?.asset_id;

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
  const assets = sanitizeCreativeAssetStates(assetsInput);

  if (!assets.length) {
    return normalizeCreativeWorkingState(current);
  }

  const assetsById = new Map<string, CmoCreativeAssetState>();

  for (const asset of sanitizeCreativeAssetStates(current?.assets ?? [])) {
    assetsById.set(asset.asset_id, asset);
  }

  for (const asset of assets) {
    assetsById.set(asset.asset_id, {
      ...(assetsById.get(asset.asset_id) ?? {}),
      ...asset,
    });
  }

  const dedupedAssets = dedupeRenderableCreativeAssets(Array.from(assetsById.values()));
  const activeAssetId = assets.at(-1)?.asset_id ?? current?.active_asset_id;

  return normalizeCreativeWorkingState({
    ...(current?.active_draft_id !== undefined ? { active_draft_id: current.active_draft_id } : {}),
    ...(activeAssetId !== undefined ? { active_asset_id: activeAssetId } : {}),
    drafts: current?.drafts ?? [],
    assets: dedupedAssets,
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
