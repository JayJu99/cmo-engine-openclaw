import { execFileSync } from "node:child_process";
import fs from "node:fs";
import Module from "node:module";
import path from "node:path";
import process from "node:process";
import ts from "typescript";

const root = process.cwd();
const testKey = Buffer.alloc(32, 8).toString("base64url");

process.env.GOOGLE_OAUTH_CLIENT_ID ||= "lens-ga4-check-client";
process.env.GOOGLE_OAUTH_CLIENT_SECRET ||= "lens-ga4-check-secret";
process.env.GOOGLE_OAUTH_REDIRECT_URI ||= "http://localhost:3002/api/lens/oauth/google/callback";
process.env.LENS_OAUTH_STATE_SECRET ||= "lens-ga4-check-state-secret-32-bytes-minimum";
process.env.LENS_OAUTH_TOKEN_ENCRYPTION_KEY ||= testKey;

function repoPath(...segments) {
  return path.join(root, ...segments);
}

function loadTs(relativePath) {
  const filename = repoPath(relativePath);
  const source = fs.readFileSync(filename, "utf8").replace(/^import "server-only";\r?\n\r?\n?/m, "");
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      esModuleInterop: true,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: filename,
  }).outputText;
  const mod = new Module(filename);
  mod.filename = filename;
  mod.paths = Module._nodeModulePaths(path.dirname(filename));
  mod._compile(compiled, filename);

  return mod.exports;
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function assertFileIncludes(relativePath, expected, message) {
  const source = fs.readFileSync(repoPath(relativePath), "utf8");
  assert(source.includes(expected), message);
}

function assertFileExcludes(relativePath, pattern, message) {
  const source = fs.readFileSync(repoPath(relativePath), "utf8");
  assert(!pattern.test(source), message);
}

const ga4 = loadTs("src/lib/cmo/lens-ga4-properties.ts");
const metricSources = loadTs("src/lib/cmo/workspace-metric-sources.ts");

const normalized = ga4.normalizeGa4AccountSummaries({
  accountSummaries: [
    {
      account: "accounts/111",
      displayName: "Holdstation",
      propertySummaries: [
        {
          property: "properties/222",
          displayName: "Mini App Web",
          access_token: "must-not-appear",
          refresh_token: "must-not-appear",
          encrypted_refresh_token: "must-not-appear",
        },
      ],
    },
  ],
});
const normalizedText = JSON.stringify(normalized);

assert(normalized.properties[0].propertyId === "222", "GA4 property ID was not normalized from properties/{id}");
assert(normalized.properties[0].accountId === "111", "GA4 account ID was not normalized from accounts/{id}");
assert(!normalizedText.includes("access_token"), "Safe GA4 property list exposes access_token");
assert(!normalizedText.includes("refresh_token"), "Safe GA4 property list exposes refresh_token");
assert(!normalizedText.includes("encrypted_refresh_token"), "Safe GA4 property list exposes encrypted_refresh_token");

const safeMapping = metricSources.toSafeWorkspaceGa4MetricSourceMapping({
  tenant_id: "holdstation",
  workspace_id: "holdstation-mini-app",
  app_id: "holdstation-mini-app",
  source_type: "ga4",
  source_id: "ga4_native",
  auth_ref: "00000000-0000-0000-0000-000000000001",
  config_json: {
    provider: "ga4_native",
    propertyId: "222",
    propertyDisplayName: "Mini App Web",
    accountId: "111",
    accountDisplayName: "Holdstation",
    timezone: "Asia/Ho_Chi_Minh",
  },
  enabled: true,
  access_token: "must-not-appear",
  refresh_token: "must-not-appear",
  encrypted_refresh_token: "must-not-appear",
});
const safeMappingText = JSON.stringify(safeMapping);

assert(safeMapping.propertyId === "222", "Safe workspace mapping did not preserve propertyId");
assert(safeMapping.oauthAccountId === "00000000-0000-0000-0000-000000000001", "Safe workspace mapping did not read oauthAccountId from auth_ref");
assert(safeMapping.enabled === true, "Safe workspace mapping did not preserve enabled");
assert(!safeMappingText.includes("access_token"), "Safe workspace mapping exposes access_token");
assert(!safeMappingText.includes("refresh_token"), "Safe workspace mapping exposes refresh_token");
assert(!safeMappingText.includes("encrypted_refresh_token"), "Safe workspace mapping exposes encrypted_refresh_token");

assertFileIncludes(
  "src/app/api/lens/ga4/properties/route.ts",
  "requireWorkspaceRegistryEntry(appId)",
  "GA4 property route does not resolve appId through workspace registry",
);
assertFileIncludes(
  "src/app/api/lens/ga4/properties/route.ts",
  "oauth_account_wrong_tenant",
  "GA4 property route does not expose wrong-tenant error code",
);
assertFileIncludes(
  "src/lib/cmo/lens-google-oauth.ts",
  "oauth_account_wrong_tenant",
  "Google token helper does not reject wrong-tenant OAuth accounts",
);
assertFileIncludes(
  "src/lib/cmo/lens-google-oauth.ts",
  "token_revoked",
  "Google token helper does not expose token_revoked",
);
assertFileIncludes(
  "src/lib/cmo/lens-google-oauth.ts",
  "token_expired",
  "Google token helper does not expose token_expired",
);
assertFileIncludes(
  "src/lib/cmo/lens-google-oauth.ts",
  "google_token_exchange_failed",
  "Google token helper does not expose google_token_exchange_failed",
);
assertFileIncludes(
  "src/app/api/cmo/apps/[appId]/metric-sources/ga4/route.ts",
  "tenantId: entry.tenantId",
  "GA4 mapping route does not save derived tenantId",
);
assertFileIncludes(
  "src/app/api/cmo/apps/[appId]/metric-sources/ga4/route.ts",
  "workspaceId: entry.workspaceId",
  "GA4 mapping route does not save derived workspaceId",
);
assertFileIncludes(
  "src/app/api/cmo/apps/[appId]/metric-sources/ga4/route.ts",
  "appId: entry.appId",
  "GA4 mapping route does not save derived appId",
);
assertFileIncludes(
  "src/lib/cmo/workspace-metric-sources.ts",
  'source_id: "ga4_native"',
  "Workspace metric source helper does not use generic source_id",
);
assertFileIncludes(
  "src/lib/cmo/workspace-metric-sources.ts",
  "auth_ref: input.oauthAccountId",
  "Workspace metric source helper does not store oauthAccountId in auth_ref",
);
assertFileIncludes(
  "src/lib/cmo/workspace-metric-sources.ts",
  "config_json",
  "Workspace metric source helper does not store property config in config_json",
);
assertFileIncludes(
  "src/lib/cmo/workspace-metric-sources.ts",
  "enabled: true",
  "Workspace metric source helper does not enable the GA4 source",
);
assertFileIncludes(
  "src/lib/cmo/workspace-metric-sources.ts",
  'onConflict: "tenant_id,workspace_id,source_type,source_id"',
  "Workspace metric source helper does not upsert on the generic source registry key",
);
assertFileIncludes(
  "src/app/api/cmo/apps/[appId]/metric-sources/ga4/route.ts",
  "oauth_account_wrong_tenant",
  "GA4 mapping route does not reject wrong-tenant OAuth accounts",
);
assertFileIncludes(
  "src/app/api/cmo/apps/[appId]/metric-sources/ga4/route.ts",
  "unknown_app_id",
  "GA4 mapping route does not reject unknown appId with a stable code",
);

const checkedFiles = [
  "src/lib/cmo/lens-google-oauth.ts",
  "src/lib/cmo/lens-ga4-properties.ts",
  "src/lib/cmo/workspace-metric-sources.ts",
  "src/app/api/lens/ga4/properties/route.ts",
  "src/app/api/cmo/apps/[appId]/metric-sources/ga4/route.ts",
  "src/components/cmo-apps/app-workspace-view.tsx",
];
const loggingPattern = /console\.(log|debug|info|warn|error)\s*\([^)]*(refresh_token|access_token|id_token|encrypted_refresh_token|token)/is;
const forbiddenSideEffectPattern = /vault|gbrain|hermes|metabase|dune|facebook|\/api\/cmo\/vault|\/api\/cmo\/sessions\/suggested-vault-updates/i;
const forbiddenDedicatedColumnPattern = /\b(oauth_account_id|property_id|property_display_name|account_id|account_display_name)\b|^\s*(provider|timezone|status)\s+(text|uuid|jsonb|boolean)\b/im;

for (const file of checkedFiles) {
  assertFileExcludes(file, loggingPattern, `${file} appears to log token data`);
}

for (const file of [
  "src/lib/cmo/lens-ga4-properties.ts",
  "src/lib/cmo/workspace-metric-sources.ts",
  "src/app/api/lens/ga4/properties/route.ts",
  "src/app/api/cmo/apps/[appId]/metric-sources/ga4/route.ts",
]) {
  assertFileExcludes(file, forbiddenSideEffectPattern, `${file} references an out-of-scope M6.2 system`);
}

for (const file of [
  "src/lib/cmo/workspace-metric-sources.ts",
  "supabase/migrations/202606150002_workspace_metric_sources.sql",
]) {
  assertFileExcludes(file, forbiddenDedicatedColumnPattern, `${file} references a non-existent dedicated workspace_metric_sources column`);
}

execFileSync(process.execPath, [repoPath("scripts", "cmo-lens-oauth-foundation-check.mjs")], {
  cwd: root,
  stdio: "pipe",
  env: process.env,
});

console.log("CMO Lens GA4 property discovery check passed.");
