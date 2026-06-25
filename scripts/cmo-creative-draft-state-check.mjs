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
requireSource(typesSource, /export interface CmoCreativeAssetState[\s\S]*asset_id: string;[\s\S]*render_url\?: string;/, "types must include Creative asset state");
requireSource(typesSource, /active_asset_id\?: string \| null;/, "types must persist active Creative asset id");
requireSource(typesSource, /assets\?: CmoCreativeAssetState\[];/, "types must persist Creative assets in working state");
requireSource(typesSource, /export interface CmoCreativeDecision[\s\S]*action: CmoCreativeDecisionAction;/, "types");
requireSource(typesSource, /"present_draft"/, "types must accept Hermes CMO present_draft decisions");
requireSource(typesSource, /"show_draft"/, "types must accept Hermes CMO show_draft decisions");
requireSource(typesSource, /"blocked"/, "types must accept Hermes CMO blocked decisions");
requireSource(typesSource, /creativeWorkingState\?: CmoCreativeWorkingState;/, "session/message/response types");
requireSource(typesSource, /creativeDecision\?: CmoCreativeDecision;/, "session/message/response types");
requireSource(typesSource, /CmoRouteDecision = "app_turn" \| "creative_execution" \| "creative_ideation" \| "creative_session" \| "execute" \| "tool_execute"/, "route decision types");

requireSource(helperSource, /function normalizeSuggestedCreativeStateUpdate/, "draft helper");
requireSource(helperSource, /drafts_upsert/, "draft helper");
requireSource(helperSource, /new Map<string, CmoCreativeDraft>/, "draft helper must dedupe drafts by draft_id");
requireSource(helperSource, /draftsById\.set\(draft\.draft_id,[\s\S]*\.\.\.\(draftsById\.get\(draft\.draft_id\)/, "draft helper must upsert without dropping existing fields");
requireSource(helperSource, /extractSuggestedCreativeStateUpdate/, "draft helper");
requireSource(helperSource, /extractCreativeDecision/, "draft helper");
requireSource(helperSource, /normalizeCreativeAssetState/, "draft helper must normalize Creative asset context");
requireSource(helperSource, /applyCreativeAssetStateUpdate/, "draft helper must merge Creative asset context");
requireSource(helperSource, /sanitizeCreativeAssetStates/, "draft helper must sanitize renderable Product-backed Creative assets");
requireSource(helperSource, /isSyntheticCreativeAssetId/, "draft helper must identify synthetic Creative placeholder ids");
requireSource(helperSource, /isProductBackedRenderableCreativeAsset/, "draft helper must expose Product-backed renderability checks");
requireSource(helperSource, /inferCreativeMimeType/, "draft helper must infer missing Creative asset mime types");
requireSource(helperSource, /content_type/, "draft helper must accept content_type mime aliases");
requireSource(helperSource, /\.png"\)\) return "image\/png"/, "draft helper must infer image/png from URL or filename extension");
requireSource(helperSource, /value === "present_draft"/, "draft helper must normalize Hermes present_draft decision");
requireSource(helperSource, /value === "show_draft"/, "draft helper must normalize Hermes show_draft decision");
requireSource(helperSource, /value === "blocked"/, "draft helper must normalize blocked decision");
requireSource(helperSource, /reason: safeCreativeText\(value\.reason\)/, "draft helper must preserve only safe blocked reason text");
requireSource(helperSource, /UNSAFE_CREATIVE_TEXT_PATTERN/, "draft helper must reject redacted or machine-wrapper Creative prompt text");

requireSource(intentSource, /isCreativeDraftSessionIntent/, "routing intent");
requireSource(intentSource, /isCreativeSessionTransportContinuation/, "routing intent must expose transport-level Creative continuation detection");
requireSource(intentSource, /classifyCreativeSemanticIntent/, "routing intent must use generalized Creative semantic classification");
requireSource(intentSource, /creationScore/, "routing intent must score user creation goals");
requireSource(intentSource, /assetOutputScore/, "routing intent must score desired Creative output type");
requireSource(intentSource, /negativeExecution/, "routing intent must account for no-execute modifiers");
requireSource(intentSource, /if \(creativeSessionContinuation\) return "creative_session"/, "routing intent must route active Creative session transport to execute");
requireSource(intentSource, /if \(isCreativeDraftSessionIntent\(message\)\) return "creative_ideation"/, "routing intent must expose creative_ideation");
requireSource(intentSource, /CreativeSessionFollowupIntentClass/, "routing intent must expose semantic Creative follow-up classes for permission shaping");
requireSource(intentSource, /creativeSessionFollowupIntentClass/, "routing intent must classify Creative follow-ups semantically for Product permission shaping");
forbidSource(intentSource, /message\s*={2,3}\s*["'`]/, "routing intent must not use exact message equality");
forbidSource(intentSource, /\.includes\(["'`](?:ok|render|draft|tao|ban)/i, "routing intent must not branch on literal example phrases");

requireSource(routerSource, /hasCreativeWorkingState\?: boolean/, "router input");
requireSource(routerSource, /creativeWorkingState\?: CmoCreativeWorkingState;/, "router input must accept creative state");
requireSource(routerSource, /isCreativeSessionTransportContinuation\(input\.message, creativeWorkingState\)/, "router must use transport-level continuation detection");
requireSource(routerSource, /reason: creativeSessionContinuation \? "creative_session" : "creative_ideation"/, "router must distinguish active session transport from first ideation");
forbidSource(routerSource, /classifyCreativeSessionFollowup/, "router must not classify Product Creative actions");

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
const activeAssetCreativeState = {
  active_asset_id: "creative_asset_001",
  drafts: [],
  assets: [
    {
      asset_id: "creative_asset_001",
      kind: "image",
      status: "stored",
      prompt: "Premium black and gold Eggs Vault key visual",
      visual_summary: "Square key visual with an egg hero object.",
      mime_type: "image/png",
      storage_path: "tenant/workspace/app/job/creative_asset_001/creative.png",
      transport_status: "uploaded",
      sha256: "a".repeat(64),
      bytes: 123456,
      render_url: "https://product.example/assets/asset_001.png",
      operation: "creative.generate_image",
    },
  ],
};

for (const message of [
  "Brainstorm cho minh concept anh trung World Cup",
  "Draft prompt only for an egg-shaped sports campaign image",
  "Phac thao y tuong hinh anh truoc, chua can render",
]) {
  assert.equal(intent.isCreativeDraftSessionIntent(message), true, `${message} must be detected as Creative draft session intent`);
  assert.equal(intent.routeIntentForMessage(message), "creative_ideation", `${message} must route as creative_ideation`);
}

for (const message of [
  "Compose a launch artwork for Eggs Vault in a wide seasonal quest format",
  "Produce a premium campaign graphic for Eggs Vault with a dark reward object and 16:9 crop",
  "Lam mot anh quang cao Eggs Vault phong cach le hoi, ti le ngang, co vat pham thuong o trung tam",
  "Design an illustrated promo asset for the new quest event with clean product branding",
]) {
  assert.equal(intent.isExplicitCreativeExecutionIntent(message), true, `${message} must be detected as direct Creative execution`);
  assert.equal(intent.routeIntentForMessage(message), "creative_execution", `${message} must route as creative_execution`);
}

for (const message of [
  "Ban draft truoc cho minh nhe",
  "Ban de xuat draft di",
  "Cho minh xem prompt",
  "Chi prompt thoi dung tao",
  "Doi style sang cinematic",
  "Lam version 1:1",
  "Let's proceed with generating the visual now",
  "Create the image from that prompt",
]) {
  assert.equal(intent.isCreativeSessionTransportContinuation(message, activeCreativeState), true, `${message} must route as Creative session transport with active state`);
  assert.equal(intent.routeIntentForMessage(message, { creativeWorkingState: activeCreativeState }), "creative_session", `${message} must route as a CMO-native Creative session`);
  assert.notEqual(intent.routeIntentForMessage(message), "creative_session", `${message} must not route as Creative session without creative state`);
}

for (const message of [
  "Assess the current composition for trust and clarity, no changes yet",
  "What feels confusing in this asset before we touch it?",
  "Cho minh nhan xet bo cuc hien tai, khoan sua gi",
]) {
  assert.equal(intent.creativeSessionFollowupIntentClass(message), "asset_review", `${message} must classify as asset review`);
  assert.equal(intent.routeIntentForMessage(message, { creativeWorkingState: activeAssetCreativeState }), "creative_session", `${message} must stay non-mutating Creative session`);
}

for (const message of [
  "Map this asset across website, social feed, and community announcement use",
  "How should the same image be positioned for web, post, and Telegram?",
  "Nen dung hinh nay khac nhau the nao giua kenh web va cong dong?",
]) {
  assert.equal(intent.creativeSessionFollowupIntentClass(message), "channel_advisory", `${message} must classify as channel advisory`);
  assert.equal(intent.routeIntentForMessage(message, { creativeWorkingState: activeAssetCreativeState }), "creative_session", `${message} must stay Creative session`);
}

for (const message of [
  "Give me only the edit instructions for a sharper reward focal point",
  "Write a prompt direction but do not render yet",
  "Chi de xuat prompt chinh mau va bo cuc, khoan tao file",
]) {
  assert.equal(intent.creativeSessionFollowupIntentClass(message), "prompt_proposal", `${message} must classify as prompt proposal`);
  assert.equal(intent.routeIntentForMessage(message, { creativeWorkingState: activeAssetCreativeState }), "creative_session", `${message} must stay Creative session`);
}

for (const message of [
  "Apply the sharper reward focal point to the asset now",
  "Make this version warmer and more premium",
  "Chinh hinh hien tai sang hon va them nhan vat pham thuong",
]) {
  assert.equal(intent.creativeSessionFollowupIntentClass(message), "explicit_mutation", `${message} must classify as explicit mutation`);
  assert.equal(intent.routeIntentForMessage(message, { creativeWorkingState: activeAssetCreativeState }), "creative_session", `${message} must execute through Creative session`);
}

for (const message of [
  "Okay, keep it for now",
  "Chot huong nay",
  "Duoc roi, tam thoi giu nguyen",
]) {
  assert.equal(intent.creativeSessionFollowupIntentClass(message), "ack_noop", `${message} must classify as acknowledgement`);
  assert.equal(intent.routeIntentForMessage(message, { creativeWorkingState: activeAssetCreativeState }), "creative_session", `${message} must stay Creative session`);
}

assert.equal(intent.routeIntentForMessage("Traffic tuan nay the nao?", { creativeWorkingState: activeCreativeState }), "cmo_default", "analytics requests must not be forced into Creative");
assert.equal(intent.routeIntentForMessage("Dune volume hom qua bao nhieu?", { creativeWorkingState: activeCreativeState }), "cmo_default", "Dune metric requests must not be forced into Creative");
assert.equal(intent.routeIntentForMessage("Task nao dang pending?", { creativeWorkingState: activeCreativeState }), "cmo_default", "task status requests must not be forced into Creative");
assert.equal(intent.routeIntentForMessage("Doc link nay va tom tat giup minh https://example.com"), "cmo_default", "source/tool read requests must not be classified as creative");
assert.equal(intent.routeIntentForMessage("Minh muon doi thanh trai trung mau cam, nen sang hon", { creativeWorkingState: activeAssetCreativeState }), "creative_session", "asset-only Creative context must route refinement follow-up to CMO-native execute");
assert.equal(intent.routeIntentForMessage("Ok ban tao di", { creativeWorkingState: activeAssetCreativeState }), "creative_session", "asset-only Creative context must route confirmation follow-up to CMO-native execute");
assert.equal(intent.routeIntentForMessage("Conversion rate hom qua the nao?", { creativeWorkingState: activeAssetCreativeState }), "cmo_default", "asset context must not hijack analytics questions");

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
const threeTurnCreativeState = draftState.applySuggestedCreativeStateUpdate(
  undefined,
  draftState.extractSuggestedCreativeStateUpdate(turn1HermesResponse),
);
let threeTurnDecision = draftState.extractCreativeDecision(turn1HermesResponse);
assert.equal(threeTurnDecision.action, "propose_draft", "turn 1 must persist CMO propose_draft decision");
assert.equal(threeTurnCreativeState.active_draft_id, "creative_draft_001", "turn 1 must persist active draft id");
assert.equal(threeTurnCreativeState.drafts.length, 1, "turn 1 must persist draft without duplication");
const generatedAssetState = draftState.applyCreativeAssetStateUpdate(undefined, activeAssetCreativeState.assets);
assert.equal(generatedAssetState.active_asset_id, "creative_asset_001", "explicit generation must persist active Creative asset id");
assert.equal(generatedAssetState.assets.length, 1, "explicit generation must persist active Creative asset context");
assert.equal(generatedAssetState.assets[0].mime_type, "image/png", "explicit generation must persist Creative asset mime type");
assert.equal(generatedAssetState.assets[0].sha256, "a".repeat(64), "explicit generation must persist Creative asset sha256");
assert.equal(generatedAssetState.assets[0].bytes, 123456, "explicit generation must persist Creative asset bytes");

const visualInspectionAssetState = draftState.applyCreativeAssetStateUpdate(undefined, [{
  asset_id: "creative_asset_visual_qa",
  kind: "image",
  status: "stored",
  mime_type: "image/png",
  transport_status: "uploaded",
  render_url: "https://product.example/assets/visual-qa.png",
  sha256: "d".repeat(64),
  bytes: 456789,
  width: 1536,
  height: 864,
  format: "16:9",
  visual_summary: "Premium black hero image with a teal reward focal point.",
  visual_inspection: {
    status: "success",
    summary: "Hero composition is readable.",
    crop_channel_fit: {
      landing: "Safe for 16:9 landing crop.",
      x_post: "Keep CTA outside the tight center crop.",
      telegram: "Readable after downscale.",
    },
    defects: [],
  },
  dominant_palette: ["#020617", "#14b8a6"],
  detected_text: ["OPEN"],
  safe_crop_notes: { landing: "Keep the egg centered." },
}]);
assert.equal(visualInspectionAssetState.active_asset_id, "creative_asset_visual_qa", "visual QA asset must become active");
assert.deepEqual(visualInspectionAssetState.assets[0].visual_inspection.crop_channel_fit.x_post, "Keep CTA outside the tight center crop.", "visual inspection must persist in Creative state");
assert.equal(visualInspectionAssetState.assets[0].width, 1536, "visual QA asset width must persist");
assert.equal(visualInspectionAssetState.assets[0].height, 864, "visual QA asset height must persist");
assert.equal(visualInspectionAssetState.assets[0].format, "16:9", "visual QA asset format must persist");
assert.deepEqual(visualInspectionAssetState.assets[0].dominant_palette, ["#020617", "#14b8a6"], "dominant palette must persist");
assert.deepEqual(visualInspectionAssetState.assets[0].detected_text, ["OPEN"], "detected text must persist");

const directGeneratedAssetWithInferredMedia = {
  asset_id: "creative_asset_req_h6_msg_a1247a0c-e1b_001",
  status: "stored",
  bytes: 1651793,
  sha256: "a21e7197b6c3407790fccc3f0a70cfe0d184bbf4aad38de891f29795c603888e",
  operation: "responses image_generation",
  transport_status: "uploaded",
  render_url: "https://product.example/storage/v1/object/sign/cmo-creative-assets/tenant/workspace/app/job/creative.png?token=redacted",
  signed_url: "https://product.example/storage/v1/object/sign/cmo-creative-assets/tenant/workspace/app/job/creative.png?token=redacted",
  preview_url: "https://product.example/storage/v1/object/sign/cmo-creative-assets/tenant/workspace/app/job/creative.png?token=redacted",
  mime_type: null,
  storage_path: null,
};
const inferredDirectGeneratedState = draftState.applyCreativeAssetStateUpdate(undefined, [directGeneratedAssetWithInferredMedia]);
assert.equal(inferredDirectGeneratedState.assets.length, 1, "direct Product-backed generation with missing mime/storage_path must become a renderable Creative asset");
assert.equal(inferredDirectGeneratedState.assets[0].mime_type, "image/png", "direct Product-backed generation must infer image/png from Product preview URL");
assert.equal(inferredDirectGeneratedState.assets[0].kind, "image", "direct Product-backed generation must infer image kind");
assert.equal(inferredDirectGeneratedState.assets[0].product_backed, true, "direct Product-backed generation must normalize product_backed");
assert.equal(inferredDirectGeneratedState.assets[0].preview_available, true, "direct Product-backed generation must normalize preview availability");
assert.equal(inferredDirectGeneratedState.active_asset_id, "creative_asset_req_h6_msg_a1247a0c-e1b_001", "direct Product-backed generation must become active Creative asset id");
assert.equal(draftState.isProductBackedRenderableCreativeAsset(directGeneratedAssetWithInferredMedia), true, "missing explicit mime/storage_path must not block Product-backed renderability");

const duplicateCreativeAssetState = draftState.applyCreativeAssetStateUpdate(undefined, [
  activeAssetCreativeState.assets[0],
  {
    asset_id: "creative_creative_msg_e3077b07-c99_1",
    kind: "image",
    status: "stored",
    mime_type: "image/png",
    transport_status: "uploaded",
    render_url: "https://product.example/assets/asset_001.png",
    signed_url: "https://product.example/assets/asset_001.png?token=placeholder",
  },
]);
assert.equal(duplicateCreativeAssetState.active_asset_id, "creative_asset_001", "synthetic duplicate must not become active Creative asset id");
assert.equal(duplicateCreativeAssetState.assets.length, 1, "synthetic duplicate must be deduped from Creative working state");
assert.equal(duplicateCreativeAssetState.assets[0].asset_id, "creative_asset_001", "Product-backed asset must win duplicate Creative asset normalization");

const syntheticOnlyState = draftState.applyCreativeAssetStateUpdate(undefined, [
  {
    asset_id: "creative_creative_msg_a1247a0c-e1b_1",
    kind: "image",
    status: "stored",
    render_url: "https://product.example/storage/v1/object/sign/cmo-creative-assets/tenant/workspace/app/job/creative.png?token=redacted",
  },
]);
assert.equal(syntheticOnlyState, undefined, "synthetic-only Creative placeholders must not create active Creative state");

const sanitizedLoadedState = draftState.normalizeCreativeWorkingState({
  active_asset_id: "creative_creative_msg_e3077b07-c99_1",
  drafts: [],
  assets: [
    activeAssetCreativeState.assets[0],
    {
      asset_id: "creative_creative_msg_e3077b07-c99_1",
      kind: "image",
      status: "stored",
      mime_type: "image/png",
      transport_status: "uploaded",
      render_url: "https://product.example/assets/asset_001.png",
    },
  ],
});
assert.equal(sanitizedLoadedState.active_asset_id, "creative_asset_001", "session-load sanitization must repair stale synthetic active asset id");
assert.equal(sanitizedLoadedState.assets.length, 1, "session-load sanitization must keep only renderable Product-backed assets");

const editedAsset = {
  ...directGeneratedAssetWithInferredMedia,
  asset_id: "creative_asset_req_h6_msg_edit_001",
  render_url: "https://product.example/storage/v1/object/sign/cmo-creative-assets/tenant/workspace/app/job/edited.png?token=redacted",
  signed_url: "https://product.example/storage/v1/object/sign/cmo-creative-assets/tenant/workspace/app/job/edited.png?token=redacted",
  preview_url: "https://product.example/storage/v1/object/sign/cmo-creative-assets/tenant/workspace/app/job/edited.png?token=redacted",
  sha256: "b21e7197b6c3407790fccc3f0a70cfe0d184bbf4aad38de891f29795c603888e",
};
const stateAfterEdit = draftState.applyCreativeAssetStateUpdate(inferredDirectGeneratedState, [editedAsset]);
assert.equal(stateAfterEdit.assets.length, 2, "repeated edit flow must retain direct generation and edited Product-backed assets");
assert.equal(stateAfterEdit.active_asset_id, "creative_asset_req_h6_msg_edit_001", "latest edited Product-backed asset must become active reference asset");
const stateAfterThirdEdit = draftState.applyCreativeAssetStateUpdate(stateAfterEdit, [{
  ...editedAsset,
  asset_id: "creative_asset_req_h6_msg_edit_002",
  render_url: "https://product.example/storage/v1/object/sign/cmo-creative-assets/tenant/workspace/app/job/edited-2.png?token=redacted",
  signed_url: "https://product.example/storage/v1/object/sign/cmo-creative-assets/tenant/workspace/app/job/edited-2.png?token=redacted",
  preview_url: "https://product.example/storage/v1/object/sign/cmo-creative-assets/tenant/workspace/app/job/edited-2.png?token=redacted",
  sha256: "c21e7197b6c3407790fccc3f0a70cfe0d184bbf4aad38de891f29795c603888e",
}]);
assert.equal(stateAfterThirdEdit.active_asset_id, "creative_asset_req_h6_msg_edit_002", "third edit must use the latest edited Product-backed asset, not the original");

const turn2Message = "Walk me through the concept before making anything";
assert.equal(intent.routeIntentForMessage(turn2Message, { creativeWorkingState: threeTurnCreativeState }), "creative_session", "turn 2 must send history and state back to CMO");
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
assert.equal(threeTurnDecision.action, "present_draft", "turn 2 decision must come from Hermes CMO response");
assert.match(turn2HermesResponse.answer.body, /World Cup egg visual/, "turn 2 answer should be Hermes-provided draft content");

const turn3Message = "Create the image from that prompt";
assert.equal(intent.routeIntentForMessage(turn3Message, { creativeWorkingState: threeTurnCreativeState }), "creative_session", "turn 3 must still send state/capabilities, not Product execution intent");
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

requireSource(mapperSource, /creativeWorkingState\?: CmoCreativeWorkingState;/, "Hermes mapper input");
requireSource(mapperSource, /creativeIdeationDetected\?: boolean;/, "Hermes mapper ideation input");
requireSource(mapperSource, /creativeSessionFollowupDetected\?: boolean;/, "Hermes mapper session input");
requireSource(mapperSource, /messages: recentConversationMessages\(input\.history\)/, "Hermes mapper must send recent messages");
requireSource(mapperSource, /creativeWorkingStateForHermesCamelCase/, "Hermes mapper must build camelCase creativeWorkingState");
requireSource(mapperSource, /creativeWorkingState: creativeWorkingStateCamelCase/, "Hermes mapper must send camelCase creativeWorkingState");
requireSource(mapperSource, /creative_working_state: creativeWorkingStateForHermes/, "Hermes mapper must send snake_case creative_working_state");
requireSource(mapperSource, /activeAssetId: state\.active_asset_id \?\? null/, "Hermes mapper must send camelCase activeAssetId");
requireSource(mapperSource, /assets: \(state\.assets \?\? \[]\)\.map/, "Hermes mapper must send Creative asset context");
requireSource(mapperSource, /creativeReferenceAssetsForHermes/, "Hermes mapper must build reference assets from active Creative state");
requireSource(mapperSource, /reference_assets: creativeReferenceAssets/, "Hermes mapper must send snake_case reference_assets");
requireSource(mapperSource, /referenceAssets: creativeReferenceAssets/, "Hermes mapper must send camelCase referenceAssets alias");
requireSource(mapperSource, /role: "source_image"/, "Hermes mapper must mark reference asset source role");
requireSource(mapperSource, /fetch_url: creativeAssetDownloadFetchUrl\(appId, activeAsset\.asset_id\)/, "Hermes mapper must use Product download route as reference fetch_url");
requireSource(mapperSource, /\/api\/cmo\/apps\/\$\{encodeURIComponent\(appId\)\}\/creative\/assets\/\$\{encodeURIComponent\(assetId\)\}\/download/, "Hermes mapper must use Product same-origin asset download route");
requireSource(mapperSource, /active_creative_context_present: true/, "Hermes mapper must trace active Creative context");
requireSource(mapperSource, /active_creative_asset_id: creativeWorkingStateForHermes\.active_asset_id \?\? null/, "Hermes mapper must trace active Creative asset id");
requireSource(mapperSource, /creative_assets_count: creativeWorkingStateForHermes\.assets\?\.length \?\? 0/, "Hermes mapper must trace Creative asset count");
requireSource(mapperSource, /reference_assets_count: creativeReferenceAssets\.length/, "Hermes mapper must trace reference asset count");
requireSource(mapperSource, /reference_asset_fetch_url_present: creativeReferenceAssets\.some/, "Hermes mapper must trace reference asset fetch_url");
requireSource(mapperSource, /reference_asset_sha256_present: creativeReferenceAssets\.some/, "Hermes mapper must trace reference asset sha256");
requireSource(mapperSource, /reference_asset_bytes_present: creativeReferenceAssets\.some/, "Hermes mapper must trace reference asset bytes");
requireSource(mapperSource, /creative_session_from_asset: Boolean/, "Hermes mapper must trace asset-origin Creative session");
requireSource(mapperSource, /creativeSession: true/, "Hermes mapper must mark Creative session ownership");
requireSource(mapperSource, /cmoOwnsCreativeDecision: true/, "Hermes mapper must mark CMO decision ownership");
requireSource(mapperSource, /creativeDecisionOwnerWhenLive: "hermes_cmo"/, "Hermes mapper must mark Creative decision owner");
requireSource(mapperSource, /canProposeDraft: true/, "Hermes mapper capabilities must expose CMO-owned draft proposal permission");
requireSource(mapperSource, /canUpdateDraftState: true/, "Hermes mapper capabilities must expose CMO-owned draft state permission");
requireSource(mapperSource, /canExecuteImageGeneration: true/, "Hermes mapper capabilities must expose CMO-owned image generation permission");
requireSource(mapperSource, /canInspectImage: true/, "Hermes mapper capabilities must expose visual inspection permission");
requireSource(mapperSource, /requiresUserConfirmationBeforeExecute: true/, "Hermes mapper capabilities");
requireSource(mapperSource, /creativeMutationAllowed: true/, "Hermes mapper must send side-effect permission, not a Product action decision");
requireSource(mapperSource, /requiresExplicitUserIntentForMutation: true/, "Hermes mapper must require explicit user mutation intent");
requireSource(mapperSource, /product_intent_hint: productIntentHint/, "Hermes mapper may send non-authoritative Product intent hints");
requireSource(mapperSource, /creative_side_effects_allowed: true/, "Hermes mapper must leave Creative action choice to CMO");
requireSource(mapperSource, /requires_user_confirmation_before_creative_execute: true/, "Hermes mapper must mirror confirmation boundary");
requireSource(mapperSource, /product_must_not_choose_creative_execution: true/, "Hermes mapper must keep CMO as execution decision owner");
requireSource(mapperSource, /creative_decision_owner_when_live: "hermes_cmo"/, "Hermes mapper product boundary");
forbidSource(mapperSource, /creative_session_followup_intent/, "Hermes mapper must not expose Product Creative action intent");
forbidSource(mapperSource, /creativeSessionExecuteDraftCandidate/, "Hermes mapper must not derive Product execute candidates");
forbidSource(mapperSource, /execute_decision_candidate/, "Hermes mapper must not send Product execute candidate");
forbidSource(mapperSource, /creativeDirectExecutionPermissionContract/, "Hermes mapper must not send Product-owned direct execution contract");
forbidSource(mapperSource, /creative_execution_intent/, "Hermes mapper must not send Product-owned Creative execution intent");
requireSource(mapperSource, /creative_decision_context/, "Hermes mapper must provide Creative decision context without choosing action");
forbidSource(mapperSource, /intent: "execute_draft"/, "Hermes mapper must not send execute_draft intent");

requireSource(runtimeSource, /requestHasCreativeWorkingState/, "runtime");
requireSource(runtimeSource, /Array\.isArray\(state\.assets\) && state\.assets\.length > 0/, "runtime must treat asset-only Creative context as working state");
requireSource(runtimeSource, /requestIsCreativeIdeation/, "runtime");
requireSource(runtimeSource, /requestMayLeadToCreativeExecution/, "runtime");
requireSource(runtimeSource, /const cmoOwnedCreativeCapability = requestHasCmoOwnedCreativeCapability\(request\)/, "runtime must recognize CMO-owned Creative capability envelope");
requireSource(runtimeSource, /const creativeNativeSession = creativeIdeationDetected \|\| creativeWorkingStatePresent \|\| cmoOwnedCreativeCapability;/, "runtime must treat Creative state and CMO-owned capability as native session");
requireSource(runtimeSource, /requestAllowsCreativeMutationByPolicy\(request\)/, "runtime must read side-effect policy for fresh CMO-owned Creative turns");
requireSource(runtimeSource, /artifactTransportAllowed[\s\S]{0,160}artifact_transport: creativeArtifactTransportForRequest\(request\)/, "runtime must include Product artifact transport for Creative and unified CMO agent requests");
requireSource(runtimeSource, /requestIsCreativeLongRunningTurn/, "runtime must classify Creative long-running turns centrally");
requireSource(runtimeSource, /decision !== "creative_session"[\s\S]*return false/, "runtime long-running classifier must scope session checks to Creative sessions");
requireSource(runtimeSource, /requestReferenceAssets\(request\)\.length > 0/, "runtime must use Creative timeout for session turns with reference assets");
requireSource(runtimeSource, /Boolean\(requestActiveCreativeAssetId\(request\)\)/, "runtime must use Creative timeout for session turns with active assets");
requireSource(runtimeSource, /requestCreativeAssetsCount\(request\) > 0/, "runtime must use Creative timeout for session turns with stored Creative assets");
requireSource(runtimeSource, /requestArtifactTransportMode\(request\) === "product_upload"/, "runtime must use Creative timeout for session turns with Product artifact transport");
requireSource(runtimeSource, /requestHasCmoOwnedCreativeCapability\(request\)/, "runtime must use Creative timeout for fresh CMO-owned Creative capability turns");
requireSource(runtimeSource, /creativeLongRunningTurn[\s\S]*getCmoHermesCreativeExecuteTimeoutMs\(\)/, "runtime must apply Creative timeout to long-running Creative turns");
requireSource(runtimeSource, /creative_long_running_turn: config\.creativeLongRunningTurn/, "runtime trace must include Creative long-running diagnostic");
requireSource(runtimeSource, /creative_timeout_ms: config\.timeoutMs/, "runtime trace must include Creative timeout diagnostic");
requireSource(runtimeSource, /workspace_fallback_suppressed_for_creative/, "runtime trace must suppress workspace fallback for Creative-native turns");
requireSource(runtimeSource, /creative_side_effects_allowed: creativeSideEffectsAllowed/, "runtime must trace Creative side-effect capability");
requireSource(runtimeSource, /requires_user_confirmation_before_creative_execute: creativeNativeSession/, "runtime must trace confirmation boundary");
requireSource(runtimeSource, /active_creative_context_present: activeCreativeContextPresent/, "runtime must trace active Creative context");
requireSource(runtimeSource, /active_creative_asset_id: constraints\.active_creative_asset_id/, "runtime must trace active Creative asset id");
requireSource(runtimeSource, /creative_assets_count: creativeAssetsCount/, "runtime must trace Creative assets count");
requireSource(runtimeSource, /reference_assets_count: referenceAssets\.length/, "runtime must trace reference asset count");
requireSource(runtimeSource, /reference_asset_fetch_url_present/, "runtime must trace reference asset fetch_url");
requireSource(runtimeSource, /reference_asset_sha256_present/, "runtime must trace reference asset sha256");
requireSource(runtimeSource, /reference_asset_bytes_present/, "runtime must trace reference asset bytes");
requireSource(runtimeSource, /route_overrode_tool_execute_due_to_creative_context/, "runtime must trace Creative context route override");
requireSource(runtimeSource, /tool_execute_suppressed_for_creative_followup/, "runtime must trace tool-execute suppression for Creative follow-up");
requireSource(runtimeSource, /creative_execution_requested: creativeExecutionRequested/, "runtime must preserve explicit Creative execution path");
requireSource(runtimeSource, /\.\.\.\(creativeExecutionRequested \? \{ allowCreativeExecution: true \} : \{\}\)/, "runtime may expose legacy allow only for explicit Creative execution");
requireSource(runtimeSource, /"blocked"/, "runtime must accept blocked creative session decisions");
requireSource(runtimeSource, /requestAllowsCreativeIdeationAnswerBasis/, "runtime validation");
requireSource(runtimeSource, /routeDecision === "creative_ideation"[\s\S]*routeDecision === "creative_session"/, "runtime validation must require creative route decision");
requireSource(runtimeSource, /requestCreativeFlagIsTrue\(request, "cmo_owns_creative_decision"\)/, "runtime validation must require CMO decision ownership");
requireSource(runtimeSource, /requestAllowsCmoOwnedCreativeExecutionAnswerBasis/, "runtime must validate CMO-owned Creative execution answer basis");
requireSource(runtimeSource, /answerBasis\.mode === "creative_execution"[\s\S]*routeDecision === "creative_session"[\s\S]*requestIsCreativeLongRunningTurn/, "runtime must scope creative_execution answer basis to Creative session execution context");
requireSource(runtimeSource, /requestHasCmoCreativeDecisionOwner\(request\)/, "runtime must require Hermes CMO decision ownership for CMO-owned execution");
requireSource(runtimeSource, /requestArtifactTransportMode\(request\) === "product_upload"/, "runtime must require Product artifact transport for CMO-owned execution");
requireSource(runtimeSource, /responseHasCreativeExecutionResult\(response, structuredOutput\)/, "runtime must require execution result evidence for CMO-owned execution");
requireSource(runtimeSource, /normalizeHermesCmoOwnedCreativeExecutionResponse/, "runtime must canonicalize CMO-owned Creative execution before M1 validation");
requireSource(runtimeSource, /normalizeHermesCmoOwnedCreativeExecutionResponse\([\s\S]*rawValidationCandidate[\s\S]*normalizeHermesCreativeIdeationResponse/, "runtime must run CMO-owned Creative execution canonicalization before ideation canonicalization");
requireSource(runtimeSource, /creativeExecutionCanonicalization\.canonicalized[\s\S]*canonicalized: false[\s\S]*normalizeHermesCreativeIdeationResponse/, "runtime must skip ideation canonicalization when execution canonicalization matched");
requireSource(runtimeSource, /safeCreativeExecutionRawActivityTypes/, "runtime must define safe Creative execution activity events");
requireSource(runtimeSource, /creativeExecutionEventToProductEvent/, "runtime must normalize Creative execution activity events separately");
requireSource(runtimeSource, /creative_execution_response_received: true/, "runtime must trace accepted CMO-owned Creative execution response");
requireSource(runtimeSource, /creative_execution_owner: "cmo"/, "runtime must trace CMO as Creative execution owner");
requireSource(runtimeSource, /creative_execution_canonicalized: true/, "runtime must trace Creative execution canonicalization");
requireSource(runtimeSource, /activity_events_allowed_for_creative_execution: true/, "runtime must trace Creative execution activity allowance");
requireSource(runtimeSource, /m1_validation_result: "accepted"/, "runtime must trace accepted M1 validation for CMO-owned Creative execution");
requireSource(runtimeSource, /normalizeHermesCreativeIdeationResponse/, "runtime must canonicalize Creative ideation before M1 validation");
requireSource(runtimeSource, /safeCreativeIdeationRawActivityTypes/, "runtime creative ideation canonicalizer");
requireSource(runtimeSource, /"creative\.ideation\.draft_proposed"/, "runtime activity validation must accept draft proposed event");
requireSource(runtimeSource, /creativeIdeationEventToProductEvent/, "runtime must map raw creative ideation events to Product-safe activity events");
requireSource(runtimeSource, /creativeNativeAnswerBasisModes/, "runtime canonicalizer must support native creative session modes");
requireSource(runtimeSource, /creative_session_response_received/, "runtime diagnostics must trace creative session responses");
requireSource(runtimeSource, /rejected_by_m1_validator: false/, "runtime diagnostics must mark accepted ideation responses");
forbidSource(runtimeSource, /requestIsCreativeSessionExecuteCandidate/, "runtime must not derive Product execute candidates");
forbidSource(runtimeSource, /creative_session_followup_intent/, "runtime must not consume Product Creative action intent");
forbidSource(runtimeSource, /creative_session_execute_candidate/, "runtime must not trace Product execute candidates");
forbidSource(runtimeSource, /creative_session_execution_allowed/, "runtime must not trace Product execution allowance");
forbidSource(runtimeSource, /allow_creative_execution/, "runtime must not emit legacy snake allow flag for CMO-native sessions");
forbidSource(runtimeSource, /const answerBasisModes = new Set[\s\S]*"creative_ideation"[\s\S]*\]\);[\s\S]*const answerFormats/s, "runtime must not globally allow creative_ideation answer basis");
forbidSource(runtimeSource, /const activityTypes = new Set[\s\S]*"creative\.ideation\.draft_proposed"[\s\S]*\]\);[\s\S]*const creativeLifecycleActivityTypes/s, "runtime must not globally allow creative ideation activity events");

requireSource(storeSource, /let creativeWorkingState: CmoCreativeWorkingState \| undefined = normalizeCreativeWorkingState\(continuedSession\?\.creativeWorkingState\);/, "store session state must sanitize loaded Creative working state");
requireSource(storeSource, /applyCreativeAssetStateUpdate/, "store must persist Creative assets into working state");
requireSource(storeSource, /let turnCreativeArtifacts: Record<string, unknown>\[] = \[];/, "store must track current-turn Creative artifacts separately");
requireSource(storeSource, /turnCreativeArtifacts = creativeArtifacts;/, "store must capture current-turn Creative artifacts");
requireSource(storeSource, /\.\.\.\(turnCreativeArtifacts\.length \? \{ sessionArtifacts: turnCreativeArtifacts \} : \{\}\)/, "assistant message must render only current-turn Creative artifacts");
forbidSource(storeSource, /\.\.\.\(sessionArtifacts\.length \? \{ sessionArtifacts \} : \{\}\),[\s\S]{0,900}contextUsedCount:/, "assistant message must not render merged session artifacts as current turn assets");
requireSource(storeSource, /resolveActiveCreativeAsset\(continuedSession\)/, "store must resolve active Creative asset before routing");
requireSource(storeSource, /activeCreativeAssetResolution\.asset[\s\S]*applyCreativeAssetStateUpdate/, "store must hydrate working state from resolved asset");
requireSource(storeSource, /const productPredictedCreativeLongRunningTurn =[\s\S]*hermesCmoRoute\.reason === "creative_execution"[\s\S]*!hermesCmoUnifiedAgentRequested && hermesCmoRoute\.reason === "creative_session"/, "store must classify Product-owned Creative execution/session turns as long-running without leaking unified advisory turns");
requireSource(storeSource, /const hermesCmoCreativeLongRunningTurn = productPredictedCreativeLongRunningTurn;/, "store must keep predicted Creative timeout handling explicit");
requireSource(storeSource, /const creativeTimeout = hermesCmoCreativeLongRunningTurn && isTimedOutHermesError\(reason\)/, "store must handle Creative session timeout without workspace fallback");
requireSource(storeSource, /workspace_fallback_suppressed_for_creative: true/, "store must trace workspace fallback suppression for Creative turns");
requireSource(storeSource, /timeoutMs = currentTurnCreativeLongRunningTurn \? hermesResult\.hermesCmoEndpointTimeoutMs : undefined/, "store must persist Creative long-running timeout metadata from the current Hermes response on success");
requireSource(storeSource, /currentTurnCreativeLongRunningTurn =[\s\S]*!unifiedCurrentTurnTextAnswer && \(hermesCmoCreativeLongRunningTurn \|\| hermesCreativeExecutionResponseReceived\)/, "unified text-only advisory responses must clear Creative long-running metadata for the current turn");
requireSource(storeSource, /creativeWorkingState,/, "store must pass creative state to router and Hermes");
requireSource(storeSource, /activeCreativeAssetId = creativeWorkingState\?\.active_asset_id/, "store must track active Creative asset id");
requireSource(storeSource, /activeCreativeAssetResolutionSource: activeCreativeAssetResolution\.source/, "store must pass active asset resolution source to Hermes mapper");
requireSource(storeSource, /creativeAssetsCount = creativeWorkingState\?\.assets\?\.length \?\? 0/, "store must track Creative assets count");
requireSource(storeSource, /routeOverrodeToolExecuteDueToCreativeContext/, "store must trace Creative context route override");
requireSource(storeSource, /toolExecuteSuppressedForCreativeFollowup/, "store must trace tool-execute suppression");
requireSource(storeSource, /hermesCmoRoute\.reason === "creative_ideation"/, "store must treat creative ideation as CMO-native creative");
requireSource(storeSource, /hermesCmoRoute\.reason === "creative_session"/, "store must treat creative session as CMO-native creative");
requireSource(storeSource, /creativeWorkingStateForHermes =[\s\S]{0,120}hermesCmoNativeCreativeRequested \|\| hermesCmoUnifiedAgentRequested \? creativeWorkingState : undefined/, "store must send creative state on native Creative or unified CMO agent turns");
requireSource(storeSource, /creativeSessionFollowupDetected,/, "store must pass Creative session transport flag to Hermes");
requireSource(storeSource, /creativeWorkingState: creativeWorkingStateForHermes/, "store must pass creativeWorkingState to Hermes mapper only on creative turns");
requireSource(storeSource, /applySuggestedCreativeStateUpdate\([\s\S]*extractSuggestedCreativeStateUpdate\(hermesResult\.response\)/, "store must apply Hermes suggested state update");
requireSource(storeSource, /extractCreativeDecision\(hermesResult\.response\)/, "store must persist creative decision");
requireSource(storeSource, /creative_session_response_received/, "store must persist creative session diagnostics");
requireSource(storeSource, /creative_state_persisted: creativeStatePersisted/, "store must persist creative state persistence diagnostics");
requireSource(mapperSource, /creative_state_update_present: creativeStateUpdatePresent/, "mapper must expose creative state update diagnostics");
requireSource(mapperSource, /creative_decision_present: creativeDecisionPresent/, "mapper must expose creative decision diagnostics");
requireSource(mapperSource, /creative_session_canonicalized/, "mapper must expose creative session canonicalization diagnostics");
requireSource(mapperSource, /creative_long_running_turn: result\.creativeLongRunningTurn/, "mapper must expose Creative long-running diagnostics");
requireSource(mapperSource, /artifact_transport_mode: artifactTransportMode/, "mapper must expose artifact transport mode diagnostics");
requireSource(mapperSource, /creativeExecutionResponseReceived = answerBasisMode === "creative_execution"/, "mapper must detect CMO-owned Creative execution responses");
requireSource(mapperSource, /creative_execution_response_received: true/, "mapper must expose Creative execution response diagnostics");
requireSource(mapperSource, /creative_execution_requested: false/, "mapper must preserve Product non-request ownership boundary");
requireSource(mapperSource, /activity_events_allowed_for_creative_execution/, "mapper must expose Creative execution activity diagnostics");
requireSource(mapperSource, /creative_execution_canonicalized/, "mapper must expose Creative execution canonicalization diagnostics");

requireSource(uiSource, /renderCreativeAssets\(message\)/, "UI must keep rendering creative assets");
requireSource(uiSource, /Using reference image/, "UI must show neutral reference image badge instead of old asset card");
requireSource(uiSource, /Creative draft updated/, "UI must show neutral draft update badge for refine-only turns");
requireSource(uiSource, /if \(!assets\.length\)/, "UI must not render Creative asset card when current turn has no new assets");
requireSource(uiSource, /message\.routeDecision === "creative_session"[\s\S]*message\.routeDecision === "creative_ideation"[\s\S]*message\.routeDecision === "creative_execution"/, "UI neutral Creative badges must be gated to Creative-native turns");
requireSource(uiSource, /const assets = creativeAssetRecords\(message\)/, "UI asset cards must come from current assistant message artifacts");
forbidSource(storeSource, /Ok b[a-z]*n t[a-z]*o [a-z]*i|message\s*={2,3}\s*["'`]Ok b/i, "Product store");
forbidSource(storeSource, /callCreative|executeCreative|Creative Agent direct/i, "Product store must not call Creative directly");

console.log("M13D Creative draft state contract passed");
