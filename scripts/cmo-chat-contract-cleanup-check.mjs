import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relativePath) => readFileSync(path.join(root, relativePath), "utf8");

const types = read("src/lib/cmo/app-workspace-types.ts");
const appStore = read("src/lib/cmo/app-chat-store.ts");
const hermesFirst = read("src/lib/cmo/hermes-first-cmo-chat.ts");
const chatPanel = read("src/components/cmo-apps/cmo-chat-panel.tsx");

const checks = [];

function check(name, condition, detail = "") {
  try {
    assert.ok(condition, detail || name);
    checks.push(name);
    console.log(`ok ${name}`);
  } catch {
    console.error(`not ok ${name}${detail ? ` - ${detail}` : ""}`);
    process.exitCode = 1;
  }
}

function section(source, start, end) {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  return startIndex >= 0 && endIndex > startIndex ? source.slice(startIndex, endIndex) : "";
}

function count(source, token) {
  return source.split(token).length - 1;
}

const sessionType = section(types, "export interface CMOChatSession", "export interface CMOAppChatResponse");
const messageType = section(types, "export interface CMOChatMessage", "export interface CMOChatSession");
const responseType = section(types, "export interface CMOAppChatResponse", "export interface RawCaptureRequest");
const normalizeRequest = section(appStore, "function normalizeAppChatRequest", "function normalizeRuntimeStatus");
const normalizeSession = section(appStore, "function normalizeSession", "export async function createAppChatSession");
const createAppChatSession = section(appStore, "export async function createAppChatSession", "export async function readAppChatSession");
const hermesResponseType = section(hermesFirst, "export interface HermesFirstCmoChatResponse", "export interface HermesFirstBoundaryFailure");
const hermesMappedType = section(hermesFirst, "export interface HermesFirstMappedAppChat", "const MAX_HISTORY_MESSAGES");
const hermesResponseNormalizer = section(hermesFirst, "export function normalizeHermesFirstCmoChatResponse", "function responsePreview");
const hermesMapper = section(hermesFirst, "export function mapHermesFirstCmoChatToAppChat", "export function hermesFirstBoundaryFailureResponse");
const hermesRequestBuilder = section(hermesFirst, "export function buildHermesFirstCmoChatRequest", "function missingAnswerBody");
const contextStatusLabel = section(chatPanel, "function workspaceContextStatusLabel", "function runtimeExplanation");
const runtimeExplanation = section(chatPanel, "function runtimeExplanation", "function assistantProvenance");
const assistantProvenance = section(chatPanel, "function assistantProvenance", "function renderAssistantContent");
const sendStatus = section(chatPanel, "const responseWorkspaceContextUsed", "setMessages((current)");

check("chat_session_type_includes_workspace_and_snake_case_ids",
  sessionType.includes("appId: string;") &&
  sessionType.includes("app_id: string;") &&
  sessionType.includes("workspaceId: string;") &&
  sessionType.includes("workspace_id: string;"));
check("chat_message_session_and_response_types_include_vault_context_usage",
  messageType.includes("vault_context_usage?: unknown;") &&
  sessionType.includes("vault_context_usage?: unknown;") &&
  responseType.includes("vault_context_usage?: unknown;"));
check("app_chat_request_accepts_camel_and_snake_case_ids",
  normalizeRequest.includes("const appId = stringValue(body.appId ?? body.app_id);") &&
  normalizeRequest.includes("const requestedWorkspaceId = stringValue(body.workspaceId ?? body.workspace_id);"));
check("session_normalization_is_backward_compatible_for_id_fields",
  normalizeSession.includes("const appId = stringValue(value.appId ?? value.app_id);") &&
  normalizeSession.includes("stringValue(value.workspaceId) || stringValue(value.workspace_id)") &&
  normalizeSession.includes("app_id,") &&
  normalizeSession.includes("workspaceId,") &&
  normalizeSession.includes("workspace_id: workspaceId,"));
check("created_app_chat_sessions_persist_all_id_fields",
  count(createAppChatSession, "appId: request.appId") >= 3 &&
  count(createAppChatSession, "app_id: request.appId") >= 3 &&
  count(createAppChatSession, "workspaceId: request.workspaceId") >= 3 &&
  count(createAppChatSession, "workspace_id: request.workspaceId") >= 3);

check("hermes_first_response_type_preserves_top_level_vault_context_usage",
  hermesResponseType.includes("vault_context_usage?: unknown;") &&
  hermesResponseNormalizer.includes("payload.vault_context_usage !== undefined") &&
  hermesResponseNormalizer.includes("vault_context_usage: payload.vault_context_usage"));
check("hermes_first_mapper_preserves_vault_context_usage_in_metadata_and_mapped_response",
  hermesMappedType.includes("vault_context_usage?: unknown;") &&
  count(hermesMapper, "vault_context_usage: input.response.vault_context_usage") >= 2);
check("assistant_message_and_response_persist_vault_context_usage",
  appStore.includes("function vaultContextUsageFromMetadata") &&
  createAppChatSession.includes("const completedVaultContextUsage = vaultContextUsageFromMetadata(completedMetadata);") &&
  count(createAppChatSession, "vault_context_usage: completedVaultContextUsage") >= 3 &&
  createAppChatSession.includes("const vaultContextUsage = vaultContextUsageFromMetadata(hermesCmoMetadata);") &&
  count(createAppChatSession, "vault_context_usage: vaultContextUsage") >= 2 &&
  createAppChatSession.includes("const responseVaultContextUsage = vaultContextUsageFromMetadata(hermesCmoMetadata) ?? persistedSession.vault_context_usage;"));

check("completed_vault_agent_context_pack_is_sent_to_hermes_chat_payload",
  hermesRequestBuilder.includes("vault_context: input.vaultContext ?? null") &&
  count(createAppChatSession, "vaultContext: contextPackage.contextPack.vaultAgentContextPack ?? null") >= 1 &&
  hermesFirst.includes('HERMES_FIRST_CMO_CHAT_ENDPOINT = "/agents/cmo/chat"'));
check("footer_status_uses_vault_context_usage_before_context_pack_availability",
  chatPanel.includes("function vaultContextUsageWasUsed") &&
  chatPanel.includes('value.used !== true') &&
  chatPanel.includes('"items_count"') &&
  contextStatusLabel.indexOf("vaultContextUsageWasUsed") >= 0 &&
  contextStatusLabel.indexOf("vaultAgentContextPackAvailable") > contextStatusLabel.indexOf("vaultContextUsageWasUsed") &&
  runtimeExplanation.indexOf("vaultContextUsageWasUsed") >= 0 &&
  runtimeExplanation.indexOf("vaultAgentContextPackAvailable") > runtimeExplanation.indexOf("vaultContextUsageWasUsed"));
check("context_pack_available_wording_does_not_claim_usage",
  contextStatusLabel.includes('return "Workspace context available";') &&
  runtimeExplanation.includes('return "Workspace context is available for this answer.";') &&
  assistantProvenance.includes('return "CMO Hermes - workspace context available";') &&
  assistantProvenance.includes('return message.runtimeMode === "live" ? "CMO Hermes" : "CMO fallback answer";'));
check("send_status_uses_response_vault_context_usage_before_claiming_usage",
  sendStatus.includes("const responseWorkspaceContextUsed = vaultContextUsageWasUsed(response.vault_context_usage ?? response.hermesCmoMetadata?.vault_context_usage);") &&
  sendStatus.includes("responseWorkspaceContextUsed") &&
  sendStatus.includes("Workspace context usage was not confirmed."));
check("old_runtime_flag_only_workspace_context_enabled_copy_is_absent",
  !chatPanel.includes("Using approved workspace context.") &&
  !chatPanel.includes("workspace context enabled") &&
  !chatPanel.includes("Workspace context answer"));

if (process.exitCode) {
  process.exit(process.exitCode);
}

console.log(`cmo-chat-contract-cleanup-check: ${checks.length} checks passed`);
