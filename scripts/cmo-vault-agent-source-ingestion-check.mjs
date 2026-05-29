import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";

const temp = mkdtempSync(join(tmpdir(), "cmo-vault-agent-source-ingestion-"));
const dist = join(temp, "dist");
const requireFromScript = createRequire(import.meta.url);
const tscBin = join("node_modules", "typescript", "bin", "tsc");

function baseSourceInput(overrides = {}) {
  return {
    appId: "holdstation-mini-app",
    source_title: "Manual source note",
    source_type: "text",
    source_text: "This is a pasted source about activation experiments.",
    original_language: "en",
    visibility: "workspace",
    scope: "workspace",
    source_refs: ["manual:test-source"],
    ...overrides,
  };
}

function successReceipt(overrides = {}) {
  return {
    schema_version: "hermes.vault_agent.source_ingestion_receipt.v1",
    status: "completed",
    write_performed: true,
    record_ids: {
      source_asset: "srcasset_123",
      source_note: "srcnote_123",
      source_map: "srcmap_holdstation_mini_app",
    },
    target_paths: {
      source_asset: "13 Sources/Assets/holdstation-mini-app/2026/05/srcasset_123 - manual-source.txt",
      source_note: "13 Sources/Source Notes/holdstation-mini-app/2026/05/srcnote_123 - Manual source note.md",
      source_map: "13 Sources/Source Maps/holdstation-mini-app.md",
    },
    warnings: [],
    errors: [],
    gbrain_called: false,
    promotion_performed: false,
    ...overrides,
  };
}

try {
  for (const file of [
    "config.ts",
    "user-metadata.ts",
    "workspace-registry.ts",
    "vault-agent-contracts.ts",
    "vault-agent-remote-client.ts",
    "vault-agent-source-ingestion.ts",
  ]) {
    cpSync(`src/lib/cmo/${file}`, join(temp, file));
  }

  execFileSync(process.execPath, [
    tscBin,
    "--target",
    "ES2022",
    "--module",
    "commonjs",
    "--moduleResolution",
    "node",
    "--esModuleInterop",
    "--skipLibCheck",
    "--strict",
    "--outDir",
    dist,
    join(temp, "config.ts"),
    join(temp, "user-metadata.ts"),
    join(temp, "workspace-registry.ts"),
    join(temp, "vault-agent-contracts.ts"),
    join(temp, "vault-agent-remote-client.ts"),
    join(temp, "vault-agent-source-ingestion.ts"),
  ], { stdio: "inherit" });

  const {
    buildSourceIngestionPackage,
  } = requireFromScript(join(dist, "vault-agent-source-ingestion.js"));
  const {
    callHermesVaultAgentIngestSource,
  } = requireFromScript(join(dist, "vault-agent-remote-client.js"));

  const pkg = buildSourceIngestionPackage(baseSourceInput(), {
    authMode: "supabase",
    userId: "user_123",
    userEmail: "operator@example.test",
  }, "2026-05-30T00:00:00.000Z");

  assert.equal(pkg.schema_version, "cmo.source_ingestion.v1");
  assert.equal(pkg.tenant_id, "holdstation");
  assert.equal(pkg.workspace_id, "holdstation-mini-app");
  assert.equal(pkg.user_id, "user_123");
  assert.equal(pkg.source_type, "text");
  assert.equal(pkg.source_title, "Manual source note");
  assert.equal(pkg.source_text, "This is a pasted source about activation experiments.");
  assert.equal(pkg.canonical_language, "en");
  assert.equal(pkg.no_auto_promote, true);
  assert.equal(pkg.visibility, "workspace");
  assert.equal(pkg.scope, "workspace");

  const originalFetch = globalThis.fetch;
  try {
    process.env.CMO_HERMES_BASE_URL = "https://hermes.example.test";
    process.env.CMO_HERMES_API_KEY = "test-key";
    process.env.CMO_HERMES_TIMEOUT_MS = "1000";

    globalThis.fetch = async (url, init) => {
      assert.equal(url, "https://hermes.example.test/agents/vault-agent/ingest-source");
      assert.equal(init?.method, "POST");
      assert.equal(init?.headers?.Authorization, "Bearer test-key");
      const body = JSON.parse(init?.body);
      assert.equal(body.schema_version, "cmo.source_ingestion.v1");
      assert.equal(body.no_auto_promote, true);
      assert.equal(body.source_text, "This is a pasted source about activation experiments.");

      return new Response(JSON.stringify(successReceipt()), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };

    const success = await callHermesVaultAgentIngestSource(pkg);
    assert.equal(success.ok, true);
    assert.equal(success.receipt.status, "completed");
    assert.equal(success.receipt.write_performed, true);
    assert.equal(success.receipt.record_ids.source_asset, "srcasset_123");
    assert.equal(success.receipt.record_ids.source_note, "srcnote_123");
    assert.equal(success.receipt.record_ids.source_map, "srcmap_holdstation_mini_app");
    assert.match(success.receipt.target_paths.source_note, /^13 Sources\/Source Notes\//);
    assert.deepEqual(success.receipt.errors, []);
    assert.equal(success.receipt.gbrain_called, false);
    assert.equal(success.receipt.promotion_performed, false);

    globalThis.fetch = async () => new Response(JSON.stringify(successReceipt({
      status: "rejected",
      write_performed: false,
      errors: ["source policy rejected package"],
    })), {
      status: 200,
      headers: { "content-type": "application/json" },
    });

    const rejected = await callHermesVaultAgentIngestSource(pkg);
    assert.equal(rejected.ok, true);
    assert.equal(rejected.receipt.status, "rejected");
    assert.equal(rejected.receipt.write_performed, false);
    assert.match(rejected.receipt.errors.join("\n"), /source policy rejected package/);
    assert.equal(rejected.receipt.gbrain_called, false);
    assert.equal(rejected.receipt.promotion_performed, false);

    globalThis.fetch = async () => {
      throw new Error("mock source ingestion network failure");
    };

    const failed = await callHermesVaultAgentIngestSource(pkg);
    assert.equal(failed.ok, false);
    assert.match(failed.error, /mock source ingestion network failure/);
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.CMO_HERMES_BASE_URL;
    delete process.env.CMO_HERMES_API_KEY;
    delete process.env.CMO_HERMES_TIMEOUT_MS;
  }

  const routeSource = readFileSync("src/app/api/cmo/vault/ingest-source/route.ts", "utf8");
  assert.match(routeSource, /getServerUserIdentity/);
  assert.match(routeSource, /buildSourceIngestionPackage/);
  assert.match(routeSource, /callHermesVaultAgentIngestSource/);
  assert.match(routeSource, /source_ingestion_status/);
  assert.match(routeSource, /source_record_ids/);
  assert.match(routeSource, /source_target_paths/);
  assert.match(routeSource, /source_write_performed/);
  assert.doesNotMatch(routeSource, /source_text:\s*pkg\.source_text|sourceText/);

  const responseTypes = readFileSync("src/lib/cmo/app-workspace-types.ts", "utf8");
  const responseBlock = responseTypes.match(/export interface CMOAppChatResponse \{[\s\S]*?\n\}/)?.[0] ?? "";
  assert.doesNotMatch(responseBlock, /source_ingestion|source_record_ids|source_target_paths/);

  const bannedGBrainCalls = /\b(importGBrain|syncGBrain|embedGBrain|dreamGBrain|extractGBrain)\b/;
  const bannedCmoOrchestrationChanges = /\bexecuteHermesCmoDelegations|executeHermesSurf|executeHermesEcho\b/;
  for (const file of [
    "src/lib/cmo/vault-agent-remote-client.ts",
    "src/lib/cmo/vault-agent-source-ingestion.ts",
    "src/app/api/cmo/vault/ingest-source/route.ts",
  ]) {
    const source = readFileSync(file, "utf8");
    assert.doesNotMatch(source, bannedGBrainCalls);
    assert.doesNotMatch(source, bannedCmoOrchestrationChanges);
  }

  console.log("CMO Vault Agent source ingestion checks passed");
} finally {
  rmSync(temp, { recursive: true, force: true });
}
