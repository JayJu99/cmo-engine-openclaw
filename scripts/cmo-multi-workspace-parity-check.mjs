import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ts from "typescript";

const root = process.cwd();
const temp = mkdtempSync(join(tmpdir(), "cmo-multi-workspace-parity-"));
const requireFromTemp = createRequire(join(temp, "check.js"));

function source(path) {
  return readFileSync(join(root, path), "utf8");
}

function compileTsModule(sourcePath, outputFile) {
  const compiled = ts.transpileModule(source(sourcePath), {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      esModuleInterop: true,
      importsNotUsedAsValues: ts.ImportsNotUsedAsValues.Remove,
    },
    fileName: sourcePath,
  }).outputText;

  writeFileSync(join(temp, outputFile), compiled, "utf8");
}

try {
  compileTsModule("src/lib/cmo/workspace-registry.ts", "workspace-registry.js");
  const { workspaceRegistry, resolveWorkspaceRegistryEntry } = requireFromTemp(join(temp, "workspace-registry.js"));

  assert.equal(workspaceRegistry.length >= 6, true, "expected all visible workspaces in registry");
  const workspaceIds = workspaceRegistry.map((entry) => entry.workspaceId);
  assert.equal(new Set(workspaceIds).size, workspaceIds.length, "workspaceId must be unique per app card");
  assert.equal(workspaceIds.includes("holdstation"), false, "app cards must not share the tenant workspaceId");

  for (const entry of workspaceRegistry) {
    assert.equal(typeof entry.tenantId, "string", `${entry.appId} must carry tenantId`);
    assert.equal(entry.tenantId.length > 0, true, `${entry.appId} tenantId must be non-empty`);
    assert.equal(entry.route.startsWith("/apps/"), true, `${entry.appId} route must open under /apps`);
    assert.equal(entry.workspaceId.length > 0, true, `${entry.appId} workspaceId must be non-empty`);
    assert.equal(resolveWorkspaceRegistryEntry(entry.route)?.appId, entry.appId, `${entry.route} must resolve`);
  }

  assert.equal(resolveWorkspaceRegistryEntry("feedback")?.appId, "feeback", "feedback route alias must resolve to the existing app id");
  assert.equal(resolveWorkspaceRegistryEntry("feedback")?.workspaceId, "feeback", "feedback route alias must preserve canonical workspace id");
  assert.equal(resolveWorkspaceRegistryEntry("feedback")?.route, "/apps/feedback", "feedback alias route may remain public");

  const appWorkspaces = source("src/lib/cmo/app-workspaces.ts");
  assert.match(appWorkspaces, /id:\s*"feeback"[\s\S]*?name:\s*"Feeback"/, "Feeback display name must stay intentionally misspelled");
  assert.doesNotMatch(appWorkspaces, /id:\s*"feeback"[\s\S]*?name:\s*"Feedback"/, "Feeback must not display as Feedback");

  const appsPage = source("src/app/apps/[appId]/page.tsx");
  assert.match(appsPage, /<AppWorkspaceView state=\{state\} \/>/, "dynamic app route must use shared AppWorkspaceView");

  const appsIndex = source("src/components/cmo-apps/apps-index-view.tsx");
  assert.match(appsIndex, /href=\{app\.route\}/, "app cards must open registry routes");

  const chatPanel = source("src/components/cmo-apps/cmo-chat-panel.tsx");
  assert.match(chatPanel, /workspaceId:\s*app\.workspaceId/, "chat POST must use selected workspaceId");
  assert.doesNotMatch(chatPanel, /workspaceId:\s*"holdstation"/, "chat POST must not hardcode holdstation workspaceId");
  assert.doesNotMatch(chatPanel, /Context Drawer|Advanced\/Debug Vault Capture/, "normal chat UI must not expose removed debug controls");

  const chatStore = source("src/lib/cmo/app-chat-store.ts");
  assert.match(chatStore, /workspaceId !== registryEntry\.workspaceId/, "app chat must validate selected workspace against registry");
  assert.match(chatStore, /session_\$\{safeId\(request\.workspaceId\)\}_/, "session ids must be namespaced by workspaceId");

  const contextPack = source("src/lib/cmo/context-pack-builder.ts");
  assert.match(contextPack, /workspaceId !== registryEntry\.workspaceId/, "context packs must be workspace-scoped by registry");
  assert.doesNotMatch(contextPack, /HOLDSTATION_WORKSPACE_ID/, "context pack builder must not be locked to holdstation");

  const handoff = source("src/lib/cmo/vault-agent-handoff-builder.ts");
  assert.match(handoff, /workspace_id:\s*vaultWorkspaceIdForRequest\(input\.request\)/, "turn package must send selected workspace_id");

  const contextHandoff = source("src/lib/cmo/vault-agent-context-pack-handoff.ts");
  assert.match(contextHandoff, /workspace_id:\s*vaultWorkspaceIdForRequest\(input\.request\)/, "Vault context-pack request must send selected workspace_id");

  const runtime = source("src/lib/cmo/runtime.ts");
  assert.match(runtime, /vaultAgentContextPackStatus/, "fallback runtime must receive Vault Agent context-pack status");
  assert.match(runtime, /accepted workspace sources or goals/, "empty-context greeting must ask for source or goal");
  assert.match(runtime, /no accepted knowledge\/source context/, "empty-context explanation must be explicit and workspace-scoped");
  assert.doesNotMatch(runtime, /Pick one: activation, retention, campaign messaging, or app memory cleanup\.[\s\S]*vaultContextIsEmpty/, "empty-context fallback must not use the repeated strategy template");

  console.log("CMO multi-workspace parity checks passed");
} finally {
  rmSync(temp, { recursive: true, force: true });
}
