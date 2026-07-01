import { readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relativePath) => readFileSync(path.join(root, relativePath), "utf8");
const hermesFirst = read("src/lib/cmo/hermes-first-cmo-chat.ts");
const appStore = read("src/lib/cmo/app-chat-store.ts");
const types = read("src/lib/cmo/app-workspace-types.ts");

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
  if (!end) {
    return startIndex >= 0 ? source.slice(startIndex) : "";
  }
  const endIndex = source.indexOf(end, startIndex + start.length);
  return startIndex >= 0 && endIndex > startIndex ? source.slice(startIndex, endIndex) : "";
}

const boundary = section(hermesFirst, "export function hermesFirstBoundaryFailureResponse", "");
const run = section(hermesFirst, "export async function runHermesFirstCmoChat", "function countersFromResponse");
const appBranch = section(appStore, "if (hermesFirstNormalChatRequested)", "if (!usedHermesCmoChat && shouldStartAsyncHermesCmoToolRun");

check("timeout_returns_boundary_failure_no_product_fallback", run.includes('"timeout"') && boundary.includes("No Product fallback answer was generated."));
check("http_500_returns_boundary_failure_no_execute_fallback", run.includes('"http_error"') && run.includes("response.status >= 500") && !hermesFirst.includes("/agents/cmo/execute"));
check("http_401_returns_boundary_failure_non_retryable", run.includes("retryable: response.status >= 500"));
check("malformed_json_returns_boundary_failure_no_product_fallback", run.includes('"malformed_json"') && boundary.includes("No Product fallback answer was generated."));
check("missing_answer_body_returns_boundary_failure_no_product_fallback", hermesFirst.includes('"missing_answer_body"') && !hermesFirst.includes("answer.content"));
check("invalid_side_effects_returns_boundary_failure_no_product_fallback", hermesFirst.includes('"invalid_side_effects"') && hermesFirst.includes("findForbiddenSideEffect"));
check("mismatched_response_ids_return_invalid_response_boundary_failure", hermesFirst.includes("responseFieldMismatch") && hermesFirst.includes("Hermes CMO chat response identifiers did not match the request") && hermesFirst.includes('"invalid_response"'));
check("unexpected_mode_returns_invalid_response_boundary_failure", hermesFirst.includes('payload.mode !== "cmo.chat"') && hermesFirst.includes("Hermes CMO chat returned an unexpected mode"));
check("unexpected_schema_version_returns_invalid_response_boundary_failure", hermesFirst.includes("payload.schema_version !== HERMES_FIRST_CMO_CHAT_RESPONSE_SCHEMA") && hermesFirst.includes("Hermes CMO chat returned an unexpected schema_version"));
check("boundary_failure_sets_fallback_used_false", boundary.includes("fallbackUsed: false") && hermesFirst.includes("fallback_used: input.fallbackUsed"));
check("boundary_failure_runtime_mode_stays_live", boundary.includes('runtimeMode: "live"') && boundary.includes('attemptedRuntimeMode: "live"'));
check("boundary_failure_sets_failed_boundary_status", boundary.includes('hermesCmoStatus: "failed_boundary"') && types.includes('"failed_boundary"'));
check("boundary_failure_sets_boundary_render_source", boundary.includes('productRenderSource: "hermes_cmo_boundary_failure"') && types.includes('"hermes_cmo_boundary_failure"'));
check("boundary_failure_does_not_call_fallback_runtime", !appBranch.includes("FallbackRuntime") && !appBranch.includes("getRuntimeRegistry"));
check("boundary_failure_does_not_call_run_hermes_cmo_runtime", !appBranch.includes("runHermesCmoRuntime"));
check("boundary_failure_does_not_call_execute_or_tool_execute", !hermesFirst.includes("/agents/cmo/tool-execute") && !hermesFirst.includes("/agents/cmo/execute"));
check("boundary_failure_persists_failed_assistant_message", appBranch.includes("status = mappedChat.status") && appStore.includes("messages: [") && appStore.includes("content: answer"));
check("hermes_first_branch_does_not_fall_through_to_legacy_execution", appStore.includes("if (!usedHermesCmoChat && shouldStartAsyncHermesCmoToolRun") && appStore.includes("if (!usedHermesCmoChat && hermesCmoChatV11Requested)") && appStore.includes("} else if (!usedHermesCmoChat && hermesCmoLegacyRequested)"));

if (process.exitCode) {
  process.exit(process.exitCode);
}

console.log(`cmo-hermes-first-boundary-failure-check: ${checks.length} checks passed`);
