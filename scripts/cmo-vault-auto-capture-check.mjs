import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ts from "typescript";

const tempVault = mkdtempSync(join(tmpdir(), "cmo-engine-vault-auto-"));
const tempBuild = mkdtempSync(join(tmpdir(), "cmo-engine-vault-auto-build-"));
process.env.CMO_ENGINE_VAULT_PATH = tempVault;

function transpileCmoModule(filename) {
  const source = readFileSync(join("src", "lib", "cmo", filename), "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      esModuleInterop: true,
      importsNotUsedAsValues: ts.ImportsNotUsedAsValues.Remove,
    },
    fileName: filename,
  }).outputText;
  writeFileSync(join(tempBuild, filename.replace(/\.ts$/, ".js")), output);
}

for (const filename of [
  "user-metadata.ts",
  "vault-auto-capture.ts",
  "vault-capture-preview.ts",
  "vault-capture-writer.ts",
  "vault-capture-paths.ts",
  "vault-capture-renderer.ts",
  "vault-capture-redaction.ts",
  "vault-capture-types.ts",
]) {
  transpileCmoModule(filename);
}

writeFileSync(join(tempBuild, "supabase-indexing.js"), "exports.indexVaultCapture = async function indexVaultCapture() { return { ok: true, skipped: true }; };\n");

const requireFromBuild = createRequire(join(tempBuild, "entry.js"));
const { autoCaptureTurnOnce } = requireFromBuild("./vault-auto-capture.js");
const { buildManualCapturePreview } = requireFromBuild("./vault-capture-preview.js");
const { __vaultCaptureWriterTest } = requireFromBuild("./vault-capture-writer.js");
const { applyServerUserIdentity } = requireFromBuild("./user-metadata.js");

function request(message = "generic") { return { workspaceId: "holdstation", appId: "holdstation-mini-app", appName: "Holdstation Mini App", message, topic: message }; }
const serverIdentity = { authMode: "supabase", userId: "00000000-0000-4000-8000-000000000005", userEmail: "jay@example.test", userDisplayName: "Jay", userSlug: "user_jay", createdByUserId: "00000000-0000-4000-8000-000000000005", createdByEmail: "jay@example.test" };
const browserLikeEchoAnswer = "## Echo Output\n\n### Post 1\nLaunch the Mini App activation loop.\n\n### Post 2\nMake the next user journey obvious.";
function session(id, topic = "Holdstation Mini App") { return { id: `session_${id}`, appId: "holdstation-mini-app", appName: "Holdstation Mini App", topic, authMode: serverIdentity.authMode, userId: serverIdentity.userId, userEmail: serverIdentity.userEmail, createdByUserId: serverIdentity.createdByUserId, createdByEmail: serverIdentity.createdByEmail, messages: [], contextUsed: [], missingContext: [], status: "completed", createdAt: "2026-05-25T17:00:00Z", updatedAt: "2026-05-25T17:00:00Z", isDevelopmentFallback: false, isRuntimeFallback: false, runtimeStatus: "live", runtimeMode: "live", contextQualitySummary: { selectedCount: 0, existingCount: 0, missingCount: 0, confirmedCount: 0, draftCount: 0, placeholderCount: 0 }, assumptions: [], suggestedActions: [], savedToVault: false }; }
function md(relativePath) { return readFileSync(join(tempVault, relativePath), "utf8"); }
async function capture(kind, message, answer, runtimeLabel = "", runtimeAgent = "cmo", extras = {}) { return autoCaptureTurnOnce({ request: request(message), session: session(kind), assistantMessageId: `msg_${kind}`, sourceUserMessageId: `user_${kind}`, userIdentity: serverIdentity, answer, routeKind: "app-chat-response", runtimeSource: "dashboard", assistantFooterSourceLabel: runtimeLabel, runtimeLabel, runtimeProvider: "dashboard", runtimeAgent, ...extras }); }

const echo = await capture("echo", "/echo Write 2 short X posts about Holdstation Mini App activation.", "## Echo Output\nDraft 1: hello\nDraft 2: gm", "Live - echo");
assert.equal(echo.ok, true); assert.equal(echo.captureType, "echo_output"); assert.match(echo.relativePath, /07 Content Outputs\/Echo/); assert.doesNotMatch(echo.relativePath, /05 Social Signals\/Surf X|06 Trend Signals\/Last30Days/);

const fanoutSession = session("fanout", "echo-write-2-short-x-posts-about-holdstation-mini-app-activation");
const fanoutRequest = request("/echo Write 2 short X posts about Holdstation Mini App activation.");
const fanoutEcho = await autoCaptureTurnOnce({ request: fanoutRequest, session: fanoutSession, assistantMessageId: "msg_fanout_echo", sourceUserMessageId: "user_fanout", userIdentity: serverIdentity, answer: browserLikeEchoAnswer, routeKind: "app-chat-response", runtimeSource: "dashboard", runtimeLabel: "Live - echo", runtimeProvider: "dashboard", runtimeAgent: "echo" });
assert.equal(fanoutEcho.ok, true); assert.equal(fanoutEcho.captureType, "echo_output"); assert.match(fanoutEcho.relativePath, /07 Content Outputs\/Echo/);
const fanoutSurfX = await autoCaptureTurnOnce({ request: fanoutRequest, session: fanoutSession, assistantMessageId: "msg_fanout_surfx", sourceUserMessageId: "user_fanout", answer: "X Search was used. Surf X signal.", proposedCaptureType: "surf_x_signal", routeKind: "derived-secondary-test", runtimeSource: "dashboard", runtimeLabel: "Live - surf-x", runtimeProvider: "dashboard", runtimeAgent: "surf-x" });
assert.equal(fanoutSurfX.skipped, true); assert.equal(fanoutSurfX.skipReason, "auto_capture_skipped_secondary_for_turn"); assert.equal(fanoutSurfX.savedToVault, false);
const fanoutTrend = await autoCaptureTurnOnce({ request: fanoutRequest, session: fanoutSession, assistantMessageId: "msg_fanout_trend", sourceUserMessageId: "user_fanout", answer: "Last30Days trend signal.", proposedCaptureType: "last30days_trend", routeKind: "derived-secondary-test", runtimeSource: "dashboard", runtimeLabel: "Live - last30days", runtimeProvider: "dashboard", runtimeAgent: "surf-last30days" });
assert.equal(fanoutTrend.skipped, true); assert.equal(fanoutTrend.skipReason, "auto_capture_skipped_secondary_for_turn"); assert.equal(fanoutTrend.savedToVault, false);
assert.match(fanoutEcho.relativePath, /07 Content Outputs\/Echo/);
assert.doesNotMatch(fanoutSurfX.relativePath ?? "", /05 Social Signals\/Surf X/);
assert.doesNotMatch(fanoutTrend.relativePath ?? "", /06 Trend Signals\/Last30Days/);
assert.equal(readdirSync(join(tempVault, ".cmo-auto-capture-index")).filter((name) => name.startsWith("turn_session_fanout_user_fanout")).length, 1);

let text = md(echo.relativePath);
assert.match(text, /auto-capture/); assert.match(text, /raw-capture/); assert.doesNotMatch(text, /capture-preview/); assert.match(text, /auth_mode: "supabase"/); assert.match(text, /user_id: "00000000-0000-4000-8000-000000000005"/); assert.match(text, /user_email: "jay@example.test"/); assert.match(text, /user_slug: "jay"/); assert.match(text, /user_display_name: "Jay"/); assert.match(text, /email: "jay@example.test"/); assert.match(text, /source_user_message_id: "user_echo"/); assert.match(text, /visibility: "workspace"/); assert.match(text, /capture_origin: "auto"/); assert.match(text, /gbrain_status: "pending"/);
assert.doesNotMatch(text, /user_slug: "holdstation"|user_slug: "user_jay"/);
assert.equal(readdirSync(join(tempVault, ".cmo-auto-capture-index")).filter((name) => name.includes("msg_echo")).length, 1);

const echoByCommand = await capture("echo_command", "/echo Write 2 short X posts about Holdstation Mini App activation.", "Draft 1: X post copy without explicit Echo marker");
assert.equal(echoByCommand.captureType, "echo_output"); assert.match(echoByCommand.relativePath, /07 Content Outputs\/Echo/); assert.doesNotMatch(echoByCommand.relativePath, /05 Social Signals\/Surf X|06 Trend Signals\/Last30Days/);

const surfX = await capture("surfx", "/x World App mini apps DeFi", "X Search was used. Surf X used weak chatter.");
assert.equal(surfX.captureType, "surf_x_signal"); assert.equal(surfX.sourceClass, "social_signal"); assert.match(surfX.relativePath, /05 Social Signals\/Surf X/); assert.match(md(surfX.relativePath), /social signal/i);
const trend = await capture("trend", "/trend World App mini apps DeFi", "Last30Days sandbox trend signal");
assert.equal(trend.captureType, "last30days_trend"); assert.equal(trend.sourceClass, "weak_trend_signal"); assert.match(trend.relativePath, /06 Trend Signals\/Last30Days/); assert.match(md(trend.relativePath), /weak trend signal/i);
const pulse = await capture("pulse_case", "/pulse World App mini apps DeFi", "Pulse used branch summary");
assert.equal(pulse.ok, true, pulse.error); assert.equal(pulse.captureType, "pulse_pack"); assert.match(pulse.relativePath ?? "", /06 Trend Signals\/Last30Days/);
const echoByBridgeMetadata = await capture("echo_bridge", "Draft 2 X posts about World App mini apps DeFi", "### Post 1\nCopy one\n\n### Post 2\nCopy two", "CMO → Hermes Echo Orchestration", "echo");
assert.equal(echoByBridgeMetadata.captureType, "echo_output"); assert.match(echoByBridgeMetadata.relativePath, /07 Content Outputs\/Echo/);
const surfResearch = await capture("surf_research", "/surf Research MiniKit wallet auth", "Research pack with official source-backed notes.");
assert.equal(surfResearch.captureType, "surf_research"); assert.match(surfResearch.relativePath, /04 Research\/Surf Packs/);
const cmo = await capture("cmo", "what next", "Here is a general strategic answer.");
assert.equal(cmo.captureType, "cmo_session"); assert.match(md(cmo.relativePath), /review_status: "raw"/); assert.doesNotMatch(md(cmo.relativePath), /review_status: "promoted"|cmo_approved|jay_approved/);
const dup = await autoCaptureTurnOnce({ request: request("/echo Write changed X post"), session: session("echo"), assistantMessageId: "msg_echo", userIdentity: serverIdentity, answer: "changed content", runtimeLabel: "Live - echo", runtimeProvider: "dashboard", runtimeAgent: "echo" });
assert.equal(dup.duplicate, true);
assert.equal(echo.relativePath, dup.relativePath);
const preview = buildManualCapturePreview(applyServerUserIdentity({ eventType: "last30days_trend", content: "Draft 1", appId: "holdstation-mini-app", userId: "client-spoof" }, serverIdentity));
assert.equal(preview.savedToVault, false); assert.match(preview.target.relativePath, /06 Trend Signals\/Last30Days/);
assert.match(preview.markdown, /user_id: "00000000-0000-4000-8000-000000000005"/);
assert.doesNotMatch(preview.markdown, /client-spoof/);
const echoAfterPreview = await capture("echo_after_preview", "/echo Write 2 short X posts", "Draft 1: X post copy after preview selector", "Live - last30days stale preview", "surf-last30days");
assert.equal(echoAfterPreview.captureType, "echo_output"); assert.match(echoAfterPreview.relativePath, /07 Content Outputs\/Echo/);
const redacted = await capture("secret", "generic", "Use Bearer abcdefghijklmnopqrstuvwxyz123456 and api_key=abcdefghijklmnopqrstuvwxyz");
text = md(redacted.relativePath);
assert.doesNotMatch(text, /abcdefghijklmnopqrstuvwxyz123456/); assert.match(text, /redaction_applied: true/); assert.match(text, /bearer_token/);
assert.equal(readdirSync(tempVault).some((name) => name.toLowerCase().includes("holdstation")), false);
assert.throws(() => __vaultCaptureWriterTest.assertSafeTarget({ vaultId: "cmo-engine", vaultPath: tempVault, relativePath: "../bad.md", folder: "03 Sessions/Raw", filename: "bad.md", collisionPolicy: "append-counter" }, tempVault));
const previewRoute = readFileSync("src/app/api/cmo/vault/capture-preview/route.ts", "utf8");
const saveRoute = readFileSync("src/app/api/cmo/vault/capture-save/route.ts", "utf8");
assert.match(previewRoute, /getServerUserIdentity/);
assert.match(previewRoute, /applyServerUserIdentity/);
assert.match(saveRoute, /getServerUserIdentity/);
assert.match(saveRoute, /applyServerUserIdentity/);
rmSync(tempVault, { recursive: true, force: true });
rmSync(tempBuild, { recursive: true, force: true });
console.log("CMO vault auto-capture checks passed using temp vault:", tempVault);
