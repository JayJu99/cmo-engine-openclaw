import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ts from "typescript";

const root = process.cwd();
const temp = mkdtempSync(join(tmpdir(), "cmo-project-context-confirm-"));
const requireFromTemp = createRequire(join(temp, "check.js"));

function source(path) {
  return readFileSync(join(root, path), "utf8");
}

function compileSource(sourcePath, outputPath, rewrite = (value) => value) {
  const compiled = ts.transpileModule(source(sourcePath), {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      esModuleInterop: true,
      importsNotUsedAsValues: ts.ImportsNotUsedAsValues.Remove,
    },
    fileName: sourcePath,
  }).outputText;

  writeFileSync(join(temp, outputPath), rewrite(compiled), "utf8");
}

const sampleRequest = {
  schema_version: "project_context_import.request.v1",
  mode: "confirm",
  tenant_id: "holdstation",
  workspace_id: "aion",
  app_id: "aion",
  project_name: "AION",
  confirmation: {
    accepted_project_context: true,
    confirmed_by_user: true,
    overwrite_changed: false,
  },
  files: [
    { client_file_id: "file_audience", original_filename: "audience.md", mime_type: "text/markdown", doc_type: "audience", content: "# Audience\nAION audience context." },
    { client_file_id: "file_positioning", original_filename: "positioning.md", mime_type: "text/markdown", doc_type: "positioning", content: "# Positioning\nAION positioning context." },
    { client_file_id: "file_product_truth", original_filename: "product-truth.md", mime_type: "text/markdown", doc_type: "product-truth", content: "# Product Truth\nAION product truth." },
    { client_file_id: "file_campaign_rules", original_filename: "campaign-rules.md", mime_type: "text/markdown", doc_type: "campaign-rules", content: "# Campaign Rules\nAION campaign rules." },
    { client_file_id: "file_content_pillars", original_filename: "content-pillars.md", mime_type: "text/markdown", doc_type: "content-pillars", content: "# Content Pillars\nAION content pillars." },
  ],
};

try {
  writeFileSync(
    join(temp, "config.js"),
    [
      "exports.getCmoHermesBaseUrl = () => process.env.CMO_HERMES_BASE_URL || '';",
      "exports.getCmoHermesApiKey = () => process.env.CMO_HERMES_API_KEY || '';",
      "exports.getCmoHermesTimeoutMs = () => 1000;",
    ].join("\n"),
    "utf8",
  );
  compileSource("src/lib/cmo/project-context-import-types.ts", "project-context-import-types.js");
  compileSource(
    "src/lib/cmo/project-context-import.ts",
    "project-context-import.js",
    (output) => output.replace('require("@/lib/cmo/project-context-import-types")', 'require("./project-context-import-types.js")'),
  );
  compileSource(
    "src/lib/cmo/vault-agent-project-context-client.ts",
    "vault-agent-project-context-client.js",
    (output) =>
      output
        .replace('require("@/lib/cmo/config")', 'require("./config.js")')
        .replace('require("@/lib/cmo/project-context-import-types")', 'require("./project-context-import-types.js")'),
  );

  const {
    validateProjectContextImportConfirmRequest,
  } = requireFromTemp(join(temp, "project-context-import.js"));
  const {
    importProjectContextViaVaultAgent,
    HERMES_VAULT_AGENT_IMPORT_PROJECT_CONTEXT_ENDPOINT,
  } = requireFromTemp(join(temp, "vault-agent-project-context-client.js"));

  assert.equal(HERMES_VAULT_AGENT_IMPORT_PROJECT_CONTEXT_ENDPOINT, "/agents/vault-agent/import-project-context");

  const validation = validateProjectContextImportConfirmRequest(sampleRequest, { appId: "aion", workspaceId: "aion", tenantId: "holdstation" });
  assert.equal(validation.ok, true);
  assert.equal(validation.request.workspace_id, "aion");
  assert.equal(validation.request.app_id, "aion");
  assert.equal(validation.request.project_name, "AION");
  assert.equal(validation.request.confirmation.accepted_project_context, true);
  assert.equal(validation.request.confirmation.confirmed_by_user, true);
  assert.equal(validation.request.confirmation.overwrite_changed, false);
  assert.equal(validation.request.files.length, 5);
  assert.equal(validation.request.files[3].doc_type, "campaign-rules");
  assert.match(validation.request.files[3].content, /campaign rules/i);

  const duplicate = validateProjectContextImportConfirmRequest({
    ...sampleRequest,
    files: [...sampleRequest.files, { client_file_id: "file_audience_2", original_filename: "audience-2.md", doc_type: "audience", content: "# Duplicate" }],
  }, { appId: "aion", workspaceId: "aion", tenantId: "holdstation" });
  assert.equal(duplicate.ok, false);
  assert.ok(duplicate.errors.some((error) => error.startsWith("duplicate_doc_type:audience")));

  const mismatch = validateProjectContextImportConfirmRequest(sampleRequest, { appId: "hold-pay", workspaceId: "hold-pay", tenantId: "holdstation" });
  assert.equal(mismatch.ok, false);
  assert.ok(mismatch.errors.includes("workspace_id_mismatch"));
  assert.ok(mismatch.errors.includes("app_id_mismatch"));

  const overwriteChanged = validateProjectContextImportConfirmRequest({
    ...sampleRequest,
    confirmation: { ...sampleRequest.confirmation, overwrite_changed: true },
  }, { appId: "aion", workspaceId: "aion", tenantId: "holdstation" });
  assert.equal(overwriteChanged.ok, true);
  assert.equal(overwriteChanged.request.confirmation.overwrite_changed, true);

  const forbiddenFieldInput = validateProjectContextImportConfirmRequest({
    ...sampleRequest,
    files: [{
      ...sampleRequest.files[0],
      raw_html: "<html>ignored</html>",
      source_text: "ignored source text",
      extracted_text: "ignored extracted text",
      source_auto_save: true,
      knowledge_promotion: true,
    }],
  }, { appId: "aion", workspaceId: "aion", tenantId: "holdstation" });
  assert.equal(forbiddenFieldInput.ok, true);
  assert.equal("raw_html" in forbiddenFieldInput.request.files[0], false);
  assert.equal("source_text" in forbiddenFieldInput.request.files[0], false);
  assert.equal("extracted_text" in forbiddenFieldInput.request.files[0], false);
  assert.equal("source_auto_save" in forbiddenFieldInput.request.files[0], false);
  assert.equal("knowledge_promotion" in forbiddenFieldInput.request.files[0], false);

  process.env.CMO_HERMES_BASE_URL = "https://hermes.example.test";
  process.env.CMO_HERMES_API_KEY = "test-key";

  const calls = [];
  global.fetch = async (url, init) => {
    const body = JSON.parse(String(init.body));
    calls.push({ url, init, body });

    assert.equal(url, "https://hermes.example.test/agents/vault-agent/import-project-context");
    assert.equal(init.method, "POST");
    assert.equal(init.headers.Authorization, "Bearer test-key");
    assert.equal(body.workspace_id, "aion");
    assert.equal(body.app_id, "aion");
    assert.equal(body.project_name, "AION");
    assert.deepEqual(body.confirmation, sampleRequest.confirmation);
    assert.equal(body.files.length, 5);
    assert.equal(body.files[0].doc_type, "audience");
    assert.match(body.files[0].content, /AION audience context/);

    return new Response(JSON.stringify({
      schema_version: "project_context_import.receipt.v1",
      status: "completed",
      workspace_id: "aion",
      app_id: "aion",
      project_name: "AION",
      source_count: 5,
      accepted_count: 5,
      vault_write_performed: true,
      gbrain_called: false,
      promotion_performed: false,
      warnings: [],
      errors: [],
    }), { status: 200, headers: { "content-type": "application/json" } });
  };

  const success = await importProjectContextViaVaultAgent(validation.request);
  assert.equal(success.ok, true);
  assert.equal(success.receipt.status, "completed");
  assert.equal(success.receipt.source_count, 5);
  assert.equal(calls.length, 1);

  global.fetch = async () => new Response(JSON.stringify({
    schema_version: "project_context_import.receipt.v1",
    status: "completed",
    deduped: true,
    workspace_id: "aion",
    app_id: "aion",
    warnings: ["deduped"],
    errors: [],
  }), { status: 200 });
  const deduped = await importProjectContextViaVaultAgent(validation.request);
  assert.equal(deduped.ok, true);
  assert.equal(deduped.receipt.deduped, true);

  global.fetch = async () => new Response(JSON.stringify({
    schema_version: "project_context_import.receipt.v1",
    status: "conflict",
    conflict: true,
    workspace_id: "aion",
    app_id: "aion",
    warnings: [],
    errors: ["changed_content_conflict"],
  }), { status: 409 });
  const conflict = await importProjectContextViaVaultAgent(validation.request);
  assert.equal(conflict.ok, false);
  assert.equal(conflict.receipt.conflict, true);
  assert.deepEqual(conflict.receipt.errors, ["changed_content_conflict"]);

  global.fetch = async () => new Response(JSON.stringify({
    schema_version: "project_context_import.receipt.v1",
    status: "rejected",
    warnings: [],
    errors: ["invalid_doc_type"],
  }), { status: 400 });
  const rejected = await importProjectContextViaVaultAgent(validation.request);
  assert.equal(rejected.ok, false);
  assert.equal(rejected.error, "invalid_doc_type");

  const routeSource = source("src/app/api/apps/[appId]/project-context/import/confirm/route.ts");
  const clientSource = source("src/lib/cmo/vault-agent-project-context-client.ts");
  const validatorSource = source("src/lib/cmo/project-context-import.ts");
  const appWorkspacesSource = source("src/lib/cmo/app-workspaces.ts");

  assert.match(routeSource, /validateProjectContextImportConfirmRequest/);
  assert.match(routeSource, /importProjectContextViaVaultAgent\(validation\.request\)/);
  assert.match(routeSource, /supabase_mutation:\s*false/);
  assert.match(routeSource, /runtime_write:\s*false/);
  assert.match(clientSource, /\/agents\/vault-agent\/import-project-context/);
  assert.doesNotMatch(`${routeSource}\n${clientSource}`, /writeFile|appendFile|saveCaptureToCmoEngineVault|vault-auto-capture|autoCaptureTurnOnce|write-turn-log|raw-activity-log|ingest-source|gbrain-client|promotion-candidates|indexChatSession|indexChatMessages/i);
  assert.match(routeSource, /gbrain_called:\s*false/);
  assert.match(routeSource, /promotion_performed:\s*false/);
  assert.doesNotMatch(validatorSource, /ocr_text|pdf_text|fetched_content/);
  assert.match(appWorkspacesSource, /id:\s*"feeback"[\s\S]*?name:\s*"Feeback"/, "Feeback naming must stay unchanged");
  assert.doesNotMatch(appWorkspacesSource, /id:\s*"feeback"[\s\S]*?name:\s*"Feedback"/);

  console.log(JSON.stringify({
    ok: true,
    endpointCalled: calls[0].url,
    forwarded: {
      workspace_id: calls[0].body.workspace_id,
      app_id: calls[0].body.app_id,
      project_name: calls[0].body.project_name,
      confirmation: calls[0].body.confirmation,
      doc_types: calls[0].body.files.map((file) => file.doc_type),
    },
    receiptSample: success.receipt,
    dedupedAccepted: deduped.ok,
    conflictReturnedSafely: conflict.receipt.conflict === true,
    hermesErrorReturnedSafely: rejected.error === "invalid_doc_type",
    noLocalVaultWrite: true,
    noLegacyEndpoints: true,
    noGbrainPromotionSupabaseRuntimeWrite: true,
    feebackNamingUnchanged: true,
  }, null, 2));
} finally {
  rmSync(temp, { recursive: true, force: true });
}
