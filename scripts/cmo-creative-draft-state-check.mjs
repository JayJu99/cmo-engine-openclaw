import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import path from "node:path";
import ts from "typescript";

const root = process.cwd();
const require = createRequire(import.meta.url);
const read = (file) => readFileSync(path.join(root, file), "utf8");

const typesSource = read("src/lib/cmo/app-workspace-types.ts");
const helperSource = read("src/lib/cmo/creative-draft-state.ts");
const mapperSource = read("src/lib/cmo/hermes-cmo-chat-mapper.ts");
const runtimeSource = read("src/lib/cmo/hermes-cmo-runtime.ts");
const storeSource = read("src/lib/cmo/app-chat-store.ts");
const routerSource = read("src/lib/cmo/hermes-cmo-chat-router.ts");
const intentSource = read("src/lib/cmo/app-routing-intent.ts");
const uiSource = read("src/components/cmo-apps/cmo-chat-panel.tsx");

function loadTsModule(file) {
  const source = read(file);
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
  }).outputText;
  const cjsModule = { exports: {} };
  vm.runInNewContext(output, {
    module: cjsModule,
    exports: cjsModule.exports,
    require,
  }, { filename: file });

  return cjsModule.exports;
}

function requireSource(source, pattern, label) {
  assert.match(source, pattern, `${label} missing ${pattern}`);
}

function forbidSource(source, pattern, label) {
  assert.doesNotMatch(source, pattern, `${label} must not match ${pattern}`);
}

requireSource(typesSource, /export interface CmoCreativeWorkingState[\s\S]*active_draft_id\?: string \| null;[\s\S]*drafts: CmoCreativeDraft\[];/, "types");
requireSource(typesSource, /export interface CmoCreativeDecision[\s\S]*action: CmoCreativeDecisionAction;/, "types");
requireSource(typesSource, /creativeWorkingState\?: CmoCreativeWorkingState;/, "session/message/response types");
requireSource(typesSource, /creativeDecision\?: CmoCreativeDecision;/, "session/message/response types");
requireSource(typesSource, /CmoRouteDecision = "app_turn" \| "creative_execution" \| "creative_ideation" \| "creative_session" \| "execute" \| "tool_execute"/, "route decision types");

requireSource(helperSource, /function normalizeSuggestedCreativeStateUpdate/, "draft helper");
requireSource(helperSource, /drafts_upsert/, "draft helper");
requireSource(helperSource, /new Map<string, CmoCreativeDraft>/, "draft helper must dedupe drafts by draft_id");
requireSource(helperSource, /draftsById\.set\(draft\.draft_id,[\s\S]*\.\.\.\(draftsById\.get\(draft\.draft_id\)/, "draft helper must upsert without dropping existing fields");
requireSource(helperSource, /extractSuggestedCreativeStateUpdate/, "draft helper");
requireSource(helperSource, /extractCreativeDecision/, "draft helper");

requireSource(intentSource, /isCreativeDraftSessionIntent/, "routing intent");
requireSource(intentSource, /hinh anh/, "routing intent must recognize Vietnamese natural image requests");
requireSource(intentSource, /brainstorm/, "routing intent must recognize brainstorming creative concepts");
requireSource(intentSource, /key visual/, "routing intent must recognize key visual requests");
requireSource(intentSource, /poster\|sticker/, "routing intent must recognize poster/sticker requests");
requireSource(intentSource, /if \(isCreativeDraftSessionIntent\(message\)\) return "creative_ideation"/, "routing intent must expose creative_ideation");
requireSource(routerSource, /hasCreativeWorkingState\?: boolean/, "router input");
requireSource(routerSource, /"creative_session"/, "router creative session reason");
requireSource(routerSource, /"creative_ideation"/, "router creative ideation reason");
requireSource(routerSource, /input\.hasCreativeWorkingState === true \|\| routeIntent === "creative_ideation" \|\| isCreativeDraftSessionIntent\(input\.message\)/, "router state-aware execute route");
assert.ok(
  routerSource.indexOf('routeIntent === "creative_ideation"') < routerSource.indexOf("input.hasSourceOrToolTask === true"),
  "creative ideation must route before source/tool tasks",
);

const intent = loadTsModule("src/lib/cmo/app-routing-intent.ts");
for (const message of [
  "Mình muốn tạo hình ảnh trứng chủ đề world cup",
  "Brainstorm cho mình concept ảnh trứng World Cup",
  "Mình muốn làm key visual cho campaign",
  "Tạo prompt hình ảnh trứng chủ đề World Cup",
  "Thiết kế banner/poster/icon/sticker cho launch",
  "Làm hình cho campaign World Cup",
]) {
  assert.equal(intent.isCreativeDraftSessionIntent(message), true, `${message} must be detected as Creative draft session intent`);
  assert.equal(intent.routeIntentForMessage(message), "creative_ideation", `${message} must route as creative_ideation`);
}
assert.equal(intent.routeIntentForMessage("Đọc link này và tóm tắt giúp mình https://example.com"), "cmo_default", "source/tool read requests must not be classified as creative");

requireSource(mapperSource, /creativeWorkingState\?: CmoCreativeWorkingState;/, "Hermes mapper input");
requireSource(mapperSource, /creativeIdeationDetected\?: boolean;/, "Hermes mapper ideation input");
requireSource(mapperSource, /creative_working_state: creativeWorkingStateForHermes/, "Hermes mapper must send creative_working_state");
requireSource(mapperSource, /creative_ideation_intent/, "Hermes mapper must send creative ideation intent");
requireSource(mapperSource, /product_must_not_choose_creative_execution: true/, "Hermes mapper must keep CMO as execution decision owner");
requireSource(mapperSource, /creative_decision_owner_when_live: "hermes_cmo"/, "Hermes mapper product boundary");

requireSource(runtimeSource, /requestHasCreativeWorkingState/, "runtime");
requireSource(runtimeSource, /requestIsCreativeIdeation/, "runtime");
requireSource(runtimeSource, /requestMayLeadToCreativeExecution/, "runtime");
requireSource(runtimeSource, /creativeIdeation[\s\S]*\? "creative_ideation"/, "runtime must trace creative_ideation route decision");
requireSource(runtimeSource, /artifact_transport: creativeArtifactTransportForRequest\(request\)/, "runtime must include M13B artifact transport");
requireSource(runtimeSource, /creative_execution_may_be_requested_by_cmo: creativeTurnMayExecute/, "runtime must allow CMO-owned draft execution");
requireSource(runtimeSource, /creative_ideation_detected: constraints\.creative_ideation_detected === true/, "runtime trace must include creative_ideation_detected");
requireSource(runtimeSource, /cmo_owns_creative_decision: constraints\.cmo_owns_creative_decision === true/, "runtime trace must include CMO decision ownership");
requireSource(runtimeSource, /upload_endpoint: `\$\{productPublicOrigin\(\)\}\/api\/cmo\/apps\/\$\{encodeURIComponent\(appId\)\}\/creative\/artifact-ingest`/, "runtime upload endpoint");

requireSource(storeSource, /let creativeWorkingState: CmoCreativeWorkingState \| undefined = continuedSession\?\.creativeWorkingState;/, "store session state");
requireSource(storeSource, /hasCreativeWorkingState: creativeWorkingStatePresent/, "store route state");
requireSource(storeSource, /hermesCmoRoute\.reason === "creative_ideation"/, "store must treat creative ideation as CMO-native creative");
requireSource(storeSource, /creativeIdeationDetected,/, "store must pass creative ideation flag to Hermes");
requireSource(storeSource, /creativeWorkingState,/, "store must pass creativeWorkingState to Hermes mapper");
requireSource(storeSource, /applySuggestedCreativeStateUpdate\([\s\S]*extractSuggestedCreativeStateUpdate\(hermesResult\.response\)/, "store must apply Hermes suggested state update");
requireSource(storeSource, /extractCreativeDecision\(hermesResult\.response\)/, "store must persist creative decision");
requireSource(storeSource, /creativeWorkingState \? \{ creativeWorkingState \}/, "store must persist creativeWorkingState in session/messages/response");
requireSource(storeSource, /creativeDecision \? \{ creativeDecision \}/, "store must persist creativeDecision in session/messages/response");

requireSource(uiSource, /renderCreativeAssets\(message\)/, "UI must keep rendering creative assets");
forbidSource(storeSource, /Ok b[aạ]n t[aạ]o [đd]i|message\s*={2,3}\s*["'`]Ok b/i, "Product store");
forbidSource(storeSource, /callCreative|executeCreative|Creative Agent direct/i, "Product store must not call Creative directly");

console.log("M13D Creative draft state contract passed");
