import fs from "node:fs";
import Module from "node:module";
import path from "node:path";
import process from "node:process";
import ts from "typescript";

const root = process.cwd();
const testKey = Buffer.alloc(32, 7).toString("base64url");

process.env.GOOGLE_OAUTH_CLIENT_ID ||= "lens-oauth-check-client";
process.env.GOOGLE_OAUTH_CLIENT_SECRET ||= "lens-oauth-check-secret";
process.env.GOOGLE_OAUTH_REDIRECT_URI ||= "http://localhost:3002/api/lens/oauth/google/callback";
process.env.LENS_OAUTH_STATE_SECRET ||= "lens-oauth-check-state-secret-32-bytes-minimum";
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

function assertThrows(fn, messageIncludes) {
  try {
    fn();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    assert(message.includes(messageIncludes), `Expected error to include "${messageIncludes}", got "${message}"`);
    return;
  }

  throw new Error(`Expected function to throw "${messageIncludes}"`);
}

const state = loadTs("src/lib/cmo/lens-oauth-state.ts");
const crypto = loadTs("src/lib/cmo/lens-oauth-crypto.ts");
const google = loadTs("src/lib/cmo/lens-google-oauth.ts");
const accounts = loadTs("src/lib/cmo/lens-oauth-accounts.ts");
const redirects = loadTs("src/lib/cmo/lens-oauth-redirect.ts");

const signedState = state.createLensOAuthState({
  tenant_id: "holdstation",
  workspace_id: "holdstation-mini-app",
  app_id: "holdstation-mini-app",
  return_to: "/apps/holdstation-mini-app?tab=dashboard",
  nonce: "check-nonce",
});
const oauthUrl = google.buildGoogleOAuthAuthorizationUrl({
  clientId: process.env.GOOGLE_OAUTH_CLIENT_ID,
  redirectUri: process.env.GOOGLE_OAUTH_REDIRECT_URI,
  state: signedState,
});

assert(oauthUrl.searchParams.get("redirect_uri") === "http://localhost:3002/api/lens/oauth/google/callback", "OAuth URL has wrong redirect URI");
assert((oauthUrl.searchParams.get("scope") ?? "").includes("https://www.googleapis.com/auth/analytics.readonly"), "OAuth URL is missing analytics.readonly scope");
assert(oauthUrl.searchParams.get("access_type") === "offline", "OAuth URL is missing offline access");
assert(oauthUrl.searchParams.get("prompt") === "consent", "OAuth URL is missing consent prompt");
assert(oauthUrl.searchParams.get("include_granted_scopes") === "true", "OAuth URL is missing include_granted_scopes");
assert(Boolean(oauthUrl.searchParams.get("state")), "OAuth URL is missing signed state");

assert(
  redirects.normalizeLensOAuthReturnTo("/apps/holdstation-mini-app?tab=dashboard", "holdstation-mini-app")
    === "/apps/holdstation-mini-app?tab=dashboard",
  "Relative Lens OAuth returnTo was not preserved",
);
assert(
  redirects.normalizeLensOAuthReturnTo("http://localhost:3002/apps/holdstation-mini-app?tab=dashboard", "holdstation-mini-app")
    === "/apps/holdstation-mini-app?tab=dashboard",
  "Absolute localhost Lens OAuth returnTo was not rejected",
);
assert(
  redirects.normalizeLensOAuthReturnTo("holdstation-mini-app?tab=dashboard", "holdstation-mini-app")
    === "/apps/holdstation-mini-app?tab=dashboard",
  "Malformed Lens OAuth returnTo did not fall back to app dashboard",
);
const productionRedirect = redirects.buildLensOAuthFinalRedirect(
  "https://cmo.jayju.cloud",
  "/apps/holdstation-mini-app?tab=dashboard",
  "connected",
);
assert(
  productionRedirect.toString() === "https://cmo.jayju.cloud/apps/holdstation-mini-app?tab=dashboard&lensOAuth=connected",
  `Production Lens OAuth final redirect is wrong: ${productionRedirect.toString()}`,
);
assert(!productionRedirect.toString().includes("localhost:3002"), "Production Lens OAuth final redirect includes localhost:3002");

assertThrows(() => state.verifyLensOAuthState(`${signedState}tampered`), "signature");
const expiredState = state.createLensOAuthState({
  nonce: "expired",
  expires_at: new Date(Date.now() - 1000).toISOString(),
});
assertThrows(() => state.verifyLensOAuthState(expiredState), "Expired");

const encrypted = crypto.encryptLensOAuthToken("refresh-token-check");
assert(encrypted !== "refresh-token-check", "Encrypted token should not equal plaintext");
assert(crypto.decryptLensOAuthToken(encrypted) === "refresh-token-check", "Encrypted token did not roundtrip");

const safe = accounts.toSafeLensOAuthAccount({
  id: "acct_1",
  tenant_id: "holdstation",
  provider: "google",
  google_email: "owner@example.com",
  scopes: ["openid"],
  encrypted_refresh_token: "must-not-appear",
  refresh_token: "must-not-appear",
  access_token: "must-not-appear",
  status: "connected",
  created_at: "2026-06-15T00:00:00.000Z",
  updated_at: "2026-06-15T00:00:00.000Z",
  last_refresh_at: null,
  last_error: null,
});
const safeText = JSON.stringify(safe);
assert(!safeText.includes("encrypted_refresh_token"), "Safe metadata exposes encrypted_refresh_token");
assert(!safeText.includes("refresh_token"), "Safe metadata exposes refresh_token");
assert(!safeText.includes("access_token"), "Safe metadata exposes access_token");

const checkedFiles = [
  "src/lib/cmo/lens-oauth-crypto.ts",
  "src/lib/cmo/lens-oauth-state.ts",
  "src/lib/cmo/lens-google-oauth.ts",
  "src/lib/cmo/lens-oauth-accounts.ts",
  "src/lib/cmo/lens-oauth-redirect.ts",
  "src/app/api/lens/oauth/google/start/route.ts",
  "src/app/api/lens/oauth/google/callback/route.ts",
  "src/app/api/lens/oauth/google/accounts/route.ts",
];
const loggingPattern = /console\.(log|debug|info|warn|error)\s*\([^)]*(refresh_token|access_token|id_token|encrypted_refresh_token|token)/is;

for (const file of checkedFiles) {
  const source = fs.readFileSync(repoPath(file), "utf8");
  assert(!loggingPattern.test(source), `${file} appears to log token data`);
}

const startRoute = fs.readFileSync(repoPath("src/app/api/lens/oauth/google/start/route.ts"), "utf8");
assert(startRoute.includes("requireWorkspaceRegistryEntry(appId)"), "Start route does not resolve appId through workspace registry");

console.log("CMO Lens OAuth foundation check passed.");
