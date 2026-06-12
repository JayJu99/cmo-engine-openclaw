import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const routeSource = readFileSync("src/app/api/cmo/vault-graph/route.ts", "utf8");
const contractSource = readFileSync("src/lib/cmo/vault-graph-contract.ts", "utf8");
const adapterSource = readFileSync("src/lib/cmo/vault-graph-adapter.ts", "utf8");
const uiSource = readFileSync("src/components/vault-graph/vault-graph-page.tsx", "utf8");

assert.match(routeSource, /export async function GET\(/, "Vault Graph API must expose GET.");
assert.doesNotMatch(routeSource, /export async function (POST|PUT|PATCH|DELETE)\(/, "Vault Graph API must stay GET-only.");
assert.match(routeSource, /getVaultGraph\(/, "Vault Graph API route must use the adapter boundary.");
assert.match(contractSource, /vault_mutation:\s*false/, "Vault Graph API contract must declare vault_mutation: false.");
assert.match(contractSource, /VAULT_GRAPH_SOURCE_ROOT\s*=\s*"mock"/, "Vault Graph API must remain mock-backed by default.");
assert.match(adapterSource, /type VaultGraphAdapter/, "Vault Graph adapter interface must exist.");
assert.match(adapterSource, /class MockVaultGraphAdapter/, "Mock Vault Graph adapter must exist.");
assert.match(adapterSource, /class VaultAgentVaultGraphAdapter/, "Disabled future Vault Agent adapter scaffold must exist.");
assert.match(adapterSource, /SUPPORTED_VAULT_GRAPH_SOURCES:\s*VaultGraphSource\[\]\s*=\s*\["mock"\]/, "Only mock source may be supported for Phase 2B.");
assert.match(adapterSource, /vault_mutation\s*=\s*false as const/, "Adapters must declare vault_mutation=false.");
assert.match(adapterSource, /Unsupported CMO_VAULT_GRAPH_SOURCE/, "Unsupported source values must safely fall back with warning.");
assert.match(uiSource, /fetch\("\/api\/cmo\/vault-graph"/, "Vault Graph UI must load through the read-only API boundary.");

for (const [label, source] of [
  ["route", routeSource],
  ["contract", contractSource],
  ["adapter", adapterSource],
  ["ui", uiSource],
]) {
  assert.doesNotMatch(source, /\b(writeFile|appendFile|rm|unlink|mkdir|rmdir)\b/, `${label} must not use filesystem write methods.`);
  assert.doesNotMatch(source, /\b(createClient|supabase)\b/i, `${label} must not introduce Supabase access.`);
  assert.doesNotMatch(source, /https?:\/\/[^\s"']*(hermes|vault-agent|vault_agent)/i, `${label} must not call Hermes or Vault Agent endpoints.`);
}

assert.doesNotMatch(routeSource, /\bfetch\(/, "Vault Graph API route must not call external endpoints.");
assert.doesNotMatch(adapterSource, /\bfetch\(/, "Vault Graph adapters must not call external endpoints in Phase 2B.");

console.log("Vault Graph API contract guardrails passed.");
