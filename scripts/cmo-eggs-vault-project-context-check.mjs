import assert from "node:assert/strict";
import Module from "node:module";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import ts from "typescript";

const root = process.cwd();
const temp = mkdtempSync(join(tmpdir(), "cmo-eggs-vault-context-"));
const requireFromRoot = createRequire(import.meta.url);
const requireForHook = createRequire(import.meta.url);
const originalCwd = process.cwd();
const originalResolve = Module._resolveFilename;
const originalTsHook = requireForHook.extensions[".ts"];

function writeVault(relativePath, content) {
  const target = join(temp, "knowledge", "holdstation", relativePath);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content, "utf8");
}

function acceptedFrontmatter(workspaceId) {
  return [
    "---",
    "record_type: workspace_knowledge",
    `workspace_id: ${workspaceId}`,
    "scope: workspace",
    "truth_status: accepted",
    "review_status: accepted",
    "visibility: workspace",
    "source_type: project_context",
    "---",
    "",
  ].join("\n");
}

function installTsRequireHook() {
  Module._resolveFilename = function resolveFilename(request, parent, isMain, options) {
    if (request.startsWith("@/")) {
      const aliased = join(root, "src", request.slice(2));
      const aliasedTs = `${aliased}.ts`;
      if (requireForHook("node:fs").existsSync(aliasedTs)) return aliasedTs;
      return aliased;
    }
    if (request.startsWith("./") || request.startsWith("../")) {
      try {
        return originalResolve.call(this, request, parent, isMain, options);
      } catch (error) {
        const fromDir = parent?.filename ? dirname(parent.filename) : root;
        const tsCandidate = join(fromDir, `${request}.ts`);
        if (requireForHook("node:fs").existsSync(tsCandidate)) {
          return tsCandidate;
        }
        throw error;
      }
    }
    return originalResolve.call(this, request, parent, isMain, options);
  };

  requireForHook.extensions[".ts"] = function loadTs(module, filename) {
    const source = requireForHook("node:fs").readFileSync(filename, "utf8");
    const output = ts.transpileModule(source, {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.CommonJS,
        esModuleInterop: true,
        moduleResolution: ts.ModuleResolutionKind.NodeJs,
        skipLibCheck: true,
      },
      fileName: filename,
    }).outputText;
    module._compile(output, filename);
  };
}

try {
  writeVault("12 Knowledge/Workspace Lessons/eggs-vault/project-audience.md", `${acceptedFrontmatter("eggs-vault")}EGGS_AUDIENCE_SENTINEL: builders who want vault-backed project clarity.`);
  writeVault("12 Knowledge/Workspace Lessons/eggs-vault/project-positioning.md", `${acceptedFrontmatter("eggs-vault")}EGGS_POSITIONING_SENTINEL: Eggs Vault owns playful proof-driven positioning.`);
  writeVault("12 Knowledge/Workspace Lessons/eggs-vault/project-product-truth.md", `${acceptedFrontmatter("eggs-vault")}EGGS_PRODUCT_TRUTH_SENTINEL: only claim verified product mechanics.`);
  writeVault("12 Knowledge/Workspace Lessons/eggs-vault/project-campaign-rules.md", `${acceptedFrontmatter("eggs-vault")}EGGS_CAMPAIGN_RULE_SENTINEL: never sound like generic DeFi farming.`);
  writeVault("12 Knowledge/Workspace Lessons/eggs-vault/project-content-pillars.md", `${acceptedFrontmatter("eggs-vault")}EGGS_CONTENT_PILLAR_SENTINEL: education, trust, collection rituals.`);
  writeVault("12 Knowledge/Workspace Lessons/hold-pay/project-audience.md", `${acceptedFrontmatter("hold-pay")}HOLD_PAY_DO_NOT_LEAK: merchants and fiat rails.`);
  writeVault("12 Knowledge/Workspace Lessons/holdstation-mini-app/project-positioning.md", `${acceptedFrontmatter("holdstation-mini-app")}HOLDSTATION_MINI_APP_DO_NOT_LEAK: World App trading.`);
  writeVault("13 Sources/Source Notes/eggs-vault/project-context/audience.md", "RAW_EGGS_SOURCE_DO_NOT_INJECT: raw audience source text");

  process.chdir(temp);
  installTsRequireHook();

  const { buildContextPack } = requireFromRoot(join(root, "src/lib/cmo/context-pack-builder.ts"));
  const { resolveWorkspaceRegistryEntry } = requireFromRoot(join(root, "src/lib/cmo/workspace-registry.ts"));
  const { getAppWorkspace } = requireFromRoot(join(root, "src/lib/cmo/app-workspaces.ts"));

  assert.equal(resolveWorkspaceRegistryEntry("eggs-vault")?.workspaceId, "eggs-vault", "Eggs Vault registry entry must exist");
  assert.equal(getAppWorkspace("eggs-vault")?.name, "Eggs Vault", "Eggs Vault app workspace must exist");

  const result = await buildContextPack({ workspaceId: "eggs-vault", appId: "eggs-vault", runtimeMode: "live" });
  const content = result.contextPackage.selectedContext.map((item) => `${item.title}\n${item.path}\n${item.content}`).join("\n---\n");
  const allItems = result.contextPack.items.map((item) => `${item.kind}:${item.title}:${item.exists}`).join("\n");

  assert.match(allItems, /project_context:Accepted Project Context:true/, "accepted project context item must be included");
  assert.match(content, /EGGS_AUDIENCE_SENTINEL/);
  assert.match(content, /EGGS_POSITIONING_SENTINEL/);
  assert.match(content, /EGGS_PRODUCT_TRUTH_SENTINEL/);
  assert.match(content, /EGGS_CAMPAIGN_RULE_SENTINEL/);
  assert.match(content, /EGGS_CONTENT_PILLAR_SENTINEL/);
  assert.doesNotMatch(content, /HOLD_PAY_DO_NOT_LEAK/);
  assert.doesNotMatch(content, /HOLDSTATION_MINI_APP_DO_NOT_LEAK/);
  assert.doesNotMatch(content, /RAW_EGGS_SOURCE_DO_NOT_INJECT/);

  const holdPay = await buildContextPack({ workspaceId: "hold-pay", appId: "hold-pay", runtimeMode: "live" });
  const holdPayContent = holdPay.contextPackage.selectedContext.map((item) => item.content).join("\n");
  assert.match(holdPayContent, /HOLD_PAY_DO_NOT_LEAK/);
  assert.doesNotMatch(holdPayContent, /EGGS_AUDIENCE_SENTINEL|EGGS_CAMPAIGN_RULE_SENTINEL/);

  const source = requireForHook("node:fs").readFileSync(join(root, "src/lib/cmo/context-pack-builder.ts"), "utf8");
  assert.doesNotMatch(source, /gbrain.*project_context|project_context.*gbrain/i, "project context reader must not introduce GBrain coupling");
  assert.doesNotMatch(source, /90 Runtime[\s\S]*project_context|project_context[\s\S]*90 Runtime/i, "project context reader must not index raw runtime notes");

  console.log("CMO Eggs Vault project context checks passed");
} finally {
  process.chdir(originalCwd);
  Module._resolveFilename = originalResolve;
  if (originalTsHook) {
    requireForHook.extensions[".ts"] = originalTsHook;
  } else {
    delete requireForHook.extensions[".ts"];
  }
  rmSync(temp, { recursive: true, force: true });
}
