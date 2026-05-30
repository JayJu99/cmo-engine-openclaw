import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";

const temp = mkdtempSync(join(tmpdir(), "cmo-source-acquisition-"));
const dist = join(temp, "dist");
const requireFromScript = createRequire(import.meta.url);
const tscBin = join("node_modules", "typescript", "bin", "tsc");

try {
  mkdirSync(join(temp, "source-acquisition"), { recursive: true });

  for (const file of [
    "app-workspace-types.ts",
    "user-metadata.ts",
    "vault-agent-contracts.ts",
    "vault-agent-source-ingestion.ts",
    "workspace-registry.ts",
  ]) {
    cpSync(`src/lib/cmo/${file}`, join(temp, file));
  }

  writeFileSync(
    join(temp, "source-acquisition", "index.ts"),
    readFileSync("src/lib/cmo/source-acquisition/index.ts", "utf8")
      .replace(/@\/lib\/cmo\/app-workspace-types/g, "../app-workspace-types")
      .replace(/@\/lib\/cmo\/user-metadata/g, "../user-metadata")
      .replace(/@\/lib\/cmo\/vault-agent-source-ingestion/g, "../vault-agent-source-ingestion")
      .replace(/@\/lib\/cmo\/vault-agent-contracts/g, "../vault-agent-contracts"),
  );

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
    join(temp, "app-workspace-types.ts"),
    join(temp, "user-metadata.ts"),
    join(temp, "vault-agent-contracts.ts"),
    join(temp, "workspace-registry.ts"),
    join(temp, "vault-agent-source-ingestion.ts"),
    join(temp, "source-acquisition", "index.ts"),
  ], { stdio: "inherit" });

  const {
    buildRuntimeContext,
    buildSourceReviewContext,
    buildVaultIngestionPackage,
    detectInputType,
    extractCsv,
    extractPdf,
    fetchPublicUrl,
  } = requireFromScript(join(dist, "source-acquisition", "index.js"));

  const detectedUrl = detectInputType("Review this: https://example.com/post");
  assert.equal(detectedUrl.input_type, "public_url");
  assert.equal(detectedUrl.source_type, "url");
  assert.equal(detectedUrl.url, "https://example.com/post");

  const blockedLocalhost = await fetchPublicUrl("http://127.0.0.1:3000/internal", "2026-05-31T00:00:00.000Z");
  assert.equal(blockedLocalhost.status, "blocked");
  assert.equal(blockedLocalhost.permission_status, "blocked");
  assert.match(blockedLocalhost.errors.join("\n"), /private|localhost|metadata/i);

  const blockedGoogleDoc = await fetchPublicUrl("https://docs.google.com/document/d/private-doc/edit", "2026-05-31T00:00:00.000Z");
  assert.equal(blockedGoogleDoc.status, "blocked");
  assert.equal(blockedGoogleDoc.permission_status, "permission_denied");
  assert.match(blockedGoogleDoc.errors.join("\n"), /Google Docs\/Sheets/);

  const textContext = await buildSourceReviewContext({
    tenantId: "holdstation",
    workspaceId: "aion",
    userId: "user_123",
    sessionId: "session_aion_source_123",
    requestId: "msg_source_123",
    text: "AION source note: prioritize retention before paid acquisition.",
    sourceTitle: "AION pasted source",
    nowIso: "2026-05-31T00:00:00.000Z",
  });
  assert.equal(textContext.schema_version, "cmo.source_review_context.v1");
  assert.equal(textContext.mode, "review_only");
  assert.equal(textContext.workspace_id, "aion");
  assert.equal(textContext.safety.read_only, true);
  assert.equal(textContext.safety.vault_mutation, false);
  assert.equal(textContext.safety.gbrain_mutation, false);
  assert.equal(textContext.safety.no_promotion, true);
  assert.equal(textContext.extraction.status, "completed");
  assert.match(textContext.extraction.source_text, /prioritize retention/);

  const csv = extractCsv("name,value\nactivation,10\nretention,20\n");
  assert.equal(csv.status, "completed");
  assert.match(csv.table_summary, /2 columns/);
  assert.match(csv.table_summary, /name, value/);

  const pdf = extractPdf(new Uint8Array([37, 80, 68, 70]));
  assert.equal(pdf.status, "unsupported");
  assert.match(pdf.extracted_summary, /PDF text extraction is not wired/);

  const vaultPackage = buildVaultIngestionPackage(textContext, {
    appId: "aion",
    scope: "session",
    visibility: "workspace",
  });
  assert.equal(vaultPackage.schema_version, "cmo.source_ingestion.v1");
  assert.equal(vaultPackage.workspace_id, "aion");
  assert.equal(vaultPackage.session_id, "session_aion_source_123");
  assert.equal(vaultPackage.no_auto_promote, true);
  assert.equal(vaultPackage.scope, "session");
  assert.equal(vaultPackage.visibility, "workspace");
  assert.equal(vaultPackage.retrieved_at, "2026-05-31T00:00:00.000Z");
  assert.equal(vaultPackage.timezone, "Asia/Ho_Chi_Minh");
  assert.equal(vaultPackage.extraction.status, "completed");
  assert.match(vaultPackage.source_refs.join("\n"), /source_review:/);

  const runtimeContext = buildRuntimeContext({
    nowIso: "2026-05-31T01:02:03.000Z",
    userIdentity: {
      authMode: "supabase",
      userId: "user_123",
      userEmail: "jay@example.test",
    },
  });
  assert.equal(runtimeContext.now_iso, "2026-05-31T01:02:03.000Z");
  assert.equal(runtimeContext.timezone, "Asia/Ho_Chi_Minh");
  assert.equal(runtimeContext.timezone_label, "Vietnam time");
  assert.equal(runtimeContext.locale, "vi-VN");
  assert.equal(runtimeContext.user_display_name, "jay@example.test");

  const appChatStoreSource = readFileSync("src/lib/cmo/app-chat-store.ts", "utf8");
  assert.match(appChatStoreSource, /buildSourceReviewContextFromMessage/);
  assert.match(appChatStoreSource, /runtimeContext/);
  assert.doesNotMatch(appChatStoreSource, /run.*GBrain.*source/i);

  const hermesMapperSource = readFileSync("src/lib/cmo/hermes-cmo-chat-mapper.ts", "utf8");
  assert.match(hermesMapperSource, /source_review_context/);
  assert.match(hermesMapperSource, /runtime_context/);

  console.log("CMO source acquisition checks passed");
} finally {
  rmSync(temp, { recursive: true, force: true });
}
