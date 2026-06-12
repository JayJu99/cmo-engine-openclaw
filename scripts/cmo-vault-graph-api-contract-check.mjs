import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const routeSource = readFileSync("src/app/api/cmo/vault-graph/route.ts", "utf8");
const contractSource = readFileSync("src/lib/cmo/vault-graph-contract.ts", "utf8");
const uiSource = readFileSync("src/components/vault-graph/vault-graph-page.tsx", "utf8");

assert.match(routeSource, /export async function GET\(/, "Vault Graph API must expose GET.");
assert.doesNotMatch(routeSource, /export async function (POST|PUT|PATCH|DELETE)\(/, "Vault Graph API must stay GET-only.");
assert.match(contractSource, /vault_mutation:\s*false/, "Vault Graph API contract must declare vault_mutation: false.");
assert.match(contractSource, /VAULT_GRAPH_SOURCE_ROOT\s*=\s*"mock"/, "Vault Graph API must remain mock-backed in Phase 2A.");
assert.match(uiSource, /fetch\("\/api\/cmo\/vault-graph"/, "Vault Graph UI must load through the read-only API boundary.");

for (const [label, source] of [
  ["route", routeSource],
  ["contract", contractSource],
  ["ui", uiSource],
]) {
  assert.doesNotMatch(source, /\b(writeFile|appendFile|rm|unlink|mkdir|rmdir)\b/, `${label} must not use filesystem write methods.`);
  assert.doesNotMatch(source, /\b(createClient|supabase)\b/i, `${label} must not introduce Supabase access.`);
  assert.doesNotMatch(source, /\b(Hermes|Vault Agent|VaultAgent)\b/, `${label} must not call Hermes or Vault Agent.`);
}

console.log("Vault Graph API contract guardrails passed.");
