import { execFileSync } from "node:child_process";
import fs from "node:fs";
import Module from "node:module";
import path from "node:path";
import process from "node:process";
import ts from "typescript";

const root = process.cwd();
const testKey = Buffer.alloc(32, 9).toString("base64url");

process.env.GOOGLE_OAUTH_CLIENT_ID ||= "lens-ga4-verify-check-client";
process.env.GOOGLE_OAUTH_CLIENT_SECRET ||= "lens-ga4-verify-check-secret";
process.env.GOOGLE_OAUTH_REDIRECT_URI ||= "http://localhost:3002/api/lens/oauth/google/callback";
process.env.LENS_OAUTH_STATE_SECRET ||= "lens-ga4-verify-check-state-secret-32-bytes-minimum";
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

function source(relativePath) {
  return fs.readFileSync(repoPath(relativePath), "utf8");
}

function assertFileExists(relativePath, message) {
  assert(fs.existsSync(repoPath(relativePath)), message);
}

function assertIncludes(relativePath, expected, message) {
  assert(source(relativePath).includes(expected), message);
}

function assertExcludes(relativePath, pattern, message) {
  assert(!pattern.test(source(relativePath)), message);
}

function allSourceText() {
  const files = execFileSync("git", ["ls-files", "src", "scripts"], {
    cwd: root,
    encoding: "utf8",
  })
    .split(/\r?\n/)
    .filter(Boolean)
    .filter((file) => ![
      "scripts/cmo-lens-ga4-source-verification-check.mjs",
      "scripts/cmo-lens-ga4-data-sync-check.mjs",
      "src/lib/cmo/lens-ga4-data.ts",
      "src/lib/cmo/workspace-metric-snapshots.ts",
      "src/app/api/cmo/apps/[appId]/metric-sources/ga4/sync/route.ts",
      "src/app/api/cmo/apps/[appId]/metric-sources/ga4/snapshots/route.ts",
    ].includes(file));

  return files.map((file) => source(file)).join("\n");
}

const verifyRoutePath = "src/app/api/cmo/apps/[appId]/metric-sources/ga4/verify/route.ts";
const getRoutePath = "src/app/api/cmo/apps/[appId]/metric-sources/ga4/route.ts";
const metricSourcesPath = "src/lib/cmo/workspace-metric-sources.ts";
const ga4PropertiesPath = "src/lib/cmo/lens-ga4-properties.ts";
const uiPath = "src/components/cmo-apps/app-workspace-view.tsx";

assertFileExists(verifyRoutePath, "M6.3 verify route is missing");

const ga4 = loadTs(ga4PropertiesPath);
const metricSources = loadTs(metricSourcesPath);

assert(ga4.ga4VerificationStatusForCode("token_revoked") === "needs_reconnect", "token_revoked must map to needs_reconnect");
assert(ga4.ga4VerificationStatusForCode("token_expired") === "needs_reconnect", "token_expired must map to needs_reconnect");
assert(ga4.ga4VerificationStatusForCode("oauth_account_not_found") === "needs_reconnect", "oauth_account_not_found must map to needs_reconnect");
assert(ga4.ga4VerificationStatusForCode("property_not_found") === "property_inaccessible", "property_not_found must map to property_inaccessible");
assert(ga4.ga4VerificationStatusForCode("property_access_denied") === "property_inaccessible", "property_access_denied must map to property_inaccessible");
assert(ga4.ga4VerificationStatusForCode("ga4_admin_api_unavailable") === "error", "GA4 Admin API unavailable must map to error");

const safeMapping = metricSources.toSafeWorkspaceGa4MetricSourceMapping({
  tenant_id: "holdstation",
  workspace_id: "holdstation-mini-app",
  app_id: "holdstation-mini-app",
  source_type: "ga4",
  source_id: "ga4_native",
  auth_ref: "00000000-0000-0000-0000-000000000001",
  config_json: {
    provider: "ga4_native",
    propertyId: "487138147",
    propertyDisplayName: "world.holdstation.com",
    accountId: "123",
    accountDisplayName: "hs-web",
    timezone: "Asia/Saigon",
    verificationStatus: "verified",
    lastVerifiedAt: "2026-06-15T00:00:00.000Z",
    lastVerificationError: null,
    lastVerificationCode: null,
    access_token: "must-not-appear",
    refresh_token: "must-not-appear",
    encrypted_refresh_token: "must-not-appear",
  },
  enabled: true,
});
const safeMappingText = JSON.stringify(safeMapping);

assert(safeMapping.verificationStatus === "verified", "Safe mapping omits verificationStatus");
assert(safeMapping.lastVerifiedAt === "2026-06-15T00:00:00.000Z", "Safe mapping omits lastVerifiedAt");
assert(!safeMappingText.includes("access_token"), "Safe mapping exposes access_token");
assert(!safeMappingText.includes("refresh_token"), "Safe mapping exposes refresh_token");
assert(!safeMappingText.includes("encrypted_refresh_token"), "Safe mapping exposes encrypted_refresh_token");

assertIncludes(verifyRoutePath, "requireWorkspaceRegistryEntry(appId)", "Verify route must resolve appId through workspace registry");
assertIncludes(verifyRoutePath, "tenantId: entry.tenantId", "Verify route must derive tenantId from registry");
assertIncludes(verifyRoutePath, "workspaceId: entry.workspaceId", "Verify route must derive workspaceId from registry");
assertIncludes(verifyRoutePath, "appId: entry.appId", "Verify route must derive appId from registry");
assertIncludes(verifyRoutePath, "propertyId: mapping.propertyId", "Verify route must verify the propertyId from saved mapping");
assertExcludes(verifyRoutePath, /request\.json|body\.propertyId|propertyId:\s*body/i, "Verify route must not read propertyId from client body");
assertIncludes(verifyRoutePath, "getLensGoogleAccessToken", "Verify route must use server-only Google access token helper");
assertIncludes(verifyRoutePath, "updateWorkspaceGa4MetricSourceVerification", "Verify route must persist verification result");

assertIncludes(getRoutePath, "appId: entry.appId", "GET mapping route must load mapping by derived appId");
assertIncludes(metricSourcesPath, "verificationStatus", "Workspace metric source helper must include verification fields");
assertIncludes(metricSourcesPath, ".update({ config_json })", "Verification fields must be stored inside config_json");
assertExcludes(metricSourcesPath, /\.update\(\s*\{[^}]*verificationStatus/is, "Verification status must not be written as a dedicated column");
assertIncludes(uiPath, "Verify connection", "UI must expose Verify connection action");
assertIncludes(uiPath, "Verify again", "UI must expose Verify again action");
assertIncludes(uiPath, "Property discovery enabled. Metrics fetching comes in M6.4.", "UI must keep M6.4 metrics copy");
assertIncludes(uiPath, "Saved", "UI must show Saved when selected property is already mapped");

for (const file of [verifyRoutePath, getRoutePath, ga4PropertiesPath]) {
  assertExcludes(file, /access_token|refresh_token|encrypted_refresh_token|id_token/i, `${file} exposes a raw Google token field`);
  assertExcludes(file, /runReport|runRealtimeReport/i, `${file} calls GA4 Data API metrics endpoints`);
  assertExcludes(file, /\/agents\/|\/api\/cmo\/vault|gbrain|GBrain/i, `${file} references an out-of-scope Hermes/Vault/GBrain route`);
}

assertExcludes(metricSourcesPath, /runReport|runRealtimeReport/i, `${metricSourcesPath} calls GA4 Data API metrics endpoints`);
assertExcludes(metricSourcesPath, /\/agents\/|\/api\/cmo\/vault|gbrain|GBrain/i, `${metricSourcesPath} references an out-of-scope Hermes/Vault/GBrain route`);

const repoSource = allSourceText();
assert(!/runReport|runRealtimeReport/i.test(repoSource), "Repo must not call GA4 Data API runReport/runRealtimeReport in M6.3");

execFileSync(process.execPath, [repoPath("scripts", "cmo-lens-oauth-foundation-check.mjs")], {
  cwd: root,
  stdio: "pipe",
  env: process.env,
});

execFileSync(process.execPath, [repoPath("scripts", "cmo-lens-ga4-property-discovery-check.mjs")], {
  cwd: root,
  stdio: "pipe",
  env: process.env,
});

console.log("CMO Lens GA4 source verification check passed.");
