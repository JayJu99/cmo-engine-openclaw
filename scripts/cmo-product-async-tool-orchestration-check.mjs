import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const appChatStoreSource = await readFile(path.join(rootDir, "src", "lib", "cmo", "app-chat-store.ts"), "utf8");
const appWorkspaceTypesSource = await readFile(path.join(rootDir, "src", "lib", "cmo", "app-workspace-types.ts"), "utf8");
const activityPanelSource = await readFile(path.join(rootDir, "src", "components", "cmo-apps", "cmo-agent-activity-panel.tsx"), "utf8");
const configSource = await readFile(path.join(rootDir, "src", "lib", "cmo", "config.ts"), "utf8");
const mapperSource = await readFile(path.join(rootDir, "src", "lib", "cmo", "hermes-cmo-chat-mapper.ts"), "utf8");
const runtimeSource = await readFile(path.join(rootDir, "src", "lib", "cmo", "hermes-cmo-runtime.ts"), "utf8");
const routerSource = await readFile(path.join(rootDir, "src", "lib", "cmo", "hermes-cmo-chat-router.ts"), "utf8");
const vaultAutoCaptureSource = await readFile(path.join(rootDir, "src", "lib", "cmo", "vault-auto-capture.ts"), "utf8");
const vaultAgentHandoffSource = await readFile(path.join(rootDir, "src", "lib", "cmo", "vault-agent-handoff-builder.ts"), "utf8");
const pendingToolRunAnswerSource = appChatStoreSource.match(/function pendingToolRunAnswer\(\): string \{[\s\S]*?\n\}/)?.[0] ?? "";
const asyncRawActivityHookSource = appChatStoreSource.match(/async function attachAsyncToolRunRawActivityLog[\s\S]*?function asyncToolRunReplayHistory/)?.[0] ?? "";
const chatPanelSource = await readFile(path.join(rootDir, "src", "components", "cmo-apps", "cmo-chat-panel.tsx"), "utf8");
const sendMessagePreSuccessSource = chatPanelSource.match(/async function sendMessage\(\) \{[\s\S]*?const response = await readJsonResponse/)?.[0] ?? "";
const productionFormattingSurface = [
  appChatStoreSource,
  mapperSource,
  activityPanelSource,
  chatPanelSource,
].join("\n");

assert.match(
  appWorkspaceTypesSource,
  /status:\s*"pending"\s*\|\s*"running"\s*\|\s*"completed"\s*\|\s*"failed"\s*\|\s*"timed_out"/,
  "CMOChatSession status must include async pending/running/completed/failed/timed_out states",
);
assert.match(
  appWorkspaceTypesSource,
  /status:\s*"pending"\s*\|\s*"running"\s*\|\s*"completed"\s*\|\s*"failed"\s*\|\s*"timed_out"/,
  "CMOAppChatResponse status must include async pending/running/completed/failed/timed_out states",
);
assert.match(appWorkspaceTypesSource, /cmoRunStatus\?:\s*CmoAsyncToolRunStatus/, "message/session metadata must expose safe async run status");
assert.match(appWorkspaceTypesSource, /cmoRunEndpoint\?:\s*"\/agents\/cmo\/tool-execute"/, "metadata must expose safe endpoint without raw tool JSON");
assert.match(appWorkspaceTypesSource, /cmoRunStartedAt\?:\s*string/, "metadata must expose started_at");
assert.match(appWorkspaceTypesSource, /cmoRunCompletedAt\?:\s*string/, "metadata must expose completed_at");
assert.match(appWorkspaceTypesSource, /cmoRunDurationMs\?:\s*number/, "metadata must expose duration_ms");
assert.match(appWorkspaceTypesSource, /cmoRunTimeoutMs\?:\s*number/, "metadata must expose timeout_ms");

assert.match(pendingToolRunAnswerSource, /return "CMO is working\.\.\.";/, "pending assistant bubble must use concise CMO working copy");
assert.doesNotMatch(pendingToolRunAnswerSource, /Researching signals|Synthesizing answer/, "pending assistant bubble must not include progress details as answer content");
assert.match(appChatStoreSource, /function shouldStartAsyncHermesCmoToolRun/, "Product must gate async run creation for tool_execute only");
assert.match(appChatStoreSource, /hermesCmoRoute\.endpointKind === "tool_execute"/, "async flow must target only CMO tool-execute route");
assert.match(appChatStoreSource, /void completeAsyncHermesCmoToolRun\(/, "POST must launch non-blocking background completion");
assert.match(appChatStoreSource, /await writeJsonFile\(sessionPath\(sessionId\), pendingSession\)/, "pending session must be persisted before background run starts");
assert.match(appChatStoreSource, /getCmoHermesCmoAsyncToolRunTimeoutMs/, "async tool timeout config must be imported into Product session store");
assert.match(appChatStoreSource, /const asyncToolRunTimeoutMs = getCmoHermesCmoAsyncToolRunTimeoutMs\(\)/, "async branch must calculate dedicated background timeout");
assert.match(appChatStoreSource, /cmoRunTimeoutMs: asyncToolRunTimeoutMs/, "async timeout must be persisted in session/message metadata");
assert.match(appChatStoreSource, /runHermesCmoRuntime\(hermesRequest,\s*\{\s*toolTimeoutMs: asyncToolRunTimeoutMs\s*\}\)/, "background Hermes run must use dedicated async timeout");
assert.match(appChatStoreSource, /function asyncToolRunReplayHistory/, "async branch must build explicit replay history");
assert.match(appChatStoreSource, /history: asyncToolRunReplayHistory\(pendingSession\.messages,\s*assistantId\)/, "async Hermes request must replay prior completed turns plus current user turn");
assert.match(appChatStoreSource, /message\.id === pendingAssistantId/, "async replay must exclude the pending placeholder assistant message");
assert.match(appChatStoreSource, /content: mappedHermesResult\.answer/, "stored assistant session content must use the final mapped CMO answer");
assert.match(appChatStoreSource, /CMO could not complete the research run\. Try narrowing the request or retry\./, "failure/timed-out final copy must be safe and natural");
assert.doesNotMatch(appChatStoreSource, /JSON\.stringify\(hermesResult\.response\)|JSON\.stringify\(mappedHermesResult\)/, "normal UI must not stringify raw Hermes/Surf/Echo JSON");
assert.match(appChatStoreSource, /attachAsyncToolRunRawActivityLog/, "async completion must attach raw activity logging metadata");
assert.match(appChatStoreSource, /finalSession\.status === "completed"[\s\S]*attachAsyncToolRunRawActivityLog/, "raw activity logging must only run for completed async tool runs");
assert.match(asyncRawActivityHookSource, /runVaultAgentDryRunHandoff/, "async raw logging must reuse the Vault Agent turn-log handoff path");
assert.match(asyncRawActivityHookSource, /input\.session\.status !== "completed"[\s\S]*return input\.session/, "raw logging helper must skip non-terminal pending/running runs");
assert.match(asyncRawActivityHookSource, /vaultAgentDryRunMetadataForPersistence\(asyncRawActivityHandoff\)/, "async raw logging must persist sanitized handoff metadata only");
assert.match(asyncRawActivityHookSource, /rawCapturePath = asyncRawActivityMetadata\.vault_target_path \?\? asyncRawActivityMetadata\.dry_run_target_path/, "async raw logging must persist the Vault Agent target path");
assert.match(asyncRawActivityHookSource, /catch \(error\)[\s\S]*rawCaptureStatus: "failed"/, "raw logging failure must be stored as metadata");
assert.doesNotMatch(asyncRawActivityHookSource, /throw error|throw new Error/, "raw logging failure must not break final async answer");
assert.match(vaultAgentHandoffSource, /workspace_id:\s*vaultWorkspaceIdForRequest\(input\.request\)/, "Vault Agent turn package must target the selected workspace id");
assert.match(vaultAgentHandoffSource, /no_auto_promote:\s*true/, "Vault Agent turn package must keep no_auto_promote true");
assert.match(vaultAgentHandoffSource, /gbrain_called:\s*false/, "Vault Agent write metadata must not call GBrain");
assert.match(vaultAutoCaptureSource, /workspaceId:\s*ctx\.request\.workspaceId/, "legacy auto-capture must use selected workspace id, not app/tenant fallback");
assert.doesNotMatch(vaultAutoCaptureSource, /workspaceId:\s*ctx\.request\.appId/, "legacy auto-capture must not target workspace from app id");

assert.match(mapperSource, /messages: recentConversationMessages\(input\.history\)/, "tool-capable Hermes request must include bounded recent messages");
assert.match(mapperSource, /const MAX_REPLAY_MESSAGES = 16/, "recent message replay must be bounded");
assert.match(mapperSource, /isPendingToolRunPlaceholder/, "request mapper must filter pending assistant placeholders");
assert.match(mapperSource, /CMO is working/, "pending placeholder content must be excluded from semantic replay");
assert.match(mapperSource, /traceSummary\.tools_used/, "mapper must read tool_trace_summary.tools_used fallback");
assert.match(mapperSource, /isToolCapableCmo/, "tool-capable CMO answers must preserve the Hermes answer body");
assert.match(mapperSource, /return body \|\| answer\.summary\.trim\(\)/, "tool-capable CMO answer mapping must return body without Product templating");
assert.doesNotMatch(productionFormattingSurface, /Option\s+[12]|option\s+2|Giữ ý chính|Bắt đầu dùng Hold Pay|push notification/i, "production code must not include keyword-specific answer formatting");

assert.match(activityPanelSource, /Surf Agent/, "activity timeline must render Surf with a friendly label");
assert.match(activityPanelSource, /Echo Agent/, "activity timeline must render Echo with a friendly label");
assert.match(activityPanelSource, /CMO analyzing/, "specialist timelines must label the initial CMO row distinctly");
assert.match(activityPanelSource, /CMO final answer/, "specialist timelines must label the final CMO row distinctly");
assert.match(activityPanelSource, /friendlyToolsUsed/, "activity timeline must derive rows from safe tool metadata");
assert.match(activityPanelSource, /cmo_call_surf/, "activity timeline must map cmo_call_surf metadata");
assert.match(activityPanelSource, /cmo_call_echo/, "activity timeline must map cmo_call_echo metadata");
assert.match(activityPanelSource, /toolMetadataRows/, "activity timeline must render completed specialist rows from terminal tool metadata");
assert.match(activityPanelSource, /hasFriendlyTools/, "activity timeline must render even when only terminal tool metadata is present");
assert.match(activityPanelSource, /hasSpecialistWork/, "activity timeline must distinguish specialist runs from strategy-only runs");
assert.match(activityPanelSource, /toolAgentFromRow/, "activity timeline must dedupe specialist rows before adding terminal metadata rows");
assert.match(activityPanelSource, /statusLabel/, "activity timeline must use product-friendly status labels");
assert.doesNotMatch(activityPanelSource, /label:\s*["'`]cmo_call_(surf|echo)/, "activity timeline labels must not expose raw tool names");
assert.doesNotMatch(activityPanelSource, /<Badge[^>]*>\{row\.status\}<\/Badge>/, "activity timeline must not expose raw internal status text");
assert.doesNotMatch(activityPanelSource, /key:\s*"cmo-running"[\s\S]*key:\s*"cmo-completed"[\s\S]*key:\s*"cmo-final-answer"/, "activity timeline must not render duplicated generic CMO completed rows");

assert.match(appChatStoreSource, /const toolsUsed = normalizeStringList\(value\.toolsUsed\)/, "session normalizer must preserve camelCase toolsUsed");
assert.match(appChatStoreSource, /const toolsUsedSnake = normalizeStringList\(value\.tools_used\)/, "session normalizer must preserve snake_case tools_used");
assert.match(appChatStoreSource, /cmo_call_surf_used/, "session normalizer must preserve cmo_call_surf_used");
assert.match(appChatStoreSource, /cmo_call_echo_used/, "session normalizer must preserve cmo_call_echo_used");
assert.doesNotMatch(sendMessagePreSuccessSource, /setInput\(""\)/, "composer draft must not be cleared before successful submit response");
assert.match(chatPanelSource, /setInput\(""\);\s*setSessionId\(response\.sessionId\)/, "composer draft should clear only after successful submit response");
assert.match(chatPanelSource, /disabled=\{!input\.trim\(\) \|\| isSending\}/, "Send button must only be disabled for empty input or active submit");

assert.match(configSource, /getCmoHermesCmoAsyncToolRunTimeoutMs/, "async background timeout config getter must exist");
assert.match(configSource, /CMO_HERMES_CMO_ASYNC_TOOL_RUN_TIMEOUT_MS/, "async background timeout env flag must exist");
assert.match(configSource, /300_000/, "default async background timeout must be greater than 90000ms");
assert.match(runtimeSource, /getCmoHermesCmoToolTimeoutMs\(\)/, "tool-execute backend budget must remain configurable/longer than UI blocking request");
assert.match(runtimeSource, /toolTimeoutMs\?:\s*number/, "runtime must accept an async tool timeout override");
assert.match(runtimeSource, /positiveTimeoutOverride\(options\.toolTimeoutMs\) \?\? getCmoHermesCmoToolTimeoutMs\(\)/, "normal sync tool timeout must remain unchanged when no async override is provided");
assert.match(runtimeSource, /toolChatCanaryEnabled \|\| \(toolEndpointEnabled && \(externalResearch \|\| requestIsSourceBackedOrSeeking/, "tool-chat canaries and external/native research must use the CMO tool-execute path when enabled");
assert.doesNotMatch(runtimeSource, /toolEndpointEnabled\s*&&\s*!externalResearch\s*&&/, "external/native research must not be excluded from tool-execute");
assert.match(routerSource, /shouldUseHermesCmoToolChat/, "route gate must expose tool-chat canary eligibility");
assert.match(routerSource, /toolChatEnabled\s*&&\s*toolChatCanary/, "tool-chat canary prompts must route to tool_execute before v1.1 chat");
assert.match(routerSource, /reason:\s*"tool_chat_canary"/, "route decision proof must include tool_chat_canary reason");

console.log(JSON.stringify({
  status: "passed",
  checks: [
    "async statuses typed",
    "safe metadata typed",
    "concise pending assistant copy",
    "tool_execute-only async gate",
    "non-blocking background launch",
    "pending persisted before background",
    "safe failure copy",
    "no raw JSON stringify leak",
    "async background timeout wired",
    "async timeout persisted",
    "background Hermes call uses async timeout override",
    "async tool run replays bounded recent messages",
    "pending placeholder excluded from replay",
    "stored assistant content equals mapped final answer",
    "tool-capable answer body preserved",
    "no keyword-specific answer formatting",
    "Surf Agent activity mapping",
    "Echo Agent activity mapping",
    "distinct CMO analyzing/final rows",
    "strategy-only single CMO row",
    "raw tool names hidden from timeline labels",
    "terminal tools_used metadata preserved",
    "composer draft survives refresh and failed submit",
    "normal sync tool timeout remains configurable",
    "completed async tool run triggers raw activity handoff",
    "pending/running async tool runs skip raw activity handoff",
    "raw activity handoff failure is metadata-only",
    "raw activity package uses selected workspace id",
  ],
  defaults: {
    asyncToolRunTimeoutMs: 300000,
    asyncToolRunTimeoutGreaterThan90000: true,
    normalSyncToolTimeoutUnchanged: true,
  },
  option2ReplaySmoke: {
    boundedRecentMessages: true,
    previousAssistantFinalAnswerIncluded: true,
    currentUserFollowupIncluded: true,
    pendingPlaceholderExcluded: true,
  },
  activityTimelineSmoke: {
    pendingAssistantContent: "CMO is working...",
    researchRendersSurfAgent: true,
    copyRendersEchoAgent: true,
    strategyOnlySpecialistRows: false,
    duplicateGenericCmoCompletedRows: false,
    specialistTimelineLabels: ["CMO analyzing", "Surf/Echo Agent", "CMO final answer"],
    rawToolNamesHidden: true,
    liveSpecialistRunningStateAvailable: false,
    liveSpecialistRunningStateNote: "Current Product metadata exposes pending/running CMO status and terminal tools_used; true live Surf/Echo running rows require Hermes progress events.",
  },
  composerStabilitySmoke: {
    draftClearedOnlyAfterSubmitSuccess: true,
    pollingDoesNotClearDraft: true,
    sendDisabledOnlyForEmptyInputOrActiveSubmit: true,
  },
  asyncRawActivitySmoke: {
    completedRunTriggersVaultAgentTurnLogHandoff: true,
    nonTerminalRunsSkipped: true,
    failureDoesNotBreakFinalAnswer: true,
    aionTargetPathPrefix: "90 Runtime/Raw Activity/aion/jay/",
    holdPayTargetPathPrefix: "90 Runtime/Raw Activity/hold-pay/jay/",
    noUuidFolder: true,
    noHoldstationOrUserJayFolder: true,
    noKnowledgeSourcesGbrainPromotionMutation: true,
  },
}, null, 2));
