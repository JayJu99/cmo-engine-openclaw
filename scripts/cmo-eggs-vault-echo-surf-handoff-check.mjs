import assert from "node:assert/strict";
import Module from "node:module";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import ts from "typescript";

const root = process.cwd();
const requireFromRoot = createRequire(import.meta.url);
const requireForHook = createRequire(import.meta.url);
const originalResolve = Module._resolveFilename;
const originalTsHook = requireForHook.extensions[".ts"];

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
        if (requireForHook("node:fs").existsSync(tsCandidate)) return tsCandidate;
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

function fixtureRequest(message) {
  return {
    workspaceId: "eggs-vault",
    appId: "eggs-vault",
    appName: "Eggs Vault",
    message,
    context: {
      mode: "app_context",
      selectedNotes: [
        {
          id: "eggs-project-context",
          title: "Accepted Project Context",
          path: "12 Knowledge/Workspace Lessons/eggs-vault/project-campaign-rules.md",
          type: "app-note",
          reason: "Accepted Eggs Vault project context",
          selected: true,
          exists: true,
          contentPreview: "EGGS_AUDIENCE_SENTINEL EGGS_POSITIONING_SENTINEL EGGS_CAMPAIGN_RULE_SENTINEL EGGS_CONTENT_PILLAR_SENTINEL",
          contextQuality: "confirmed",
        },
        {
          id: "hold-pay-sentinel",
          title: "Hold Pay sentinel should not be selected for Eggs Vault",
          path: "12 Knowledge/Workspace Lessons/hold-pay/project-audience.md",
          type: "app-note",
          reason: "should not leak",
          selected: false,
          exists: true,
          contentPreview: "HOLD_PAY_DO_NOT_LEAK",
          contextQuality: "confirmed",
        },
      ],
    },
  };
}

try {
  installTsRequireHook();
  const echoBridge = requireFromRoot(join(root, "src/lib/cmo/echo-bridge.ts"));
  const surfBridge = requireFromRoot(join(root, "src/lib/cmo/surf-bridge.ts"));

  assert.equal(typeof echoBridge.buildMixedEchoBriefFromCmoAnswer, "function");
  assert.equal(typeof echoBridge.buildDirectEchoBrief, "function", "direct Echo brief builder must be exported for contract checks");
  assert.equal(typeof surfBridge.buildDirectSurfBrief, "function", "direct Surf brief builder must be exported for contract checks");

  const echoBrief = echoBridge.buildMixedEchoBriefFromCmoAnswer(
    fixtureRequest("@Echo draft 3 X posts for Eggs Vault campaign"),
    "CMO strategy says use EGGS_CAMPAIGN_RULE_SENTINEL and EGGS_CONTENT_PILLAR_SENTINEL."
  );
  const directEchoBrief = echoBridge.buildDirectEchoBrief(
    fixtureRequest("/echo draft 3 X posts for Eggs Vault campaign"),
    "draft 3 X posts for Eggs Vault campaign"
  );
  const surfBrief = surfBridge.buildDirectSurfBrief(
    fixtureRequest("/surf research competitors for Eggs Vault in World App"),
    "research competitors for Eggs Vault in World App"
  );

  for (const [label, brief] of [["echo", echoBrief], ["directEcho", directEchoBrief], ["surf", surfBrief]]) {
    const serialized = JSON.stringify(brief);
    assert.equal(brief.workspace, "eggs-vault", `${label} must use active workspace id`);
    assert.match(serialized, /EGGS_AUDIENCE_SENTINEL/);
    assert.match(serialized, /EGGS_POSITIONING_SENTINEL/);
    assert.match(serialized, /EGGS_CAMPAIGN_RULE_SENTINEL/);
    assert.match(serialized, /EGGS_CONTENT_PILLAR_SENTINEL/);
    assert.doesNotMatch(serialized, /HOLD_PAY_DO_NOT_LEAK/);
    assert.doesNotMatch(serialized, /crypto-native Holdstation Mini App users and prospects|holdstation-mini-app/);
  }

  console.log("CMO Eggs Vault Echo/Surf handoff checks passed");
} finally {
  Module._resolveFilename = originalResolve;
  if (originalTsHook) requireForHook.extensions[".ts"] = originalTsHook;
  else delete requireForHook.extensions[".ts"];
}
