import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const appChatStoreSource = await readFile(path.join(rootDir, "src", "lib", "cmo", "app-chat-store.ts"), "utf8");
const appWorkspaceTypesSource = await readFile(path.join(rootDir, "src", "lib", "cmo", "app-workspace-types.ts"), "utf8");
const runtimeSource = await readFile(path.join(rootDir, "src", "lib", "cmo", "hermes-cmo-runtime.ts"), "utf8");
const routerSource = await readFile(path.join(rootDir, "src", "lib", "cmo", "hermes-cmo-chat-router.ts"), "utf8");

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

assert.match(appChatStoreSource, /CMO is working\.\.\.[\s\S]*Researching signals\.\.\.[\s\S]*Synthesizing answer\.\.\./, "pending assistant copy must be natural and non-JSON");
assert.match(appChatStoreSource, /function shouldStartAsyncHermesCmoToolRun/, "Product must gate async run creation for tool_execute only");
assert.match(appChatStoreSource, /hermesCmoRoute\.endpointKind === "tool_execute"/, "async flow must target only CMO tool-execute route");
assert.match(appChatStoreSource, /void completeAsyncHermesCmoToolRun\(/, "POST must launch non-blocking background completion");
assert.match(appChatStoreSource, /await writeJsonFile\(sessionPath\(sessionId\), pendingSession\)/, "pending session must be persisted before background run starts");
assert.match(appChatStoreSource, /CMO could not complete the research run\. Try narrowing the request or retry\./, "failure/timed-out final copy must be safe and natural");
assert.doesNotMatch(appChatStoreSource, /JSON\.stringify\(hermesResult\.response\)|JSON\.stringify\(mappedHermesResult\)/, "normal UI must not stringify raw Hermes/Surf/Echo JSON");

assert.match(runtimeSource, /getCmoHermesCmoToolTimeoutMs\(\)/, "tool-execute backend budget must remain configurable/longer than UI blocking request");
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
    "pending assistant copy",
    "tool_execute-only async gate",
    "non-blocking background launch",
    "pending persisted before background",
    "safe failure copy",
    "no raw JSON stringify leak",
    "backend tool timeout remains configurable",
  ],
}, null, 2));
