import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import vm from "node:vm";
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
requireSource(intentSource, /"hinh"/, "routing intent must recognize Vietnamese image requests");
requireSource(intentSource, /"brainstorm"/, "routing intent must recognize brainstorming creative concepts");
requireSource(intentSource, /"key"/, "routing intent must recognize key visual requests");
requireSource(intentSource, /"poster"/, "routing intent must recognize poster requests");
requireSource(intentSource, /"sticker"/, "routing intent must recognize sticker requests");
requireSource(intentSource, /if \(isCreativeDraftSessionIntent\(message\)\) return "creative_ideation"/, "routing intent must expose creative_ideation");
requireSource(intentSource, /classifyCreativeSessionFollowup/, "routing intent must expose creative session classifier");
requireSource(intentSource, /CreativeSessionFollowupIntent[\s\S]*"execute_draft"[\s\S]*"cancel_or_hold"/, "routing intent must expose semantic creative session intents");
requireSource(intentSource, /creativeWorkingState\?: CreativeWorkingStateIntentContext/, "routing intent must classify with creative state context");
requireSource(intentSource, /const creativeSessionClassification = classifyCreativeSessionFollowup\(message, options\.creativeWorkingState\)/, "routing intent must classify with state before routing");
requireSource(intentSource, /if \(creativeSessionClassification\.detected\) return "creative_session"/, "routing intent must expose creative_session from state-machine detection");
forbidSource(intentSource, /message\s*={2,3}\s*["'`]/, "routing intent must not use exact message equality");
forbidSource(intentSource, /\.includes\(["'`](?:ok|render|draft|tao|ban)/i, "routing intent must not branch on literal example phrases");

requireSource(routerSource, /hasCreativeWorkingState\?: boolean/, "router input");
requireSource(routerSource, /creativeWorkingState\?: CmoCreativeWorkingState;/, "router input must accept creative state");
requireSource(routerSource, /"creative_session"/, "router creative session reason");
requireSource(routerSource, /"creative_ideation"/, "router creative ideation reason");
requireSource(routerSource, /classifyCreativeSessionFollowup\(input\.message, creativeWorkingState\)/, "router must use state-machine classifier");
requireSource(routerSource, /const creativeSessionFollowup = creativeSessionClassification\.detected/, "router must route only classified creative session follow-ups");
requireSource(routerSource, /reason: creativeSessionFollowup \? "creative_session" : "creative_ideation"/, "router must distinguish creative session from first ideation");

const intent = loadTsModule("src/lib/cmo/app-routing-intent.ts");
const draftState = loadTsModule("src/lib/cmo/creative-draft-state.ts");
const activeCreativeState = {
  active_draft_id: "creative_draft_001",
  drafts: [
    {
      draft_id: "creative_draft_001",
      kind: "image",
      title: "World Cup egg visual",
      prompt: "A heroic egg character on a football pitch",
    },
  ],
};
const ambiguousCreativeState = {
  drafts: [
    { draft_id: "creative_draft_001", kind: "image" },
    { draft_id: "creative_draft_002", kind: "image" },
  ],
};

for (const message of [
  "Minh muon tao hinh anh trung chu de world cup",
  "Brainstorm cho minh concept anh trung World Cup",
  "Minh muon lam key visual cho campaign",
  "Tao prompt hinh anh trung chu de World Cup",
  "Thiet ke banner/poster/icon/sticker cho launch",
  "Lam hinh cho campaign World Cup",
]) {
  assert.equal(intent.isCreativeDraftSessionIntent(message), true, `${message} must be detected as Creative draft session intent`);
  assert.equal(intent.routeIntentForMessage(message), "creative_ideation", `${message} must route as creative_ideation`);
}

assert.equal(intent.routeIntentForMessage("Doc link nay va tom tat giup minh https://example.com"), "cmo_default", "source/tool read requests must not be classified as creative");

for (const message of [
  "Ban draft truoc cho minh nhe",
  "Ban de xuat draft di",
  "Cho minh xem draft",
  "Cho minh xem prompt",
  "Viet prompt truoc",
  "Cho minh prompt",
  "Dung tao voi",
  "Chi prompt thoi dung tao",
  "Chinh prompt do lai",
  "Doi style sang cinematic",
  "Lam version 1:1",
  "Ok tao di",
  "Ok ban tao hinh theo prompt goi y di",
  "Generate di",
  "Tao anh tu prompt do",
]) {
  assert.equal(intent.isCreativeSessionFollowupIntent(message, activeCreativeState), true, `${message} must be detected as Creative session follow-up intent with active state`);
  assert.equal(intent.routeIntentForMessage(message, { creativeWorkingState: activeCreativeState }), "creative_session", `${message} must route as a Creative-native session intent with active state`);
  assert.notEqual(intent.routeIntentForMessage(message), "creative_session", `${message} must not route as Creative session without creative state`);
}

assert.equal(intent.routeIntentForMessage("Traffic tuan nay the nao?", { creativeWorkingState: activeCreativeState }), "cmo_default", "analytics requests must not be classified as creative session follow-up");
assert.equal(intent.routeIntentForMessage("Dune volume hom qua bao nhieu?", { creativeWorkingState: activeCreativeState }), "cmo_default", "Dune metric requests must not be classified as creative session follow-up");
assert.equal(intent.routeIntentForMessage("Task nao dang pending?", { creativeWorkingState: activeCreativeState }), "cmo_default", "task status requests must not be classified as creative session follow-up");
assert.equal(intent.classifyCreativeSessionFollowupIntent("Can you pull last week's conversion chart?", activeCreativeState), "none", "tool/analytics questions must stay unrelated even with an active draft");
assert.equal(intent.classifyCreativeSessionFollowupIntent("Let's proceed with generating the visual now", activeCreativeState), "execute_draft", "paraphrased confirmation must execute active draft intent");
assert.equal(intent.classifyCreativeSessionFollowupIntent("Walk me through the concept before making anything", activeCreativeState), "present_draft", "paraphrased show-draft-first request must present draft only");
assert.equal(intent.classifyCreativeSessionFollowupIntent("Do not generate yet, just keep the prompt", activeCreativeState), "cancel_or_hold", "hold request must not execute");
assert.equal(intent.classifyCreativeSessionFollowupIntent("Generate the image", ambiguousCreativeState), "ask_clarification", "ambiguous multiple drafts must ask clarification");

const turn1Message = "Minh muon tao hinh anh trung chu de world cup";
assert.equal(intent.routeIntentForMessage(turn1Message), "creative_ideation", "turn 1 must route as Creative ideation");
const turn1HermesResponse = {
  answer_basis: { mode: "creative_ideation" },
  creative_decision: {
    action: "propose_draft",
    draft_id: "creative_draft_001",
  },
  suggested_creative_state_update: {
    active_draft_id: "creative_draft_001",
    drafts_upsert: [
      {
        draft_id: "creative_draft_001",
        kind: "image",
        title: "World Cup egg visual",
        brief: "A playful egg image concept for a World Cup campaign.",
        prompt: "A heroic egg character on a football pitch, World Cup energy, stadium lights, cinematic ad poster",
        negative_prompt: "blurry, low quality",
        format: "16:9",
        status: "draft",
        created_turn_id: "turn_1",
        updated_turn_id: "turn_1",
      },
    ],
  },
};
let threeTurnCreativeState = draftState.applySuggestedCreativeStateUpdate(
  undefined,
  draftState.extractSuggestedCreativeStateUpdate(turn1HermesResponse),
);
let threeTurnDecision = draftState.extractCreativeDecision(turn1HermesResponse);
assert.equal(threeTurnDecision.action, "propose_draft", "turn 1 must persist CMO propose_draft decision");
assert.equal(threeTurnCreativeState.active_draft_id, "creative_draft_001", "turn 1 must persist active draft id");
assert.equal(threeTurnCreativeState.drafts.length, 1, "turn 1 must persist draft without duplication");

const turn2Message = "Ban de xuat draft di";
assert.equal(intent.isCreativeSessionFollowupIntent(turn2Message, threeTurnCreativeState), true, "turn 2 must be detected as active Creative session follow-up");
assert.equal(intent.classifyCreativeSessionFollowupIntent(turn2Message, threeTurnCreativeState), "present_draft", "turn 2 should present draft rather than execute");
const turn2HermesResponse = {
  answer_basis: { mode: "creative_session" },
  answer: {
    body: `Draft: ${threeTurnCreativeState.drafts[0].title}\nPrompt: ${threeTurnCreativeState.drafts[0].prompt}`,
  },
  creative_decision: {
    action: "present_draft",
    draft_id: "creative_draft_001",
  },
};
threeTurnDecision = draftState.extractCreativeDecision(turn2HermesResponse);
assert.equal(threeTurnDecision.action, "present_draft", "turn 2 must persist present_draft decision");
assert.match(turn2HermesResponse.answer.body, /World Cup egg visual/, "turn 2 answer should contain active draft details");
assert.match(turn2HermesResponse.answer.body, /heroic egg character/, "turn 2 answer should contain prompt details");

const turn3Message = "Ok ban tao hinh theo prompt goi y di";
assert.equal(intent.isCreativeSessionFollowupIntent(turn3Message, threeTurnCreativeState), true, "turn 3 must be detected as active Creative session follow-up");
assert.equal(intent.classifyCreativeSessionFollowupIntent(turn3Message, threeTurnCreativeState), "execute_draft", "turn 3 should be passed to CMO as execute-intent hint");
const turn3HermesResponse = {
  answer_basis: { mode: "creative_session" },
  creative_decision: {
    action: "execute",
    draft_id: "creative_draft_001",
    operation: "creative.generate_image",
  },
  creative_assets: [
    {
      asset_id: "asset_001",
      kind: "image",
      mime_type: "image/png",
      render_url: "https://product.example/assets/asset_001.png",
    },
  ],
};
threeTurnDecision = draftState.extractCreativeDecision(turn3HermesResponse);
assert.equal(threeTurnDecision.action, "execute", "turn 3 execute decision must come from Hermes CMO response");
assert.equal(threeTurnDecision.operation, "creative.generate_image", "turn 3 must preserve Creative generation operation");
assert.equal(threeTurnCreativeState.active_draft_id, "creative_draft_001", "turn 3 must keep sending active creative state");

for (const nonExecuteMessage of [
  "Ban draft truoc cho minh nhe",
  "Cho minh xem prompt",
  "Chi viet prompt thoi, dung tao",
  "Chinh prompt do lai",
  "Doi style sang cinematic",
]) {
  assert.notEqual(
    intent.classifyCreativeSessionFollowupIntent(nonExecuteMessage, threeTurnCreativeState),
    "execute_draft",
    `${nonExecuteMessage} must not be classified as an execute hint`,
  );
}

requireSource(mapperSource, /creativeWorkingState\?: CmoCreativeWorkingState;/, "Hermes mapper input");
requireSource(mapperSource, /creativeIdeationDetected\?: boolean;/, "Hermes mapper ideation input");
requireSource(mapperSource, /creativeSessionFollowupDetected\?: boolean;/, "Hermes mapper session follow-up input");
requireSource(mapperSource, /creative_working_state: creativeWorkingStateForHermes/, "Hermes mapper must send creative_working_state");
requireSource(mapperSource, /creative_ideation_intent/, "Hermes mapper must send creative ideation intent");
requireSource(mapperSource, /creative_session_followup_intent/, "Hermes mapper must send creative session follow-up intent");
requireSource(mapperSource, /classifyCreativeSessionFollowupIntent\(input\.message, creativeWorkingStateForHermes\)/, "Hermes mapper must classify follow-up with creative state");
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
requireSource(runtimeSource, /"creative\.session\.presented"/, "runtime activity validation must accept session presented event");
requireSource(runtimeSource, /creativeIdeationEventToProductEvent/, "runtime must map raw creative ideation events to Product-safe activity events");
requireSource(runtimeSource, /type: "cmo\.durable_action\.proposed"/, "runtime canonicalizer must not pass raw creative ideation event types into M1 activity validation");
requireSource(runtimeSource, /creativeNativeAnswerBasisModes/, "runtime canonicalizer must support native creative session modes");
requireSource(runtimeSource, /creative_session_response_received/, "runtime diagnostics must trace creative session responses");
requireSource(runtimeSource, /rejected_by_m1_validator: false/, "runtime diagnostics must mark accepted ideation responses");
requireSource(runtimeSource, /artifact_transport: creativeArtifactTransportForRequest\(request\)/, "runtime must include M13B artifact transport");
requireSource(runtimeSource, /creative_execution_may_be_requested_by_cmo: creativeTurnMayExecute/, "runtime must allow CMO-owned draft execution");
requireSource(runtimeSource, /cmo_owns_creative_decision: constraints\.cmo_owns_creative_decision === true/, "runtime trace must include CMO decision ownership");
forbidSource(runtimeSource, /const answerBasisModes = new Set[\s\S]*"creative_ideation"[\s\S]*\]\);[\s\S]*const answerFormats/s, "runtime must not globally allow creative_ideation answer basis");
forbidSource(runtimeSource, /const activityTypes = new Set[\s\S]*"creative\.ideation\.draft_proposed"[\s\S]*\]\);[\s\S]*const creativeLifecycleActivityTypes/s, "runtime must not globally allow creative ideation activity events");

requireSource(storeSource, /let creativeWorkingState: CmoCreativeWorkingState \| undefined = continuedSession\?\.creativeWorkingState;/, "store session state");
requireSource(storeSource, /creativeWorkingState,/, "store must pass creative state to router and Hermes");
requireSource(storeSource, /hermesCmoRoute\.reason === "creative_ideation"/, "store must treat creative ideation as CMO-native creative");
requireSource(storeSource, /hermesCmoRoute\.reason === "creative_session"/, "store must treat creative session follow-up as CMO-native creative");
requireSource(storeSource, /creativeWorkingStateForHermes = hermesCmoNativeCreativeRequested \? creativeWorkingState : undefined/, "store must only send creative state on native creative turns");
requireSource(storeSource, /creativeSessionFollowupDetected,/, "store must pass creative session follow-up flag to Hermes");
requireSource(storeSource, /creativeWorkingState: creativeWorkingStateForHermes/, "store must pass creativeWorkingState to Hermes mapper only on creative turns");
requireSource(storeSource, /applySuggestedCreativeStateUpdate\([\s\S]*extractSuggestedCreativeStateUpdate\(hermesResult\.response\)/, "store must apply Hermes suggested state update");
requireSource(storeSource, /extractCreativeDecision\(hermesResult\.response\)/, "store must persist creative decision");
requireSource(storeSource, /creative_session_response_received/, "store must persist creative session diagnostics");
requireSource(storeSource, /creative_state_persisted: creativeStatePersisted/, "store must persist creative state persistence diagnostics");
requireSource(mapperSource, /creative_state_update_present: creativeStateUpdatePresent/, "mapper must expose creative state update diagnostics");
requireSource(mapperSource, /creative_decision_present: creativeDecisionPresent/, "mapper must expose creative decision diagnostics");
requireSource(mapperSource, /creative_session_canonicalized/, "mapper must expose creative session canonicalization diagnostics");

requireSource(uiSource, /renderCreativeAssets\(message\)/, "UI must keep rendering creative assets");
forbidSource(storeSource, /Ok b[a-z]*n t[a-z]*o [a-z]*i|message\s*={2,3}\s*["'`]Ok b/i, "Product store");
forbidSource(storeSource, /callCreative|executeCreative|Creative Agent direct/i, "Product store must not call Creative directly");

console.log("M13D Creative draft state contract passed");
