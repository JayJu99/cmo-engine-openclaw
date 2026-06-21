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
requireSource(typesSource, /"present_draft"/, "types must include present_draft decision action");
requireSource(typesSource, /"show_draft"/, "types must include show_draft decision action");
requireSource(typesSource, /creativeWorkingState\?: CmoCreativeWorkingState;/, "session/message/response types");
requireSource(typesSource, /creativeDecision\?: CmoCreativeDecision;/, "session/message/response types");
requireSource(typesSource, /CmoRouteDecision = "app_turn" \| "creative_execution" \| "creative_ideation" \| "creative_session" \| "execute" \| "tool_execute"/, "route decision types");

requireSource(helperSource, /function normalizeSuggestedCreativeStateUpdate/, "draft helper");
requireSource(helperSource, /drafts_upsert/, "draft helper");
requireSource(helperSource, /new Map<string, CmoCreativeDraft>/, "draft helper must dedupe drafts by draft_id");
requireSource(helperSource, /draftsById\.set\(draft\.draft_id,[\s\S]*\.\.\.\(draftsById\.get\(draft\.draft_id\)/, "draft helper must upsert without dropping existing fields");
requireSource(helperSource, /extractSuggestedCreativeStateUpdate/, "draft helper");
requireSource(helperSource, /extractCreativeDecision/, "draft helper");
requireSource(helperSource, /value === "present_draft"/, "draft helper must normalize present_draft decision");
requireSource(helperSource, /value === "show_draft"/, "draft helper must normalize show_draft decision");

requireSource(intentSource, /isCreativeDraftSessionIntent/, "routing intent");
requireSource(intentSource, /hinh anh/, "routing intent must recognize Vietnamese natural image requests");
requireSource(intentSource, /brainstorm/, "routing intent must recognize brainstorming creative concepts");
requireSource(intentSource, /key visual/, "routing intent must recognize key visual requests");
requireSource(intentSource, /poster\|sticker/, "routing intent must recognize poster/sticker requests");
requireSource(intentSource, /if \(isCreativeDraftSessionIntent\(message\)\) return "creative_ideation"/, "routing intent must expose creative_ideation");
requireSource(intentSource, /isCreativeSessionFollowupIntent/, "routing intent must expose creative session follow-up detection");
requireSource(intentSource, /if \(isCreativeSessionFollowupIntent\(message\)\) return "creative_session"/, "routing intent must expose creative_session");
requireSource(routerSource, /hasCreativeWorkingState\?: boolean/, "router input");
requireSource(routerSource, /"creative_session"/, "router creative session reason");
requireSource(routerSource, /"creative_ideation"/, "router creative ideation reason");
requireSource(routerSource, /const creativeSessionFollowup = input\.hasCreativeWorkingState === true &&/, "router must require active state for creative session follow-up route");
requireSource(routerSource, /isCreativeSessionFollowupIntent\(input\.message\)/, "router must detect creative session follow-up messages");
requireSource(routerSource, /reason: creativeSessionFollowup \? "creative_session" : "creative_ideation"/, "router must distinguish creative session from first ideation");
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

for (const message of [
  "Ban draft truoc cho minh nhe",
  "Cho minh xem draft",
  "Viet prompt truoc",
  "Cho minh prompt",
  "Dung tao voi",
  "Chi prompt thoi dung tao",
  "Chinh prompt do lai",
  "Doi style sang cinematic",
  "Lam version 1:1",
  "Ok tao di",
  "Generate di",
  "Tao anh tu prompt do",
]) {
  assert.equal(intent.isCreativeSessionFollowupIntent(message), true, `${message} must be detected as Creative session follow-up intent`);
  assert.ok(["creative_session", "creative_ideation"].includes(intent.routeIntentForMessage(message)), `${message} must route as a Creative-native intent`);
}
assert.equal(intent.routeIntentForMessage("Traffic tuan nay the nao?"), "cmo_default", "analytics requests must not be classified as creative session follow-up");
assert.equal(intent.routeIntentForMessage("Dune volume hom qua bao nhieu?"), "cmo_default", "Dune metric requests must not be classified as creative session follow-up");
assert.equal(intent.routeIntentForMessage("Task nao dang pending?"), "cmo_default", "task status requests must not be classified as creative session follow-up");

requireSource(mapperSource, /creativeWorkingState\?: CmoCreativeWorkingState;/, "Hermes mapper input");
requireSource(mapperSource, /creativeIdeationDetected\?: boolean;/, "Hermes mapper ideation input");
requireSource(mapperSource, /creativeSessionFollowupDetected\?: boolean;/, "Hermes mapper session follow-up input");
requireSource(mapperSource, /creative_working_state: creativeWorkingStateForHermes/, "Hermes mapper must send creative_working_state");
requireSource(mapperSource, /creative_ideation_intent/, "Hermes mapper must send creative ideation intent");
requireSource(mapperSource, /may_present_active_draft: true/, "Hermes mapper must allow CMO to present active draft");
requireSource(mapperSource, /may_show_prompt_without_execution: true/, "Hermes mapper must allow prompt-only draft display");
requireSource(mapperSource, /product_must_not_choose_creative_execution: true/, "Hermes mapper must keep CMO as execution decision owner");
requireSource(mapperSource, /creative_decision_owner_when_live: "hermes_cmo"/, "Hermes mapper product boundary");

requireSource(runtimeSource, /requestHasCreativeWorkingState/, "runtime");
requireSource(runtimeSource, /requestIsCreativeIdeation/, "runtime");
requireSource(runtimeSource, /requestMayLeadToCreativeExecution/, "runtime");
requireSource(runtimeSource, /requestAllowsCreativeIdeationAnswerBasis/, "runtime validation");
requireSource(runtimeSource, /routeDecision === "creative_ideation"[\s\S]*routeDecision === "creative_session"/, "runtime validation must require creative route decision");
requireSource(runtimeSource, /requestCreativeFlagIsTrue\(request, "creative_ideation_detected"\)/, "runtime validation must require creative ideation flag");
requireSource(runtimeSource, /requestCreativeFlagIsTrue\(request, "creative_working_state_present"\)/, "runtime validation must allow active creative session state");
requireSource(runtimeSource, /requestCreativeFlagIsTrue\(request, "cmo_owns_creative_decision"\)/, "runtime validation must require CMO decision ownership");
requireSource(runtimeSource, /allowCreativeIdeation: allowCreativeIdeationAnswerBasis/, "runtime validation must conditionally allow creative_ideation answer basis");
requireSource(runtimeSource, /mode === "creative_session" \|\| mode === "creative_refinement"/, "runtime must conditionally allow creative session answer basis");
requireSource(runtimeSource, /normalizeHermesCreativeIdeationResponse/, "runtime must canonicalize Creative ideation before M1 validation");
requireSource(runtimeSource, /safeCreativeIdeationRawActivityTypes/, "runtime creative ideation canonicalizer");
requireSource(runtimeSource, /"creative\.ideation\.draft_proposed"/, "runtime activity validation must accept draft proposed event");
requireSource(runtimeSource, /"creative\.ideation\.draft_updated"/, "runtime activity validation must accept draft updated event");
requireSource(runtimeSource, /"creative\.ideation\.draft_refined"/, "runtime activity validation must accept draft refined event");
requireSource(runtimeSource, /"creative\.ideation\.clarification_requested"/, "runtime activity validation must accept clarification event");
requireSource(runtimeSource, /"creative\.session\.presented"/, "runtime activity validation must accept session presented event");
requireSource(runtimeSource, /"creative\.session\.refined"/, "runtime activity validation must accept session refined event");
requireSource(runtimeSource, /creativeIdeationEventToProductEvent/, "runtime must map raw creative ideation events to Product-safe activity events");
requireSource(runtimeSource, /type: "cmo\.durable_action\.proposed"/, "runtime canonicalizer must not pass raw creative ideation event types into M1 activity validation");
requireSource(runtimeSource, /creativeNativeAnswerBasisModes/, "runtime canonicalizer must support native creative session modes");
requireSource(runtimeSource, /requestAllowsCreativeIdeationAnswerBasis\(request\)[\s\S]*creativeNativeAnswerBasisModes\.has/, "runtime canonicalizer must require creative request context and creative answer basis");
requireSource(runtimeSource, /creative_ideation_canonicalized: true/, "runtime diagnostics must mark creative ideation canonicalization");
requireSource(runtimeSource, /creative_session_canonicalized/, "runtime diagnostics must mark creative session canonicalization");
requireSource(runtimeSource, /raw_activity_event_types: rawActivityEventTypes/, "runtime diagnostics must preserve raw activity event types");
requireSource(runtimeSource, /activity_events_allowed_for_creative_ideation: true/, "runtime diagnostics must expose creative ideation activity canonicalization");
requireSource(runtimeSource, /rejected_activity_event_type/, "runtime diagnostics must expose rejected activity event type");
requireSource(runtimeSource, /creativeNativeResponseReceived = creativeNativeAnswerBasisModes\.has/, "runtime diagnostics must detect native creative responses");
requireSource(runtimeSource, /creative_ideation_response_received: responseAnswerBasis\.mode === "creative_ideation"/, "runtime diagnostics must trace creative ideation responses");
requireSource(runtimeSource, /creative_session_response_received/, "runtime diagnostics must trace creative session responses");
requireSource(runtimeSource, /rejected_by_m1_validator: false/, "runtime diagnostics must mark accepted ideation responses");
requireSource(runtimeSource, /creativeIdeation[\s\S]*\? "creative_ideation"/, "runtime must trace creative_ideation route decision");
requireSource(runtimeSource, /artifact_transport: creativeArtifactTransportForRequest\(request\)/, "runtime must include M13B artifact transport");
requireSource(runtimeSource, /creative_execution_may_be_requested_by_cmo: creativeTurnMayExecute/, "runtime must allow CMO-owned draft execution");
requireSource(runtimeSource, /creative_ideation_detected: constraints\.creative_ideation_detected === true/, "runtime trace must include creative_ideation_detected");
requireSource(runtimeSource, /cmo_owns_creative_decision: constraints\.cmo_owns_creative_decision === true/, "runtime trace must include CMO decision ownership");
requireSource(runtimeSource, /upload_endpoint: `\$\{productPublicOrigin\(\)\}\/api\/cmo\/apps\/\$\{encodeURIComponent\(appId\)\}\/creative\/artifact-ingest`/, "runtime upload endpoint");
forbidSource(runtimeSource, /const answerBasisModes = new Set[\s\S]*"creative_ideation"[\s\S]*\]\);[\s\S]*const answerFormats/s, "runtime must not globally allow creative_ideation answer basis");
forbidSource(runtimeSource, /const activityTypes = new Set[\s\S]*"creative\.ideation\.draft_proposed"[\s\S]*\]\);[\s\S]*const creativeLifecycleActivityTypes/s, "runtime must not globally allow creative ideation activity events");

requireSource(storeSource, /let creativeWorkingState: CmoCreativeWorkingState \| undefined = continuedSession\?\.creativeWorkingState;/, "store session state");
requireSource(storeSource, /hasCreativeWorkingState: creativeWorkingStatePresent/, "store route state");
requireSource(storeSource, /hermesCmoRoute\.reason === "creative_ideation"/, "store must treat creative ideation as CMO-native creative");
requireSource(storeSource, /hermesCmoRoute\.reason === "creative_session"/, "store must treat creative session follow-up as CMO-native creative");
requireSource(storeSource, /creativeWorkingStateForHermes = hermesCmoNativeCreativeRequested \? creativeWorkingState : undefined/, "store must only send creative state on native creative turns");
requireSource(storeSource, /creativeIdeationDetected,/, "store must pass creative ideation flag to Hermes");
requireSource(storeSource, /creativeSessionFollowupDetected,/, "store must pass creative session follow-up flag to Hermes");
requireSource(storeSource, /creativeWorkingState: creativeWorkingStateForHermes/, "store must pass creativeWorkingState to Hermes mapper only on creative turns");
requireSource(storeSource, /applySuggestedCreativeStateUpdate\([\s\S]*extractSuggestedCreativeStateUpdate\(hermesResult\.response\)/, "store must apply Hermes suggested state update");
requireSource(storeSource, /extractCreativeDecision\(hermesResult\.response\)/, "store must persist creative decision");
requireSource(storeSource, /creativeWorkingState \? \{ creativeWorkingState \}/, "store must persist creativeWorkingState in session/messages/response");
requireSource(storeSource, /creativeDecision \? \{ creativeDecision \}/, "store must persist creativeDecision in session/messages/response");
requireSource(storeSource, /creative_ideation_response_received/, "store must persist creative ideation diagnostics");
requireSource(storeSource, /creative_session_response_received/, "store must persist creative session diagnostics");
requireSource(storeSource, /answer_basis_mode/, "store must persist answer basis diagnostics");
requireSource(storeSource, /typeof value\.rejected_by_m1_validator === "boolean"/, "store must preserve accepted validator diagnostic false");
requireSource(storeSource, /activity_events_allowed_for_creative_ideation/, "store must persist creative ideation activity diagnostics");
requireSource(storeSource, /raw_activity_event_types/, "store must persist raw activity event diagnostics");
requireSource(storeSource, /creative_ideation_canonicalized/, "store must persist creative ideation canonicalization diagnostics");
requireSource(storeSource, /creative_state_persisted: creativeStatePersisted/, "store must persist creative state persistence diagnostics");
requireSource(mapperSource, /creative_state_update_present: creativeStateUpdatePresent/, "mapper must expose creative state update diagnostics");
requireSource(mapperSource, /creative_decision_present: creativeDecisionPresent/, "mapper must expose creative decision diagnostics");
requireSource(mapperSource, /answer_basis_mode: answerBasisMode/, "mapper must expose answer basis diagnostics");
requireSource(mapperSource, /activity_event_types: activityEventTypes/, "mapper must expose activity event type diagnostics");
requireSource(mapperSource, /activity_events_allowed_for_creative_ideation/, "mapper must expose creative ideation activity diagnostics");
requireSource(mapperSource, /raw_activity_event_types: rawActivityEventTypes/, "mapper must expose raw activity event type diagnostics");
requireSource(mapperSource, /creative_ideation_canonicalized/, "mapper must expose creative ideation canonicalization diagnostics");
requireSource(mapperSource, /creative_session_canonicalized/, "mapper must expose creative session canonicalization diagnostics");

requireSource(uiSource, /renderCreativeAssets\(message\)/, "UI must keep rendering creative assets");
forbidSource(storeSource, /Ok b[aạ]n t[aạ]o [đd]i|message\s*={2,3}\s*["'`]Ok b/i, "Product store");
forbidSource(storeSource, /callCreative|executeCreative|Creative Agent direct/i, "Product store must not call Creative directly");

console.log("M13D Creative draft state contract passed");
