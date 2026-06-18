import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const root = process.cwd();

function repoPath(...segments) {
  return path.join(root, ...segments);
}

function source(relativePath) {
  return fs.readFileSync(repoPath(relativePath), "utf8");
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
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

const migrationPath = "supabase/migrations/202606180003_workspace_metric_definitions.sql";
const helperPath = "src/lib/cmo/lens-metric-definitions.ts";
const ga4CatalogPath = "src/lib/cmo/lens-ga4-catalog.ts";
const dashboardPath = "src/components/cmo-apps/app-workspace-view.tsx";
const autoSyncPath = "src/lib/cmo/lens-auto-sync.ts";
const deepSyncPath = "src/lib/cmo/lens-ga4-deep-sync.ts";
const connectorPath = "src/lib/cmo/lens-product-connector.ts";
const metricsPackPath = "src/lib/cmo/lens-metrics-pack.ts";
const internalDefinitionsRoute = "src/app/api/internal/lens/apps/[appId]/metric-definitions/route.ts";
const internalComputeRoute = "src/app/api/internal/lens/apps/[appId]/metric-definitions/compute/route.ts";
const internalSnapshotsRoute = "src/app/api/internal/lens/apps/[appId]/metric-definitions/snapshots/route.ts";
const uiDefinitionsRoute = "src/app/api/cmo/apps/[appId]/metric-definitions/route.ts";
const uiComputeRoute = "src/app/api/cmo/apps/[appId]/metric-definitions/compute/route.ts";
const uiSnapshotsRoute = "src/app/api/cmo/apps/[appId]/metric-definitions/snapshots/route.ts";

for (const file of [
  migrationPath,
  helperPath,
  ga4CatalogPath,
  dashboardPath,
  autoSyncPath,
  deepSyncPath,
  connectorPath,
  metricsPackPath,
  internalDefinitionsRoute,
  internalComputeRoute,
  internalSnapshotsRoute,
  uiDefinitionsRoute,
  uiComputeRoute,
  uiSnapshotsRoute,
]) {
  assertFileExists(file, `${file} is missing`);
}

assertIncludes(migrationPath, "create table if not exists public.workspace_metric_definitions", "Definitions migration must create workspace_metric_definitions");
assertIncludes(migrationPath, "create table if not exists public.workspace_metric_definition_snapshots", "Definitions migration must create workspace_metric_definition_snapshots");
assertIncludes(migrationPath, "workspace_metric_definitions_unique_definition", "Definitions table must have workspace-level unique key");
assertIncludes(migrationPath, "workspace_metric_definition_snapshots_unique_snapshot", "Snapshots table must have range unique key");
assertIncludes(migrationPath, "alter table public.workspace_metric_definitions enable row level security", "Definitions table must enable RLS");
assertIncludes(migrationPath, "alter table public.workspace_metric_definition_snapshots enable row level security", "Snapshots table must enable RLS");
assertIncludes(migrationPath, "grant select, insert, update, delete on table public.workspace_metric_definitions to service_role", "Definitions table must grant service_role only");
assertIncludes(migrationPath, "grant select, insert, update, delete on table public.workspace_metric_definition_snapshots to service_role", "Snapshots table must grant service_role only");
assertExcludes(migrationPath, /\b(access_token|refresh_token|encrypted_refresh_token|id_token|raw_ga4_response|raw_google_response)\b/i, "Metric definitions migrations must not contain token/raw GA4 columns");

for (const route of [internalDefinitionsRoute, internalComputeRoute, internalSnapshotsRoute]) {
  assertIncludes(route, "authorizeLensInternalRequest", `${route} must require internal bearer auth`);
  assertExcludes(route, /requireRequestUserIfAuthRequired|cookies\(|next\/headers/i, `${route} must not use cookies/frontend auth`);
}

for (const route of [uiDefinitionsRoute, uiComputeRoute, uiSnapshotsRoute]) {
  assertIncludes(route, "requireRequestUserIfAuthRequired", `${route} must use existing app auth`);
}

assertIncludes(helperPath, 'schema_version: "product.metric_definitions.v1"', "Helper must emit product.metric_definitions.v1");
assertIncludes(helperPath, 'schema_version: "product.metric_definition_compute_result.v1"', "Helper must emit compute result contract");
assertIncludes(helperPath, 'schema_version: "product.metric_definition_snapshots.v1"', "Helper must emit snapshots contract");
assertIncludes(helperPath, "requireWorkspaceRegistryEntry(input.appId)", "Helper must resolve workspace/app server-side");
assertIncludes(helperPath, "validateMetricDefinitionPayload", "Definition payload validation must exist");
assertIncludes(helperPath, "activation_events", "Activation definition must support activation_events");
assertIncludes(helperPath, "activation_logic: \"any_event\"", "Activation MVP must use any_event logic");
assertIncludes(helperPath, "denominator: \"active_users\" | \"new_users\" | \"total_users\"", "Activation denominator allowlist must exist");
assertIncludes(helperPath, "retention_return_events", "Retention definition must support return events");
assertIncludes(helperPath, "retention_days", "Retention definition must support retention days");
assertIncludes(helperPath, "cohort_query_not_implemented", "Retention must safely mark unavailable when cohort query is not implemented");
assertIncludes(helperPath, "not_matured", "Retention must support not_matured status");
assertIncludes(helperPath, "no_denominator", "Activation must support no_denominator status");
assertIncludes(helperPath, "no_matching_event_rows", "Activation must distinguish no_data from zero");
assertIncludes(helperPath, "new_users_denominator_not_cohort_safe", "Activation must warn on new_users denominator cohort risk");
assertIncludes(helperPath, "runProductLensGa4AdHocQuery", "Activation computation must use Product GA4 ad-hoc query helper");
assertIncludes(helperPath, 'name: "eventName"', "Activation computation must query by eventName");
assertIncludes(helperPath, "values: input.definition.activation_events", "Activation computation must filter configured eventName values");
assertExcludes(helperPath, /engagementRate[\s\S]{0,600}activation_rate|activation_rate[\s\S]{0,600}engagementRate/, "Activation rate must not map from engagementRate");
assertExcludes(helperPath, /Start-Mining|Swap-Submit|Swap-Success|walletAuth|Tab-nav\.earn/, "Activation events must not be hardcoded in helper code");

const helperSource = source(helperPath);
const dryRunBranch = helperSource.slice(helperSource.indexOf("if (input.dryRun)"), helperSource.indexOf("const activationQuery", helperSource.indexOf("if (input.dryRun)")));
assert(!/runProductLensGa4AdHocQuery|fetch\(/.test(dryRunBranch), "Activation dryRun branch must not call GA4");
assertIncludes(ga4CatalogPath, "inListFilter", "GA4 ad-hoc helper must support multi-event eventName filtering");

assertIncludes(dashboardPath, "Metric Definitions", "Dashboard must include metric definition panel");
assertIncludes(dashboardPath, "Save definitions", "Dashboard must include save definitions button");
assertIncludes(dashboardPath, "Compute now", "Dashboard must include compute button");
assertIncludes(dashboardPath, "Metric definition needed", "Dashboard cards must preserve definition_needed state");
assertIncludes(dashboardPath, "Configured, calculation unavailable.", "Dashboard must show retention unavailable status safely");
assertIncludes(dashboardPath, "Configured, not enough mature data.", "Dashboard must show retention not_matured status safely");
assertIncludes(dashboardPath, "activated_users", "Dashboard must hydrate Activated Users from computed activation snapshot");
assertIncludes(dashboardPath, "activation_rate", "Dashboard must hydrate Activation Rate from computed activation snapshot");
assertIncludes(dashboardPath, "d1_retention", "Dashboard must refer to D1 retention only as definition snapshot metric");
assertIncludes(dashboardPath, "d7_retention", "Dashboard must refer to D7 retention only as definition snapshot metric");
assertExcludes(dashboardPath, /D1 Retention[\s\S]{0,800}ga4MetricSnapshot|D7 Retention[\s\S]{0,800}ga4MetricSnapshot/, "Dashboard must not populate retention from GA4 core snapshots");
assertExcludes(dashboardPath, /Activation Rate[\s\S]{0,800}engagementRate|engagementRate[\s\S]{0,800}Activation Rate/, "Dashboard must not map engagementRate to Activation Rate");
assertExcludes(dashboardPath, /Start-Mining|Swap-Submit|Swap-Success|walletAuth|Tab-nav\.earn/, "Dashboard must not hardcode workspace-specific activation events");

assertIncludes(autoSyncPath, "runProductMetricDefinitionCompute", "Hourly auto-sync must trigger metric definition compute");
assertIncludes(autoSyncPath, 'definitionTypes: ["activation"]', "Hourly auto-sync must compute activation only");
assertIncludes(autoSyncPath, "metric_definitions", "Hourly auto-sync must add safe metric definition summary");
assertIncludes(deepSyncPath, "runProductMetricDefinitionCompute", "Daily deep sync must trigger metric definition compute");
assertIncludes(deepSyncPath, 'definitionTypes: ["activation", "retention"]', "Daily deep sync must compute activation and retention");
assertIncludes(deepSyncPath, "metric_definitions", "Daily deep sync must add safe metric definition summary");
assertIncludes(connectorPath, "activation_event", "Product connector must expose activation definition status");
assertIncludes(connectorPath, "retention_logic", "Product connector must expose retention definition status");
assertIncludes(metricsPackPath, "metricDefinitionSnapshots", "Metrics pack must consume metric definition snapshots for Lens");

for (const file of [helperPath, autoSyncPath, deepSyncPath]) {
  assertIncludes(file, "raw_ga4_response_included: false", `${file} must assert no raw GA4 response`);
  assertIncludes(file, "no_tokens_returned: true", `${file} must assert no tokens returned`);
  assertIncludes(file, "vault_write_performed: false", `${file} must assert no Vault writes`);
  assertIncludes(file, "gbrain_used: false", `${file} must assert no GBrain use`);
  assertIncludes(file, "hermes_called: false", `${file} must assert no Hermes calls`);
}

assertIncludes(connectorPath, "raw_ga4_response_included: false", "Connector must assert no raw GA4 response");
assertIncludes(connectorPath, "no_tokens_returned: true", "Connector must assert no tokens returned");
assertIncludes(connectorPath, "vault_write_performed: false", "Connector must assert no Vault writes");
assertIncludes(connectorPath, "gbrain_used: false", "Connector must assert no GBrain use");

for (const file of [helperPath, autoSyncPath, deepSyncPath, connectorPath, metricsPackPath]) {
  assertExcludes(file, /\b(access_token|refresh_token|encrypted_refresh_token|id_token)\s*:/i, `${file} must not expose token fields`);
  assertExcludes(file, /\/agents\/|runHermes|callHermes|hermes-cmo-runtime|importGBrain|syncGBrain|embedGBrain|dreamGBrain|extractGBrain|queryGBrain|callGBrain/i, `${file} must not call Hermes or GBrain`);
  assertExcludes(file, /final\s+answer|answer\s*=/i, `${file} must not synthesize final CMO answers`);
}

console.log("CMO Lens metric definitions check passed.");
