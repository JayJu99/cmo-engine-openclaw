import type {
  CmoCreativeDecision,
  CmoCreativeDecisionAction,
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

export function normalizeCreativeWorkingState(value: unknown): CmoCreativeWorkingState | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const drafts = Array.isArray(value.drafts)
    ? value.drafts.map(normalizeCreativeDraft).filter((draft): draft is CmoCreativeDraft => Boolean(draft))
    : [];
  const dedupedDrafts = Array.from(new Map(drafts.map((draft) => [draft.draft_id, draft])).values());
  const activeDraftId = value.active_draft_id === null
    ? null
    : stringValue(value.active_draft_id ?? value.activeDraftId);

  if (!dedupedDrafts.length && !activeDraftId) {
    return undefined;
  }

  return {
    ...(activeDraftId !== undefined ? { active_draft_id: activeDraftId } : {}),
    drafts: dedupedDrafts,
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
    value === "refine_draft" ||
    value === "execute" ||
    value === "ask_clarification" ||
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
  return Boolean(state && (state.drafts.length > 0 || state.active_draft_id));
}
