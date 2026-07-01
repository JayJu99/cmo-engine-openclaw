import { readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relativePath) => readFileSync(path.join(root, relativePath), "utf8");
const hermesFirst = read("src/lib/cmo/hermes-first-cmo-chat.ts");
const appStore = read("src/lib/cmo/app-chat-store.ts");
const router = read("src/lib/cmo/hermes-cmo-chat-router.ts");

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

const importLines = hermesFirst
  .split(/\r?\n/)
  .filter((line) => line.trim().startsWith("import"));
const appBranch = section(appStore, "if (hermesFirstNormalChatRequested)", "if (!usedHermesCmoChat && shouldStartAsyncHermesCmoToolRun");
const runtimeSelection = section(appStore, "const hermesFirstNormalChatRequested", "const contextPackBuildStartedMs");
const directCommandHelper = section(router, "export function isHermesFirstLegacyDirectCommand", "export function isHermesFirstNormalChatTurn");
const normalTurnHelper = section(router, "export function isHermesFirstNormalChatTurn", "export function shouldUseHermesCmoToolChat");
const forbiddenImportTokens = [
  "app-routing-intent",
  "cmo-surf-orchestrator",
  "echo-bridge",
  "surf-bridge",
  "/runtime",
  "hermes-cmo-runtime",
];
const forbiddenCalls = [
  "routeIntentForMessage",
  "resolveHermesCmoChatRoute",
  "maybeHandleSurfBridge",
  "maybeHandleEchoBridge",
  "executeCmoSurfEvidence",
  "buildMixedCmoEchoRuntimeMessage",
  "executeMixedCmoEcho",
  "getRuntimeRegistry",
  "FallbackRuntime",
  "runHermesCmoRuntime",
];

check("hermes_first_module_does_not_import_app_routing_intent", !importLines.some((line) => line.includes("app-routing-intent")));
check("hermes_first_module_does_not_import_echo_or_surf_bridges", !importLines.some((line) => line.includes("echo-bridge") || line.includes("surf-bridge") || line.includes("cmo-surf-orchestrator")));
check("hermes_first_module_does_not_import_runtime_fallback", !importLines.some((line) => line.includes("/runtime")));
check("hermes_first_module_does_not_import_legacy_hermes_cmo_runtime", !importLines.some((line) => line.includes("hermes-cmo-runtime")));
check("hermes_first_module_has_no_forbidden_calls", forbiddenCalls.every((call) => !new RegExp(`\\b${call}\\s*\\(`).test(hermesFirst)));
check("hermes_first_branch_precedes_legacy_execution_blocks", appStore.indexOf("if (hermesFirstNormalChatRequested)") < appStore.indexOf("if (!usedHermesCmoChat && hermesCmoChatV11Requested)") && appStore.indexOf("if (hermesFirstNormalChatRequested)") < appStore.indexOf("if (!usedHermesCmoChat)"));
check("app_chat_store_hermes_first_branch_has_no_second_brain_calls", forbiddenCalls.every((call) => !new RegExp(`\\b${call}\\s*\\(`).test(appBranch)));
check("hermes_first_branch_does_not_fall_through_to_legacy_execution", appStore.includes("if (!usedHermesCmoChat && shouldStartAsyncHermesCmoToolRun") && appStore.includes("if (!usedHermesCmoChat && hermesCmoChatV11Requested)") && appStore.includes("} else if (!usedHermesCmoChat && hermesCmoLegacyRequested)"));
check("hermes_first_turn_calls_exactly_one_hermes_endpoint", appBranch.includes("runHermesFirstCmoChat") && !appBranch.includes("runHermesCmoChatV11") && !appBranch.includes("runHermesCmoRuntime") && !appBranch.includes("/agents/cmo/execute") && !appBranch.includes("/agents/cmo/tool-execute"));
check("downstream_legacy_execution_blocks_guarded_by_used_hermes_cmo_chat", appStore.includes("if (!usedHermesCmoChat && shouldStartAsyncHermesCmoToolRun") && appStore.includes("if (!usedHermesCmoChat && hermesCmoChatV11Requested)") && appStore.includes("} else if (!usedHermesCmoChat && hermesCmoLegacyRequested)"));
check("runtime_selection_is_guarded_for_hermes_first", runtimeSelection.includes("if (!hermesFirstNormalChatRequested)") && runtimeSelection.includes("getRuntimeRegistry().selectRuntime") && runtimeSelection.includes("new FallbackRuntime"));
check("legacy_route_resolution_is_guarded_for_hermes_first", appStore.includes("const preliminaryHermesCmoRoute = hermesFirstNormalChatRequested") && appStore.includes("const hermesCmoRoute = hermesFirstNormalChatRequested"));
check("hermes_first_branch_has_no_business_fallback_answer_templates", !appBranch.includes("Workspace context was used") && !appBranch.includes("Need Clarification") && !appBranch.includes("fallback_after_hermes_failure"));
check("hermes_first_branch_has_no_cmo_orchestration_instruction_strings", ![
  "CMO orchestration instruction:",
  "CMO evidence orchestration instruction:",
  "Treat @Echo as a specialist execution request",
].some((token) => appBranch.includes(token)));
check("direct_command_detection_is_prefix_only", directCommandHelper.includes("^\\s*") && !directCommandHelper.includes("routeIntentForMessage") && !normalTurnHelper.includes("routeIntentForMessage"));
check("forbidden_import_token_set_is_enforced", forbiddenImportTokens.every((token) => !importLines.some((line) => line.includes(token))));

if (process.exitCode) {
  process.exit(process.exitCode);
}

console.log(`cmo-hermes-first-no-second-brain-check: ${checks.length} checks passed`);
