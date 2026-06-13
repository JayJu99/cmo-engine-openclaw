import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const routeSource = readFileSync("src/app/api/cmo/vault-graph/route.ts", "utf8");
const contractSource = readFileSync("src/lib/cmo/vault-graph-contract.ts", "utf8");
const adapterSource = readFileSync("src/lib/cmo/vault-graph-adapter.ts", "utf8");
const uiSource = readFileSync("src/components/vault-graph/vault-graph-page.tsx", "utf8");
const configSource = readFileSync("src/lib/cmo/config.ts", "utf8");

assert.match(routeSource, /export async function GET\(/, "Vault Graph API must expose GET.");
assert.doesNotMatch(routeSource, /export async function (POST|PUT|PATCH|DELETE)\(/, "Vault Graph API must stay GET-only.");
assert.match(routeSource, /getVaultGraph\(/, "Vault Graph API route must use the adapter boundary.");
assert.match(routeSource, /VAULT_GRAPH_QUERY_PARAMS/, "Vault Graph API route must whitelist forwarded query params.");
assert.match(contractSource, /vault_mutation:\s*false/, "Vault Graph API contract must declare vault_mutation: false.");
assert.match(contractSource, /VAULT_GRAPH_SOURCE_ROOT\s*=\s*"mock"/, "Vault Graph API must remain mock-backed by default.");
assert.match(contractSource, /VAULT_GRAPH_VAULT_AGENT_SOURCE_ROOT\s*=\s*"vault-agent"/, "Vault Agent source root must be explicit.");
assert.match(adapterSource, /type VaultGraphAdapter/, "Vault Graph adapter interface must exist.");
assert.match(adapterSource, /class MockVaultGraphAdapter/, "Mock Vault Graph adapter must exist.");
assert.match(adapterSource, /class VaultAgentVaultGraphAdapter/, "Vault Agent adapter must exist.");
assert.match(adapterSource, /SUPPORTED_VAULT_GRAPH_SOURCES:\s*VaultGraphSource\[\]\s*=\s*\["mock", "vault-agent"\]/, "Only mock and vault-agent sources may be supported for Phase 2E.");
assert.match(adapterSource, /VAULT_AGENT_GRAPH_ENDPOINT\s*=\s*"\/agents\/vault-agent\/vault-graph"/, "Vault Agent adapter must call only the graph endpoint.");
assert.match(adapterSource, /method:\s*"GET"/, "Vault Agent adapter must use GET.");
assert.match(adapterSource, /Authorization:\s*`Bearer \$\{apiKey\}`/, "Vault Agent adapter may send bearer auth when configured.");
assert.match(adapterSource, /buildSafeVaultAgentGraphErrorResponse/, "Vault Agent adapter must have safe empty failure behavior.");
assert.match(adapterSource, /FORBIDDEN_RESPONSE_TOKENS/, "Vault Agent adapter must scan forbidden response tokens.");
assert.match(adapterSource, /Unsupported CMO_VAULT_GRAPH_SOURCE/, "Unsupported source values must safely fall back with warning.");
assert.match(configSource, /CMO_VAULT_AGENT_GRAPH_BASE_URL/, "Graph adapter must support graph-specific base URL env.");
assert.match(configSource, /CMO_VAULT_AGENT_GRAPH_API_KEY/, "Graph adapter must support graph-specific API key env.");
assert.match(configSource, /CMO_VAULT_AGENT_GRAPH_TIMEOUT_MS/, "Graph adapter must support graph-specific timeout env.");
assert.match(uiSource, /fetch\("\/api\/cmo\/vault-graph"/, "Vault Graph UI must load through the read-only API boundary.");
assert.match(uiSource, /Vault Agent/, "Vault Graph UI must show Vault Agent source status.");
assert.match(uiSource, /Source warning/, "Vault Graph UI must show safe warning state.");

for (const [label, source] of [
  ["route", routeSource],
  ["contract", contractSource],
  ["adapter", adapterSource],
  ["ui", uiSource],
]) {
  assert.doesNotMatch(source, /\b(writeFile|appendFile|rm|unlink|mkdir|rmdir)\b/, `${label} must not use filesystem write methods.`);
  assert.doesNotMatch(source, /\b(createClient|supabase)\b/i, `${label} must not introduce Supabase access.`);
}

assert.doesNotMatch(routeSource, /\bfetch\(/, "Vault Graph API route must not call external endpoints directly.");
assert.doesNotMatch(adapterSource, /\/agents\/vault-agent\/(?!vault-graph\b)[A-Za-z0-9/_-]+/, "Vault Graph adapter must not reference non-graph Vault Agent endpoints.");
assert.doesNotMatch(adapterSource, /method:\s*"(POST|PUT|PATCH|DELETE)"/, "Vault Graph adapter must not use mutation HTTP methods.");

const smokeSource = process.argv.includes("--vault-agent") || process.env.CMO_VAULT_GRAPH_SMOKE_SOURCE === "vault-agent"
  ? "vault-agent"
  : "mock";

if (smokeSource === "vault-agent") {
  await checkLiveProductVaultAgentResponse();
}

console.log("Vault Graph API contract guardrails passed.");

async function checkLiveProductVaultAgentResponse() {
  const baseUrl = (process.env.CMO_SMOKE_BASE_URL || "http://127.0.0.1:3002").replace(/\/+$/, "");
  const response = await fetch(`${baseUrl}/api/cmo/vault-graph`, {
    method: "GET",
    cache: "no-store",
  });

  assert.equal(response.ok, true, `Vault Graph API returned HTTP ${response.status}.`);
  const payload = await response.json();
  const serialized = JSON.stringify(payload).toLowerCase();

  assert.equal(payload.schema_version, "cmo.vault_graph.v1");
  assert.equal(payload.vault_mutation, false);
  assert.equal(payload.source_root, "vault-agent");
  assert.equal(Array.isArray(payload.nodes), true);
  assert.equal(Array.isArray(payload.edges), true);

  for (const token of [
    "/users/jay",
    "/users/",
    "c:\\",
    "supabase_user_id",
    "raw_activity_text",
    "original_user_message",
    "final_answer",
    "content_hash",
    "email",
  ]) {
    assert.equal(serialized.includes(token), false, `Vault Agent graph response leaked forbidden token: ${token}`);
  }
}
