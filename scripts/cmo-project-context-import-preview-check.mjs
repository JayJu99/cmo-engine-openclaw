import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";

const root = process.cwd();

function loadTsModule(relativePath, moduleCache = new Map()) {
  const absolutePath = join(root, relativePath);
  if (moduleCache.has(absolutePath)) {
    return moduleCache.get(absolutePath).exports;
  }

  const source = readFileSync(absolutePath, "utf8");
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
    fileName: absolutePath,
  }).outputText;

  const loadedModule = { exports: {} };
  moduleCache.set(absolutePath, loadedModule);

  const localRequire = (specifier) => {
    if (specifier === "./project-context-import-types") {
      return loadTsModule("src/lib/cmo/project-context-import-types.ts", moduleCache);
    }
    throw new Error(`Unexpected require from ${relativePath}: ${specifier}`);
  };

  const fn = new Function("require", "module", "exports", transpiled);
  fn(localRequire, loadedModule, loadedModule.exports);
  return loadedModule.exports;
}

const {
  buildProjectContextImportPreviewReceipt,
  detectProjectContextDocType,
} = loadTsModule("src/lib/cmo/project-context-import-detection.ts");

function makeFile(originalFilename, id = originalFilename) {
  return {
    client_file_id: id,
    original_filename: originalFilename,
    mime_type: "text/markdown",
    content: `# ${originalFilename}\nPreview-only fixture`,
    size_bytes: originalFilename.length + 23,
  };
}

function assertAllSideEffectsFalse(receipt) {
  for (const [key, value] of Object.entries(receipt.side_effects)) {
    assert.equal(value, false, `side_effects.${key} must be false`);
  }
}

function assertWorkspaceScopedTargets(receipt, workspaceId) {
  for (const detected of receipt.detected) {
    assert.equal(
      detected.source_path,
      `13 Sources/Source Notes/${workspaceId}/project-context/${detected.doc_type}.md`,
    );
    assert.equal(
      detected.accepted_path,
      `12 Knowledge/Workspace Lessons/${workspaceId}/project-${detected.doc_type}.md`,
    );
    assert.equal(detected.change_status, "preview_only");
    assert.equal(detected.will_update_accepted, false);
  }
}

const eggsFiles = [
  "audienceEV.md",
  "positioningEV.md",
  "product-truthEV.md",
  "eggs-vault-campaign-rules.md",
  "eggs-vault-content-pillars.md",
].map((filename) => makeFile(filename));

const eggsReceipt = buildProjectContextImportPreviewReceipt({
  workspaceId: "eggs-vault",
  projectName: "Eggs Vault",
  files: eggsFiles,
});

assert.equal(eggsReceipt.schema_version, "project_context_import.receipt.v1");
assert.equal(eggsReceipt.status, "preview");
assert.equal(eggsReceipt.write_performed, false);
assert.equal(eggsReceipt.workspace_id, "eggs-vault");
assert.equal(eggsReceipt.detected.length, 5);
assert.deepEqual(
  eggsReceipt.detected.map((file) => file.doc_type).sort(),
  ["audience", "campaign-rules", "content-pillars", "positioning", "product-truth"].sort(),
);
assert.equal(eggsReceipt.unmapped_files.length, 0);
assert.equal(eggsReceipt.conflicts.length, 0);
assertAllSideEffectsFalse(eggsReceipt);
assertWorkspaceScopedTargets(eggsReceipt, "eggs-vault");

const holdstationMiniAppFiles = [
  "audience.md",
  "positioning.md",
  "product-truth.md",
  "campaign-rules-hybrid-updated.md",
  "content-pillars-corrected-gateway.md",
].map((filename) => makeFile(filename));

const holdstationMiniAppReceipt = buildProjectContextImportPreviewReceipt({
  workspaceId: "holdstation-mini-app",
  projectName: "Holdstation Mini App",
  files: holdstationMiniAppFiles,
});

assert.equal(holdstationMiniAppReceipt.write_performed, false);
assert.equal(holdstationMiniAppReceipt.detected.length, 5);
assert.equal(holdstationMiniAppReceipt.unmapped_files.length, 0);
assert.equal(holdstationMiniAppReceipt.conflicts.length, 0);
assertAllSideEffectsFalse(holdstationMiniAppReceipt);
assertWorkspaceScopedTargets(holdstationMiniAppReceipt, "holdstation-mini-app");

const unknownReceipt = buildProjectContextImportPreviewReceipt({
  workspaceId: "eggs-vault",
  projectName: "Eggs Vault",
  files: [makeFile("random-notes.md")],
});
assert.equal(unknownReceipt.detected.length, 0);
assert.deepEqual(unknownReceipt.unmapped_files, [
  {
    client_file_id: "random-notes.md",
    original_filename: "random-notes.md",
    reason: "unknown_doc_type",
  },
]);
assert.equal(unknownReceipt.write_performed, false);
assertAllSideEffectsFalse(unknownReceipt);

const duplicateReceipt = buildProjectContextImportPreviewReceipt({
  workspaceId: "eggs-vault",
  projectName: "Eggs Vault",
  files: [makeFile("audience.md", "aud-1"), makeFile("project-audience.md", "aud-2")],
});
assert.equal(duplicateReceipt.detected.length, 2);
assert.equal(duplicateReceipt.conflicts.length, 1);
assert.equal(duplicateReceipt.conflicts[0].doc_type, "audience");
assert.equal(duplicateReceipt.conflicts[0].reason, "duplicate_doc_type");
assert.equal(duplicateReceipt.conflicts[0].blocks_confirm, true);
assert.match(duplicateReceipt.warnings.join("\n"), /duplicate_doc_type_conflict_blocks_confirm/);
assert.equal(duplicateReceipt.write_performed, false);
assertAllSideEffectsFalse(duplicateReceipt);

assert.equal(detectProjectContextDocType("audience.md"), "audience");
assert.equal(detectProjectContextDocType("audienceEV.md"), "audience");
assert.equal(detectProjectContextDocType("project-audience.md"), "audience");
assert.equal(detectProjectContextDocType("positioningEV.md"), "positioning");
assert.equal(detectProjectContextDocType("product_truth.md"), "product-truth");
assert.equal(detectProjectContextDocType("product truth.md"), "product-truth");
assert.equal(detectProjectContextDocType("product-truthEV.md"), "product-truth");
assert.equal(detectProjectContextDocType("campaign-rules-hybrid-updated.md"), "campaign-rules");
assert.equal(detectProjectContextDocType("content-pillars-corrected-gateway.md"), "content-pillars");
assert.equal(detectProjectContextDocType("not-markdown.txt"), null);

const productionFiles = [
  "src/lib/cmo/project-context-import-types.ts",
  "src/lib/cmo/project-context-import-detection.ts",
  "src/app/api/apps/[appId]/project-context/import/preview/route.ts",
];

for (const path of productionFiles) {
  const source = readFileSync(join(root, path), "utf8");
  assert.doesNotMatch(source, /eggs-vault|Eggs Vault|holdstation-mini-app|Holdstation Mini App/i, `${path} must not hardcode project keywords`);
  assert.doesNotMatch(source, /from\s+["'].*(?:gbrain|supabase)|90 Runtime|runPromotion|promotionCandidates/i, `${path} must not couple preview to forbidden systems`);
}

const registrySource = readFileSync(join(root, "src/lib/cmo/workspace-registry.ts"), "utf8");
assert.match(registrySource, /workspaceId: "feeback"/, "feeback workspace naming must remain intentional");
assert.match(registrySource, /aliases: \["feedback"\]/, "feedback alias must remain intact");
assert.match(registrySource, /workspaceId: "eggs-vault"/, "Eggs Vault workspace must remain registered");

const forbiddenWriteTargets = ["13 Sources", "12 Knowledge", "90 Runtime"].map((path) => join(root, path));
for (const target of forbiddenWriteTargets) {
  assert.equal(existsSync(target), false, `preview check must not create ${relative(root, target)}`);
}

for (const path of productionFiles) {
  assert.equal(statSync(join(root, path)).isFile(), true);
}

console.log("Sample preview receipt:");
console.log(JSON.stringify(eggsReceipt, null, 2));
console.log("CMO project context import preview checks passed");
