import { readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relativePath) => readFileSync(path.join(root, relativePath), "utf8");
const router = read("src/lib/cmo/hermes-cmo-chat-router.ts");
const hermesFirst = read("src/lib/cmo/hermes-first-cmo-chat.ts");
const appStore = read("src/lib/cmo/app-chat-store.ts");
const liveSmoke = read("scripts/cmo-app-turn-live-smoke.mjs");
const nativeSmoke = read("scripts/cmo-app-chat-fallback-smoke.mjs");

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

const requestBuilder = section(
  hermesFirst,
  "export function buildHermesFirstCmoChatRequest",
  "function missingAnswerBody",
);
const createAppChatPrefix = section(
  appStore,
  "export async function createAppChatSession",
  "const contextPackBuildStartedMs",
);
const normalTurnHelper = section(
  router,
  "export function isHermesFirstNormalChatTurn",
  "export function shouldUseHermesCmoToolChat",
);
const importLines = hermesFirst
  .split(/\r?\n/)
  .filter((line) => line.trim().startsWith("import"));

check("normal_chat_request_uses_agents_cmo_chat_v11", hermesFirst.includes('HERMES_FIRST_CMO_CHAT_ENDPOINT = "/agents/cmo/chat"'));
check("normal_chat_request_schema_is_v1_1", hermesFirst.includes('HERMES_FIRST_CMO_CHAT_REQUEST_SCHEMA = "hermes.cmo.chat.request.v1_1"'));
check("normal_chat_request_id_has_hf_prefix", requestBuilder.includes("req_hf_cmo_chat_"));
check("normal_chat_request_has_shell_contract_fields", [
  "context_pack",
  "attachments",
  "tool_policy",
  "persistence_policy",
  "ui_contract",
  "shell_trace",
].every((token) => requestBuilder.includes(token)));
check("normal_chat_request_contains_context_without_cmo_instruction_wrappers", ![
  "CMO orchestration instruction:",
  "CMO evidence orchestration instruction:",
  "Treat @Echo as a specialist execution request",
].some((token) => requestBuilder.includes(token)));
check("normal_chat_request_forbids_product_intent_hint", hermesFirst.includes('"product_intent_hint"') && !requestBuilder.includes("product_intent_hint"));
check("normal_chat_request_forbids_route_decision", hermesFirst.includes('"route_decision"') && !requestBuilder.includes("route_decision:"));
check("normal_chat_request_forbids_creative_semantic_flags", ![
  "creative_ideation_detected:",
  "creative_session_followup_detected:",
  "creative_execution_requested:",
  "cmo_owns_creative_decision:",
].some((token) => requestBuilder.includes(token)));
check("normal_chat_request_forbids_allowed_agents_and_allowed_surf_modes", !requestBuilder.includes("allowed_agents") && !requestBuilder.includes("allowed_surf_modes"));
check("normal_chat_request_forbids_legacy_cmo_request_v1", !requestBuilder.includes("mapCmoChatToHermesCmoRequest"));
check("forbidden_checks_are_scoped_away_from_user_content", hermesFirst.includes('SAFE_CONTEXT_NAMESPACES') && hermesFirst.includes('"messages"') && hermesFirst.includes('"context_pack"') && hermesFirst.includes('"attachments"') && hermesFirst.includes('path.join(".") === "intent.user_message"'));
check("ordinary_chat_is_native_hermes_default_without_flag_or_canary", normalTurnHelper.includes("Boolean(input.appId.trim())") && !normalTurnHelper.includes("forceFallback") && !router.includes("shouldUseHermesFirstCmoChat") && !router.includes("CMO_HERMES_FIRST_CMO_CHAT"));
check("normal_referral_and_strategy_prompts_use_native_hermes_path", [
  "How should we improve referral conversion this week?",
  "Create a CMO strategy for our next acquisition push.",
].every((message) => !/^\s*(?:(?:\/surf|@surf)(?:\s+x)?\b|\/trend\b|\/pulse\b|\/x\b|(?:\/echo|@echo)\b)/i.test(message)) && normalTurnHelper.includes("!isHermesFirstLegacyDirectCommand(input.message)"));
check("direct_surf_command_stays_on_legacy_path", router.includes("/surf") && router.includes("@surf") && router.includes("isHermesFirstLegacyDirectCommand"));
check("direct_trend_command_stays_on_legacy_path", router.includes("/trend"));
check("direct_pulse_command_stays_on_legacy_path", router.includes("/pulse"));
check("direct_x_command_stays_on_legacy_path", router.includes("/x"));
check("direct_echo_command_stays_on_legacy_path", router.includes("/echo") && router.includes("@echo"));
check("local_decision_review_command_stays_product_local", createAppChatPrefix.indexOf("parseLocalChatCommand") >= 0 && createAppChatPrefix.indexOf("parseLocalChatCommand") < createAppChatPrefix.indexOf("isHermesFirstNormalChatTurn"));
check("force_fallback_does_not_bypass_native_normal_chat", !normalTurnHelper.includes("forceFallback"));
check("normal_chat_smokes_persist_request_and_response_before_assertions", [liveSmoke, nativeSmoke].every((source) => {
  const requestArtifact = source.indexOf("await persist");
  const fetchCall = source.indexOf("await fetch(");
  const responseArtifact = source.lastIndexOf("await persist");
  const firstAssertion = source.indexOf("assert(response.ok");
  return requestArtifact >= 0 && requestArtifact < fetchCall && responseArtifact > fetchCall && responseArtifact < firstAssertion;
}));
check("native_smoke_has_no_product_strategy_fallback", !nativeSmoke.includes("forceFallback") && nativeSmoke.includes("assert(!/Runtime Note/i.test(data.answer)"));
check("hermes_first_module_has_no_forbidden_imports", ![
  "app-routing-intent",
  "cmo-surf-orchestrator",
  "echo-bridge",
  "surf-bridge",
  "/runtime",
  "hermes-cmo-runtime",
].some((token) => importLines.some((line) => line.includes(token))));

if (process.exitCode) {
  process.exit(process.exitCode);
}

console.log(`cmo-hermes-first-contract-check: ${checks.length} checks passed`);
