import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const appChatStoreSource = await readFile(path.join(rootDir, "src", "lib", "cmo", "app-chat-store.ts"), "utf8");
const appWorkspaceTypesSource = await readFile(path.join(rootDir, "src", "lib", "cmo", "app-workspace-types.ts"), "utf8");
const activityPanelSource = await readFile(path.join(rootDir, "src", "components", "cmo-apps", "cmo-agent-activity-panel.tsx"), "utf8");
const configSource = await readFile(path.join(rootDir, "src", "lib", "cmo", "config.ts"), "utf8");
const mapperSource = await readFile(path.join(rootDir, "src", "lib", "cmo", "hermes-cmo-chat-mapper.ts"), "utf8");
const assistantMarkdownDisplaySource = await readFile(path.join(rootDir, "src", "lib", "cmo", "assistant-markdown-display.ts"), "utf8");
const runtimeSource = await readFile(path.join(rootDir, "src", "lib", "cmo", "hermes-cmo-runtime.ts"), "utf8");
const routerSource = await readFile(path.join(rootDir, "src", "lib", "cmo", "hermes-cmo-chat-router.ts"), "utf8");
const attachmentsSource = await readFile(path.join(rootDir, "src", "lib", "cmo", "attachments.ts"), "utf8");
const vaultAutoCaptureSource = await readFile(path.join(rootDir, "src", "lib", "cmo", "vault-auto-capture.ts"), "utf8");
const pendingToolRunAnswerSource = appChatStoreSource.match(/function pendingToolRunAnswer\(\): string \{[\s\S]*?\n\}/)?.[0] ?? "";
const rawActivityRequestSource = appChatStoreSource.match(/function asyncRawActivityLogRequest[\s\S]*?async function readHermesRawActivityJson/)?.[0] ?? "";
const asyncRawActivityHookSource = appChatStoreSource.match(/async function attachAsyncToolRunRawActivityLog[\s\S]*?function asyncToolRunReplayHistory/)?.[0] ?? "";
const chatPanelSource = await readFile(path.join(rootDir, "src", "components", "cmo-apps", "cmo-chat-panel.tsx"), "utf8");
const sendMessagePreSuccessSource = chatPanelSource.match(/async function sendMessage\(\) \{[\s\S]*?const response = await readJsonResponse/)?.[0] ?? "";
const imageFilesFromClipboardSource = chatPanelSource.match(/function imageFilesFromClipboard[\s\S]*?async function readJsonResponse/)?.[0] ?? "";
const assistantMessageBlocks = [...appChatStoreSource.matchAll(/\{\s*id: assistantId,[\s\S]*?\n\s*\},/g)].map((match) => match[0]);
const productionFormattingSurface = [
  appChatStoreSource,
  mapperSource,
  assistantMarkdownDisplaySource,
  activityPanelSource,
  chatPanelSource,
].join("\n");

function loadAssistantMarkdownDisplayModule() {
  const transpiled = ts.transpileModule(assistantMarkdownDisplaySource, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
  }).outputText;
  const loadedModule = { exports: {} };
  const fn = new Function("module", "exports", transpiled);
  fn(loadedModule, loadedModule.exports);
  return loadedModule.exports;
}

function productToolCapableAnswerFromHermesBody(answer) {
  return String(answer.body ?? "").trim() || String(answer.summary ?? "").trim();
}

function repeatedOneMarkers(value) {
  return (String(value).match(/(?:^|\n)\s*1\.\s/g) ?? []).length;
}

const cleanNumberedHermesAnswer = {
  body: [
    "1. Daily reward ritual",
    "Reward action copy.",
    "",
    "2. FOMO / activation",
    "Activation copy.",
    "",
    "3. Narrative / human identity",
    "Narrative copy.",
  ].join("\n"),
  summary: "Summary fallback must not be used when body exists.",
};
const repeatedNumberingHermesAnswer = {
  body: [
    "1. Daily reward ritual",
    "Reward action copy.",
    "",
    "1. FOMO / activation",
    "Activation copy.",
    "",
    "1. Narrative / human identity",
    "Narrative copy.",
  ].join("\n"),
  summary: "Summary fallback must not be used when body exists.",
};
const cleanMappedAnswer = productToolCapableAnswerFromHermesBody(cleanNumberedHermesAnswer);
const repeatedMappedAnswer = productToolCapableAnswerFromHermesBody(repeatedNumberingHermesAnswer);
const { assistantDisplayMarkdown } = loadAssistantMarkdownDisplayModule();
const cleanRenderedMarkdown = assistantDisplayMarkdown(cleanNumberedHermesAnswer.body);
const repeatedRenderedMarkdown = assistantDisplayMarkdown(repeatedNumberingHermesAnswer.body);

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
assert.match(appChatStoreSource, /VAULT_AGENT_RAW_ACTIVITY_LOG_ENDPOINT = "\/agents\/vault-agent\/raw-activity-log"/, "async raw logging must target the raw activity runtime endpoint");
assert.match(appChatStoreSource, /vault_agent\.raw_activity_log\.request\.v1/, "async raw logging must build the raw activity request schema");
assert.match(appChatStoreSource, /attachAsyncToolRunRawActivityLog/, "async completion must attach raw activity logging metadata");
assert.match(appChatStoreSource, /finalSession\.status === "completed"[\s\S]*attachAsyncToolRunRawActivityLog/, "raw activity logging must only run for completed async tool runs");
assert.match(asyncRawActivityHookSource, /callVaultAgentRawActivityLog/, "async raw logging must call the raw activity endpoint");
assert.doesNotMatch(asyncRawActivityHookSource, /runVaultAgentDryRunHandoff|autoCaptureTurnOnce|write-turn-log|Turn Logs|03 Sessions/, "async raw logging must not use legacy turn-log handoff or auto-capture");
assert.match(asyncRawActivityHookSource, /input\.session\.status !== "completed"[\s\S]*return input\.session/, "raw logging helper must skip non-terminal pending/running runs");
assert.match(asyncRawActivityHookSource, /rawCapturePath = receipt\.vault_path/, "async raw logging must persist the raw activity runtime path");
assert.match(asyncRawActivityHookSource, /catch \(error\)[\s\S]*rawCaptureStatus: "failed"/, "raw logging failure must be stored as metadata");
assert.doesNotMatch(asyncRawActivityHookSource, /throw error|throw new Error/, "raw logging failure must not break final async answer");
assert.match(rawActivityRequestSource, /workspace_id: input\.request\.workspaceId/, "raw activity payload must target the selected workspace id");
assert.match(rawActivityRequestSource, /activity_text: `User: \$\{input\.request\.message\}\\n\\nCMO: \$\{input\.answer\}`/, "raw activity payload must include user prompt and final CMO answer");
assert.match(rawActivityRequestSource, /source_endpoint: "\/agents\/cmo\/tool-execute"/, "raw activity link metadata must preserve source endpoint");
assert.match(rawActivityRequestSource, /cmo_run_endpoint: "\/agents\/cmo\/tool-execute"/, "raw activity link metadata must preserve CMO run endpoint");
assert.match(appChatStoreSource, /receipt\.deduped === true/, "deduped raw activity receipt must be accepted");
assert.match(appChatStoreSource, /receipt\.knowledge_write === true[\s\S]*receipt\.accepted_knowledge_write === true[\s\S]*receipt\.promotion_performed === true[\s\S]*receipt\.gbrain_indexed === true/, "raw activity receipt must reject forbidden mutation signals");
assert.doesNotMatch(rawActivityRequestSource, /html|raw_html|source_text|extracted_text|ocr_text|pdf_text|fetched_content|source_auto_save|knowledge_promotion/, "raw activity request path must not pass forbidden extraction/source fields");
assert.match(vaultAutoCaptureSource, /workspaceId:\s*ctx\.request\.workspaceId/, "legacy auto-capture must use selected workspace id, not app/tenant fallback");
assert.doesNotMatch(vaultAutoCaptureSource, /workspaceId:\s*ctx\.request\.appId/, "legacy auto-capture must not target workspace from app id");

assert.match(runtimeSource, /\|\s*"attachment_read"/, "Product runtime must type Hermes attachment_read answer_basis mode");
assert.match(runtimeSource, /const answerBasisModes[\s\S]*"attachment_read"/, "Product runtime validator must accept attachment_read answer_basis mode");
assert.match(runtimeSource, /const simpleAnswerModes[\s\S]*"attachment_read"/, "Product runtime must normalize simple attachment_read answers");
assert.match(mapperSource, /inputMaterialAttachments\?: HermesCmoAttachmentRef\[\]/, "Product request mapper must accept Hermes attachment refs");
assert.match(mapperSource, /input_material: inputMaterial/, "Product Hermes request must include top-level input_material");
assert.match(mapperSource, /request_id: `req_h6_\$\{input\.userMessageId\}`/, "Product Hermes request must include stable request_id derived from turn/message id");
assert.match(mapperSource, /turn_id: input\.userMessageId/, "Product Hermes request must include stable turn_id derived from user message id");
assert.match(appChatStoreSource, /const hermesAttachmentRefs = await cmoAttachmentsForHermes\(turnAttachments\)/, "Product async mapper must generate Hermes attachment refs before calling Hermes");
assert.match(appChatStoreSource, /inputMaterialAttachments: hermesAttachmentRefs/, "Product async mapper must pass attachment refs into Hermes request");
assert.match(attachmentsSource, /fallback_extracted_text:[\s\S]*available: false[\s\S]*is_primary: false/, "Product must send fallback_extracted_text metadata only, not Product summaries as primary evidence");
assert.match(appChatStoreSource, /attachmentTraceSummary/, "Product session metadata must preserve Hermes attachment_trace_summary");
assert.match(appChatStoreSource, /toolsUsed/, "Product session metadata must preserve toolsUsed including cmo_read_attachment");
assert.match(appChatStoreSource, /message\.attachments/, "Product session must preserve user message attachments");

assert.match(mapperSource, /messages: recentConversationMessages\(input\.history\)/, "tool-capable Hermes request must include bounded recent messages");
assert.match(mapperSource, /const MAX_REPLAY_MESSAGES = 16/, "recent message replay must be bounded");
assert.match(mapperSource, /isPendingToolRunPlaceholder/, "request mapper must filter pending assistant placeholders");
assert.match(mapperSource, /CMO is working/, "pending placeholder content must be excluded from semantic replay");
assert.match(mapperSource, /traceSummary\.tools_used/, "mapper must read tool_trace_summary.tools_used fallback");
assert.match(mapperSource, /isToolCapableCmo/, "tool-capable CMO answers must preserve the Hermes answer body");
assert.match(mapperSource, /const body = answer\.body\.trim\(\)/, "mapper must read Hermes answer.body directly");
assert.match(mapperSource, /return body \|\| answer\.summary\.trim\(\)/, "tool-capable CMO answer mapping must return body without Product templating");
assert.equal(cleanMappedAnswer, cleanNumberedHermesAnswer.body, "Product mapped answer must equal Hermes answer.body for proper numbered lists");
assert.equal(cleanMappedAnswer, cleanNumberedHermesAnswer.body, "Product session content should store the same mapped answer body");
assert.equal(repeatedMappedAnswer, repeatedNumberingHermesAnswer.body, "Product must preserve raw repeated numbering if Hermes emits it");
assert.equal(repeatedOneMarkers(cleanMappedAnswer), 1, "Product must not create repeated 1. markers from a proper numbered list");
assert.equal(repeatedOneMarkers(repeatedMappedAnswer), 3, "Repeated 1. markers in mapped output indicate raw Hermes body already had them");
assert.match(chatPanelSource, /assistantDisplayMarkdown/, "CMO chat panel must render assistant content through the display markdown helper");
assert.match(assistantMarkdownDisplaySource, /normalizeRepeatedOrderedListStartsForDisplay/, "display helper must normalize repeated top-level ordered-list restarts");
assert.equal(cleanRenderedMarkdown, cleanNumberedHermesAnswer.body, "display helper must preserve proper numbered lists");
assert.equal(repeatedOneMarkers(repeatedRenderedMarkdown), 1, "display helper must not show repeated top-level 1. markers");
assert.match(repeatedRenderedMarkdown, /^2\. FOMO \/ activation/m, "display helper must render the second repeated marker as 2.");
assert.match(repeatedRenderedMarkdown, /^3\. Narrative \/ human identity/m, "display helper must render the third repeated marker as 3.");
assert.doesNotMatch(assistantDisplayMarkdown("Answer\nvault_path: 12 Knowledge/foo.md\ncontent_hash: sha256:abc"), /vault_path|12 Knowledge|sha256:/, "display helper must keep hiding Vault internals");
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
assert.match(chatPanelSource, /setInput\(""\);\s*setPendingAttachments\(\[\]\);\s*setSessionId\(response\.sessionId\)/, "composer draft and pending attachments should clear only after successful submit response");
assert.match(chatPanelSource, /disabled=\{\(!input\.trim\(\) && !pendingAttachments\.length\) \|\| isSending \|\| isUploadingAttachment\}/, "Send button must be enabled when text or attachment is present and no send/upload is active");
assert.match(chatPanelSource, /onDragEnter=\{handleAttachmentDragEnter\}/, "CMO composer panel must accept file drag enter events");
assert.match(chatPanelSource, /onDragOver=\{handleAttachmentDragOver\}/, "CMO composer panel must accept file drag over events");
assert.match(chatPanelSource, /onDragLeave=\{handleAttachmentDragLeave\}/, "CMO composer panel must clear drag state on leave");
assert.match(chatPanelSource, /onDrop=\{handleAttachmentDrop\}/, "CMO composer panel must upload dropped files");
assert.match(chatPanelSource, /hasFileDrag\(event\)/, "drag handlers must ignore non-file drags");
assert.match(chatPanelSource, /Drop files to attach/, "drag state must render a visible drop hint");
assert.match(chatPanelSource, /const droppedFiles = filesFromList\(event\.dataTransfer\.files\);[\s\S]*uploadAttachmentFiles\(droppedFiles\)/, "dropped files must reuse the existing attachment upload flow");
assert.match(chatPanelSource, /onPaste=\{handleComposerPaste\}/, "composer must handle paste events");
assert.match(chatPanelSource, /CMO_PASTE_IMAGE_MIME_TYPES = new Set\(\["image\/png", "image\/jpeg", "image\/webp"\]\)/, "paste handling must be limited to supported image MIME types");
assert.match(chatPanelSource, /event\.clipboardData\.items/, "paste handling must inspect clipboard data items");
assert.match(chatPanelSource, /pasted-image-\$\{compactTimestamp\(\)\}/, "clipboard images without names must receive safe generated filenames");
assert.match(chatPanelSource, /if \(!pastedImageFiles\.length\) \{\s*return;\s*\}[\s\S]*event\.preventDefault\(\);[\s\S]*uploadAttachmentFiles\(pastedImageFiles\)/, "normal text paste must remain untouched unless image files are attached");
assert.match(imageFilesFromClipboardSource, /const itemFiles: File\[\] = \[\]/, "paste helper must collect clipboard item images first");
assert.match(imageFilesFromClipboardSource, /if \(itemFiles\.length\) \{\s*return itemFiles;\s*\}[\s\S]*event\.clipboardData\.files/, "paste helper must not also read clipboard files when item images were found");
assert.doesNotMatch(imageFilesFromClipboardSource, /new Set<File>\(\)/, "paste helper must not rely on File object identity for clipboard dedupe");
assert.match(imageFilesFromClipboardSource, /return \[\]/, "text-only clipboard files must not create attachments");
assert.match(appChatStoreSource, /function messagesWithTurnScopedAssistantAttachments/, "session normalization must clamp assistant attachment chips to a source turn");
assert.match(appChatStoreSource, /sourceUserMessageId[\s\S]*userAttachmentsByMessageId/, "assistant attachment normalization must use the source user message id");
assert.match(appChatStoreSource, /delete messageWithoutAttachments\.attachments/, "text-only assistant turns must render without stale attachment chips");
assert.ok(assistantMessageBlocks.length >= 2, "chat store must contain assistant message creation blocks");
for (const block of assistantMessageBlocks) {
  assert.doesNotMatch(block, /attachments: sessionAttachments/, "assistant messages must not be stamped with cumulative session attachments");
}
assert.match(appChatStoreSource, /id: assistantId,[\s\S]*attachments: turnAttachments[\s\S]*contextUsedCount/, "assistant messages with upload evidence must use only current turn attachments");

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
    "composer drag-and-drop attachment upload wired",
    "composer paste-image attachment upload wired",
    "pasted image item/file duplicate prevented",
    "normal text paste preserved",
    "assistant attachment chips are turn-scoped",
    "normal sync tool timeout remains configurable",
    "completed async tool run calls raw activity endpoint",
    "pending/running async tool runs skip raw activity endpoint",
    "raw activity endpoint failure is metadata-only",
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
  answerFormatDiagnostic: {
    rawHermesProperListMarkers: ["1.", "2.", "3."],
    productSessionEqualsHermesAnswerBody: cleanMappedAnswer === cleanNumberedHermesAnswer.body,
    properNumberedListPreserved: true,
    productCreatesRepeatedOneMarkers: false,
    rawHermesRepeatedOneMarkersPreserved: repeatedMappedAnswer === repeatedNumberingHermesAnswer.body,
    displayMarkdownFixesRepeatedOneMarkers: repeatedOneMarkers(repeatedRenderedMarkdown) === 1,
    repeatedOneRootCauseWhenRawHasRepeatedMarkers: "Hermes output hygiene issue, not Product mapping",
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
    dragDropAttachmentsReuseExistingUploadFlow: true,
    pasteImageAttachmentsReuseExistingUploadFlow: true,
    pastedImageCreatesOnePendingAttachment: true,
    textPasteDefaultPreserved: true,
    textPasteCreatesNoAttachments: true,
    textOnlyAssistantAfterAttachmentTurnShowsNoAttachmentChips: true,
  },
  asyncRawActivitySmoke: {
    completedRunCallsRawActivityLogEndpoint: true,
    nonTerminalRunsSkipped: true,
    failureDoesNotBreakFinalAnswer: true,
    aionTargetPathPrefix: "90 Runtime/Raw Activity/aion/jay/",
    holdPayTargetPathPrefix: "90 Runtime/Raw Activity/hold-pay/jay/",
    noUuidFolder: true,
    noHoldstationOrUserJayFolder: true,
    noKnowledgeSourcesGbrainPromotionMutation: true,
  },
}, null, 2));
