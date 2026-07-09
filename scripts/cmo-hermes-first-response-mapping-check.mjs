import { readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relativePath) => readFileSync(path.join(root, relativePath), "utf8");
const hermesFirst = read("src/lib/cmo/hermes-first-cmo-chat.ts");
const appStore = read("src/lib/cmo/app-chat-store.ts");
const types = read("src/lib/cmo/app-workspace-types.ts");
const chatPanel = read("src/components/cmo-apps/cmo-chat-panel.tsx");

const checks = [];

function check(name, condition, detail = "") {
  if (!condition) {
    console.error(`not ok ${name}${detail ? ` - ${detail}` : ""}`);
    process.exitCode = 1;
    return;
  }

  checks.push(name);
  console.log(`ok ${name}`);
}

function section(source, start, end) {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  return startIndex >= 0 && endIndex > startIndex ? source.slice(startIndex, endIndex) : "";
}

const normalizer = section(hermesFirst, "export function normalizeHermesFirstCmoChatResponse", "function responsePreview");
const mapper = section(hermesFirst, "export function mapHermesFirstCmoChatToAppChat", "export function hermesFirstBoundaryFailureResponse");

check("maps_answer_body_to_assistant_content_with_safety_scrub", normalizer.includes("sanitizeHermesFirstUserVisibleText") && normalizer.includes("body: safeAnswerBody") && mapper.includes("answer: input.response.answer.body.trim()"));
check("rejects_answer_content_without_answer_body", normalizer.includes("missing_answer_body") && !normalizer.includes("answer.content"));
check("maps_activity_events_to_activity_events", normalizer.includes("activity_events: normalizeActivityEvents") && mapper.includes("activityEvents: input.response.activity_events"));
check("maps_delegation_summary_to_delegation_summary", normalizer.includes("delegation_summary: normalizeDelegationSummary") && mapper.includes("delegationSummary: input.response.delegation_summary"));
check("maps_artifacts_out_to_session_artifacts_after_safety_scrub", normalizer.includes("artifacts_out: safeHermesFirstRecordList") && mapper.includes("sessionArtifacts: input.response.artifacts_out"));
check("maps_creative_artifacts_without_dropping_original_artifact", appStore.includes("mergeHermesCmoChatV11Artifacts(sessionArtifacts, mappedChat.sessionArtifacts)"));
check("maps_approval_requests_to_approval_requests_after_safety_scrub", normalizer.includes("approval_requests: safeHermesFirstRecordList") && mapper.includes("approvalRequests: input.response.approval_requests") && types.includes("approvalRequests?: Record<string, unknown>[]"));
check("maps_suggested_vault_updates_to_draft_review_candidates_after_safety_scrub", normalizer.includes("suggested_vault_updates: safeHermesFirstRecordList") && appStore.includes("mergeSuggestedVaultUpdates(suggestedVaultUpdates, mappedChat.suggestedVaultUpdates)"));
check("maps_warnings_and_errors_to_metadata_after_safety_scrub", normalizer.includes("warnings: safeHermesFirstStringList") && normalizer.includes("errors: safeHermesFirstErrorsList") && mapper.includes("contract_warnings") && mapper.includes("errors: input.response.errors"));
check("response_mapping_scrubs_unsafe_native_fragments_without_product_strategy", hermesFirst.includes("sanitizeOutboundHermesContextText") && hermesFirst.includes("HERMES_FIRST_UNSAFE_RESPONSE_RECORD_KEYS") && !normalizer.includes("traffic social") && !normalizer.includes("publish luon"));
check("does_not_generate_assumptions_or_suggested_actions_unless_hermes_sent_them", mapper.includes("assumptions: []") && mapper.includes("suggestedActions: []"));
check("needs_user_input_maps_to_completed_turn", normalizer.includes('payload.status === "needs_user_input"') && mapper.includes('input.response.status === "failed" ? "failed" : "completed"'));
check("validates_response_ids_before_mapping", normalizer.includes("responseContractFailure") && hermesFirst.includes("responseFieldMismatch") && hermesFirst.includes("Hermes CMO chat response identifiers did not match the request"));
check("validates_response_mode_and_schema_version", hermesFirst.includes('payload.mode !== "cmo.chat"') && hermesFirst.includes("payload.schema_version !== HERMES_FIRST_CMO_CHAT_RESPONSE_SCHEMA"));
check("preserves_lens_and_vault_agent_provenance", hermesFirst.includes('value === "lens"') && hermesFirst.includes('value === "vault_agent"') && types.includes('"lens"') && types.includes('"vault_agent"'));
check("delegation_summary_objective_is_optional", hermesFirst.includes("...(objective ? { objective } : {})") && types.includes("objective?: string"));
check("app_chat_store_preserves_approval_requests", appStore.includes("approvalRequests = mergeApprovalRequests") && appStore.includes("approvalRequests.length ? { approvalRequests }"));
check("chat_panel_receives_approval_requests", chatPanel.includes("approvalRequests: response.approvalRequests") && chatPanel.includes("renderApprovalRequests"));

if (process.exitCode) {
  process.exit(process.exitCode);
}

console.log(`cmo-hermes-first-response-mapping-check: ${checks.length} checks passed`);
