import type { CmoSessionLocalResearchResult } from "./app-workspace-types";

export type CmoSessionWorkingMemoryAction =
  | "table_comparison"
  | "ranking_similarity"
  | "advantage_differentiation"
  | "positioning_strategy"
  | "claim_selection"
  | "criteria_comparison";

export type CmoSessionWorkingMemoryActiveContextKind = "research_result" | "source_context" | "none";

export interface CmoSessionWorkingMemoryScope {
  tenantId: string;
  workspaceId: string;
  appId: string;
  userId: string;
  sessionId: string;
}

export interface CmoSessionWorkingMemory {
  schema_version: "cmo.session_working_memory.v1";
  active_context_kind: CmoSessionWorkingMemoryActiveContextKind;
  research_followup_requested: boolean;
  research_followup_action: CmoSessionWorkingMemoryAction | null;
  should_call_surf: boolean;
  session_local_research_results_count: number;
  scoped_research_result_ids: string[];
  scope: {
    tenant_id: string;
    workspace_id: string;
    app_id: string;
    user_id: string;
    session_id: string;
  };
  safety: {
    read_only: true;
    vault_mutation: false;
    gbrain_mutation: false;
    durable_memory_mutation: false;
    promotion_performed: false;
  };
}

export interface CmoSessionWorkingMemoryResolution {
  scopedResearchResults: CmoSessionLocalResearchResult[];
  workingMemory: CmoSessionWorkingMemory;
}

const normalizeText = (value: string): string =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

const stripAcknowledgementPrefix = (value: string): string =>
  value
    .replace(/^\s*(?:ok(?:ay)?|hmmm+|hmm+|rồi|ừ|uh|thanks?|thank you|cảm ơn|cam on|rõ rồi|ro roi)[,.\s:;-]+/i, "")
    .trim();

const nativeOnlyPattern =
  /^(?:ok(?:ay)?|thanks?|thank you|cảm ơn|cam on|rõ rồi|ro roi|ừ|uh|noted|got it|hiểu rồi)(?:\s+(?:bro|nhé|nha|ạ))?[.!?]*$/i;

const sourceQuestionPattern =
  /\b(?:faq|docs?|document|source|url|link|kyc|aml|policy|terms|tài liệu|tai lieu|nguồn|nguon|hợp đồng|hop dong)\b/i;

const newResearchPattern =
  /\b(?:find|search|research|look up|tìm|tim|tìm thêm|tim them|thêm\s+\d+|them\s+\d+|bên khác|ben khac|khác nữa|khac nua|more|another|other)\b/i;

const actionPatterns: Array<[CmoSessionWorkingMemoryAction, RegExp]> = [
  ["table_comparison", /\b(?:table|comparison table|lập bảng|lap bang|bảng|bang)\b/i],
  ["ranking_similarity", /\b(?:rank|ranking|closest|most similar|giống nhất|giong nhat|xếp hạng|xep hang|bên nào giống|ben nao giong)\b/i],
  ["advantage_differentiation", /\b(?:advantage|edge|differentiat|khác biệt|khac biet|lợi thế|loi the|thắng ở đâu|thang o dau|win where|better than|hơn so với|hon so voi)\b/i],
  ["positioning_strategy", /\b(?:position|positioning|wedge|định vị|dinh vi|position hold|thế nào so với|the nao so voi)\b/i],
  ["claim_selection", /\b(?:claim|message|angle|nên dùng|nen dung|dùng claim|dung claim|copy angle)\b/i],
  ["criteria_comparison", /\b(?:criteria|criterion|scorecard|theo tiêu chí|theo tieu chi|so theo|compare by)\b/i],
];

export function classifySessionResearchFollowupAction(message: string): CmoSessionWorkingMemoryAction | null {
  const stripped = stripAcknowledgementPrefix(message);
  const normalized = normalizeText(stripped);

  for (const [action, pattern] of actionPatterns) {
    if (pattern.test(stripped) || pattern.test(normalized)) {
      return action;
    }
  }

  return null;
}

export function sessionResearchResultMatchesScope(
  result: CmoSessionLocalResearchResult,
  scope: CmoSessionWorkingMemoryScope,
): boolean {
  return (
    result.tenant_id === scope.tenantId &&
    result.workspace_id === scope.workspaceId &&
    result.app_id === scope.appId &&
    result.user_id === scope.userId &&
    result.session_id === scope.sessionId
  );
}

export function resolveSessionWorkingMemory(input: {
  message: string;
  scope: CmoSessionWorkingMemoryScope;
  researchResults?: CmoSessionLocalResearchResult[];
  sourceContextAvailable?: boolean;
}): CmoSessionWorkingMemoryResolution {
  const scopedResearchResults = (input.researchResults ?? [])
    .filter((result) => sessionResearchResultMatchesScope(result, input.scope))
    .slice(0, 3);
  const normalized = normalizeText(stripAcknowledgementPrefix(input.message));
  const action = classifySessionResearchFollowupAction(input.message);
  const nativeOnly = nativeOnlyPattern.test(input.message.trim());
  const sourceQuestion = sourceQuestionPattern.test(normalized);
  const newResearch = newResearchPattern.test(normalized) && !action;
  const researchFollowupRequested = Boolean(action && !nativeOnly && !sourceQuestion && !newResearch);
  const activeContextKind: CmoSessionWorkingMemoryActiveContextKind =
    researchFollowupRequested && scopedResearchResults.length > 0
      ? "research_result"
      : input.sourceContextAvailable && sourceQuestion
        ? "source_context"
        : "none";

  return {
    scopedResearchResults,
    workingMemory: {
      schema_version: "cmo.session_working_memory.v1",
      active_context_kind: activeContextKind,
      research_followup_requested: researchFollowupRequested,
      research_followup_action: researchFollowupRequested ? action : null,
      should_call_surf: newResearch,
      session_local_research_results_count: scopedResearchResults.length,
      scoped_research_result_ids: scopedResearchResults.map((result) => result.research_id),
      scope: {
        tenant_id: input.scope.tenantId,
        workspace_id: input.scope.workspaceId,
        app_id: input.scope.appId,
        user_id: input.scope.userId,
        session_id: input.scope.sessionId,
      },
      safety: {
        read_only: true,
        vault_mutation: false,
        gbrain_mutation: false,
        durable_memory_mutation: false,
        promotion_performed: false,
      },
    },
  };
}
