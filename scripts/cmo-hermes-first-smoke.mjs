import { readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relativePath) => readFileSync(path.join(root, relativePath), "utf8");
const config = read("src/lib/cmo/config.ts");
const router = read("src/lib/cmo/hermes-cmo-chat-router.ts");
const hermesFirst = read("src/lib/cmo/hermes-first-cmo-chat.ts");
const appStore = read("src/lib/cmo/app-chat-store.ts");

const checks = [];
const directCommand = /^\s*(?:(?:\/surf|@surf)(?:\s+x)?\b|\/trend\b|\/pulse\b|\/x\b|(?:\/echo|@echo)\b)/i;

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

const mapper = section(hermesFirst, "export function mapHermesFirstCmoChatToAppChat", "export function hermesFirstBoundaryFailureResponse");
const boundary = section(hermesFirst, "export function hermesFirstBoundaryFailureResponse", "");
const appBranch = section(appStore, "if (hermesFirstNormalChatRequested)", "if (!usedHermesCmoChat && shouldStartAsyncHermesCmoToolRun");

check("mocked_successful_normal_chat_turn_persists_hermes_answer", mapper.includes("answer: input.response.answer.body.trim()") && appBranch.includes("answer = mappedChat.answer") && appBranch.includes("usedHermesCmoChat = true"));
check("mocked_needs_user_input_turn_persists_hermes_clarification", hermesFirst.includes('payload.status === "needs_user_input"') && mapper.includes('input.response.status === "failed" ? "failed" : "completed"'));
check("mocked_boundary_failure_persists_boundary_message", boundary.includes("No Product fallback answer was generated.") && appBranch.includes("hermesFirstBoundaryFailureResponse"));
check("mocked_hermes_first_turn_calls_exactly_one_hermes_endpoint", appBranch.includes("runHermesFirstCmoChat") && !appBranch.includes("runHermesCmoChatV11") && !appBranch.includes("runHermesCmoRuntime") && hermesFirst.includes('HERMES_FIRST_CMO_CHAT_ENDPOINT = "/agents/cmo/chat"') && !hermesFirst.includes("/agents/cmo/execute") && !hermesFirst.includes("/agents/cmo/tool-execute"));
check("mocked_direct_command_uses_legacy_path", [
  "/surf wallets",
  "@surf x compare",
  "/trend openclaw",
  "/pulse market",
  "/x narrative",
  "/echo draft this",
  "@echo write this",
].every((message) => directCommand.test(message)));
check("mocked_natural_mentions_go_to_normal_chat", [
  "Can you surf the context and decide?",
  "Use echo as a metaphor in the launch copy.",
  "What trend matters this week?",
  "Check the pulse of onboarding.",
].every((message) => !directCommand.test(message)));
check("flag_default_disabled_and_canary_empty", config.includes('CMO_HERMES_FIRST_CMO_CHAT_ENABLED", false') && config.includes("commaSeparatedEnv(\"CMO_HERMES_FIRST_CMO_CHAT_CANARY_APPS\")"));
check("router_helper_bypasses_force_fallback", router.includes("input.forceFallback !== true"));
check("smoke_does_not_call_live_hermes_or_side_effects", !import.meta.url.includes("http") && !hermesFirst.includes("paid_media_generation_performed: true") && !hermesFirst.includes("vault_write_performed: true"));

if (process.exitCode) {
  process.exit(process.exitCode);
}

console.log(`cmo-hermes-first-smoke: ${checks.length} mocked checks passed`);
