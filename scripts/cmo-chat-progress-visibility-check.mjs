import assert from "assert/strict";
import { readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relativePath) => readFileSync(path.join(root, relativePath), "utf8");

const chatPanel = read("src/components/cmo-apps/cmo-chat-panel.tsx");
const activityPanel = read("src/components/cmo-apps/cmo-agent-activity-panel.tsx");
const chatRoute = read("src/app/api/cmo/chat/route.ts");
const sessionsRoute = read("src/app/api/apps/[appId]/sessions/route.ts");
const appChatStore = read("src/lib/cmo/app-chat-store.ts");
const activityEvents = read("src/lib/cmo/activity-events.ts");

const checks = [];

function check(name, fn) {
  try {
    fn();
    checks.push(name);
    console.log(`ok ${name}`);
  } catch (error) {
    console.error(`not ok ${name}`);
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

function indexOfOrThrow(source, needle) {
  const index = source.indexOf(needle);

  assert.notEqual(index, -1, `missing ${needle}`);

  return index;
}

check("app_chat_route_uses_product_session_store", () => {
  assert.match(chatRoute, /createAppChatSession\(body, userIdentity/);
  assert.match(chatRoute, /readAppChatSessions\(limitFromRequest\(request\), appId\)/);
  assert.match(sessionsRoute, /readAppChatSessions\(limit, app\.id\)/);
});

check("product_polling_is_session_polling_not_sse", () => {
  assert.match(chatPanel, /CMO_ASYNC_POLL_INTERVAL_MS\s*=\s*3_000/);
  assert.match(chatPanel, /fetch\(`\/api\/apps\/\$\{app\.id\}\/sessions\?limit=20`/);
  assert.doesNotMatch(chatPanel, /EventSource|text\/event-stream|ReadableStream/);
  assert.doesNotMatch(chatRoute, /EventSource|text\/event-stream|ReadableStream/);
});

check("backend_persists_real_product_lifecycle_events", () => {
  assert.match(activityEvents, /product\.chat_run/);
  assert.match(appChatStore, /status:\s*"queued"/);
  assert.match(appChatStore, /status:\s*"running"/);
  assert.match(appChatStore, /status:\s*"completed"/);
  assert.match(appChatStore, /status:\s*runStatus/);
  assert.match(appChatStore, /status:\s*"cancelled"/);
});

check("activity_panel_prefers_real_lifecycle_events_over_loading_fallback", () => {
  assert.match(activityPanel, /function lifecycleRows/);
  assert.match(activityPanel, /startsWith\("product\.chat_run\."\)/);
  assert.match(activityPanel, /running && lifecycle\.length === 0 && events\.length === 0/);
  assert.match(activityPanel, /rows\.push\(\.\.\.lifecycle\)/);
});

check("activity_panel_does_not_fake_specialist_realtime_from_loading_state", () => {
  const optimisticBlockStart = indexOfOrThrow(activityPanel, 'key: "optimistic-cmo-running"');
  const optimisticBlockEnd = activityPanel.indexOf("];", optimisticBlockStart);
  const optimisticBlock = activityPanel.slice(optimisticBlockStart, optimisticBlockEnd);

  assert.match(optimisticBlock, /label:\s*"CMO"/);
  assert.doesNotMatch(optimisticBlock, /Surf Agent|Echo Agent|Lens|Creative Agent/);
});

check("final_answer_content_renders_before_progress_panel", () => {
  assert.match(chatPanel, /content:\s*response\.answer/);

  const answerIndex = indexOfOrThrow(chatPanel, "renderAssistantContent(message.content)");
  const progressIndex = indexOfOrThrow(chatPanel, "<CmoAgentActivityPanel");
  const assetsIndex = indexOfOrThrow(chatPanel, "renderCreativeAssets(message)");

  assert.ok(answerIndex < progressIndex, "progress panel must not replace or precede answer content");
  assert.ok(progressIndex < assetsIndex, "progress panel must not alter creative asset rendering");
});

check("failed_run_progress_exposes_clear_safe_error_detail", () => {
  assert.match(activityPanel, /function lifecycleDetail/);
  assert.match(activityPanel, /message\?\.hermesCmoErrorReason/);
  assert.match(activityPanel, /message\?\.runtimeErrorReason/);
  assert.match(activityPanel, /message\?\.productFallbackReason/);
  assert.match(activityPanel, /Timed out before Hermes returned a final result/);
});

check("vietnamese_answer_language_is_preserved_by_using_runtime_answer_body", () => {
  assert.match(chatPanel, /const question = trimmedInput/);
  assert.match(chatPanel, /message:\s*question/);
  assert.match(chatPanel, /content:\s*response\.answer/);
  assert.doesNotMatch(chatPanel, /content:\s*"CMO response received/);
});

if (process.exitCode) {
  process.exit(process.exitCode);
}

console.log(`cmo-chat-progress-visibility-check: ${checks.length} checks passed`);
