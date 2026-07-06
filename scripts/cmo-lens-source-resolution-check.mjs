import assert from "node:assert/strict";
import { createRequire } from "node:module";
import fs from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import ts from "typescript";

const root = process.cwd();
const resolverPath = path.join(root, "src", "lib", "cmo", "lens-metric-source-resolution.ts");

function source(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function assertIncludes(relativePath, expected, message) {
  assert.ok(source(relativePath).includes(expected), message);
}

function assertExcludes(relativePath, pattern, message) {
  assert.doesNotMatch(source(relativePath), pattern, message);
}

async function loadResolverHarness() {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "cmo-lens-source-resolution-"));
  const outputPath = path.join(tmpDir, "lens-metric-source-resolution.cjs");
  const output = ts.transpileModule(fs.readFileSync(resolverPath, "utf8"), {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      esModuleInterop: true,
      importsNotUsedAsValues: ts.ImportsNotUsedAsValues.Remove,
    },
    fileName: resolverPath,
  }).outputText;

  await writeFile(outputPath, output, "utf8");

  return {
    tmpDir,
    resolver: createRequire(import.meta.url)(outputPath),
  };
}

function ga4(status = "ready") {
  return {
    source_type: "ga4_utm",
    source_id: "ga4_native",
    status,
    available_metrics: [
      "social_referral_sessions",
      "landing_page_sessions",
      "engaged_sessions",
      "utm_campaign_sessions",
    ],
  };
}

function meta(status = "ready") {
  return {
    source_type: "meta_page_insights",
    source_id: "facebook_channel_metrics",
    status,
    available_metrics: ["facebook_views", "facebook_engagement", "facebook_follower_count"],
    missing_metrics: ["facebook_link_clicks", "facebook_ctr"],
  };
}

function xPost(status = "ready") {
  return {
    source_type: "x_post_insights",
    source_id: "x_posts",
    status,
    available_metrics: ["impressions", "likes", "reposts", "replies"],
  };
}

function xApi(status = "ready") {
  return {
    source_type: "x_api",
    source_id: "x_api_status",
    status,
    available_metrics: ["impressions", "engagements", "profile_clicks"],
  };
}

function resolve(resolver, input) {
  return resolver.resolveLensMetricSourceResolution(input);
}

function requirementFor(result, sourceType) {
  return result.missing_requirements.find((requirement) => requirement.source_type === sourceType);
}

function sourceTypes(items) {
  return items.map((item) => item.source_type);
}

function assertFallbacks(result, label) {
  const fallbacks = sourceTypes(result.fallback_sources);

  assert.ok(fallbacks.includes("manual_input"), `${label}: expected manual_input fallback`);
  assert.ok(fallbacks.includes("estimated"), `${label}: expected estimated fallback`);
}

function assertNoFakeMetricValues(result, label) {
  const serialized = JSON.stringify(result);

  assert.doesNotMatch(serialized, /\b(?:baseline_value|current_value|baselineMetric|currentMetric|baselineStatusValue)\b/i, `${label}: resolver must not emit fake baseline/current metric values`);
}

function assertProductionHardcodeAudit() {
  const productionSource = source("src/lib/cmo/lens-metric-source-resolution.ts");

  assert.doesNotMatch(
    productionSource,
    /\.includes\(\s*["'](?:traffic|facebook|meta|engagement|utm|referral|session)["']\s*\)/,
    "Production resolver must not classify goal kind with keyword includes",
  );
  assert.doesNotMatch(
    productionSource,
    /raw_user_goal_message[\s\S]{0,500}(?:\.includes|\.match|\.test|RegExp|twitter|x_engagement)/,
    "Production resolver must not classify raw_user_goal_message with keyword or X/Twitter parsing",
  );
  assert.doesNotMatch(
    productionSource,
    /\/[^/\n]*(?:twitter|\\bx|x\\b)[^/\n]*\/\.[a-z]*test|\.test\([^)]*raw_user_goal_message/,
    "Production resolver must not use X/Twitter regex parsing for raw user text",
  );
  assert.equal(productionSource.includes("input.raw_user_goal_message"), false, "Production resolver must not read raw_user_goal_message for source selection");
}

async function assertResolverBehavior() {
  const { tmpDir, resolver } = await loadResolverHarness();
  const results = [];

  try {
    assert.equal(resolver.LENS_METRIC_SOURCE_RESOLUTION_CONTRACT, "lens.metric_source_resolution.v1");
    assert.deepEqual(resolver.LENS_METRIC_SOURCE_TYPES_V1, [
      "ga4_utm",
      "meta_page_insights",
      "x_post_insights",
      "x_api",
      "manual_input",
      "estimated",
    ]);

    let result = resolve(resolver, {
      raw_user_goal_message: "Increase website traffic this week.",
      normalized_goal_kind: undefined,
      capabilities: {
        app: [ga4("ready")],
      },
    });
    results.push(result);
    assert.equal(result.goal_kind, "unknown", "missing normalized goal kind: expected unknown");
    assert.equal(result.resolved_metric, "unknown_metric", "missing normalized goal kind: expected unknown metric");
    assert.equal(result.primary_source, null, "missing normalized goal kind: GA4 readiness must not infer traffic primary");
    assert.deepEqual(result.enrichment_sources, [], "missing normalized goal kind: expected no enrichment sources");
    assert.equal(result.baseline_status, "missing", "missing normalized goal kind: expected missing baseline status");
    assert.equal(result.confidence, "low", "missing normalized goal kind: expected low confidence");
    assertFallbacks(result, "missing normalized goal kind");
    const missingGoalMetricRequirement = result.missing_requirements.find((requirement) => requirement.key === "goal_metric_resolution_missing");
    assert.equal(missingGoalMetricRequirement?.severity, "blocking", "missing normalized goal kind: expected blocking goal metric requirement");
    assert.equal(missingGoalMetricRequirement?.action, "ask_cmo_to_resolve_goal_metric", "missing normalized goal kind: expected CMO metric resolution action");
    assertNoFakeMetricValues(result, "missing normalized goal kind");

    assert.equal(
      resolver.resolveLensMetricGoalKind({
        raw_user_goal_message: "Increase website traffic this week.",
        normalized_goal_kind: undefined,
      }),
      "unknown",
      "raw user goal text must not infer traffic without normalized_goal_kind",
    );
    assert.equal(
      resolver.resolveLensMetricGoalKind({
        raw_user_goal_message: "Improve Twitter engagement this week.",
        normalized_goal_kind: "twitter_engagement",
      }),
      "x_engagement",
      "explicit twitter_engagement alias should normalize to x_engagement",
    );

    result = resolve(resolver, {
      raw_user_goal_message: "Increase website traffic this week.",
      normalized_goal_kind: "traffic",
      capabilities: {
        app: [ga4("ready")],
        channel: [meta("missing")],
      },
    });
    results.push(result);
    assert.equal(result.contract, "lens.metric_source_resolution.v1", "traffic GA4 ready: expected contract");
    assert.equal(result.resolved_metric, "website_traffic", "traffic GA4 ready: expected website traffic metric");
    assert.equal(result.primary_source?.source_type, "ga4_utm", "traffic GA4 ready: expected GA4 primary");
    assert.equal(requirementFor(result, "meta_page_insights")?.severity, "non_blocking", "traffic GA4 ready: Meta missing must be non-blocking");
    assert.equal(result.baseline_status, "available", "traffic GA4 ready: expected available baseline status");
    assertFallbacks(result, "traffic GA4 ready");
    assertNoFakeMetricValues(result, "traffic GA4 ready");

    result = resolve(resolver, {
      raw_user_goal_message: "Grow traffic from X this week.",
      normalized_goal_kind: "traffic",
      capabilities: {
        app: [ga4("missing")],
        channel: [xPost("ready")],
      },
    });
    results.push(result);
    assert.equal(result.primary_source, null, "traffic GA4 missing + X ready: X must not become website traffic primary");
    assert.ok(sourceTypes(result.enrichment_sources).includes("x_post_insights"), "traffic GA4 missing + X ready: expected X enrichment");
    assert.equal(requirementFor(result, "ga4_utm")?.severity, "blocking", "traffic GA4 missing + X ready: GA4 missing blocks traffic truth");
    assert.equal(result.baseline_status, "missing", "traffic GA4 missing + X ready: expected missing baseline status");
    assertFallbacks(result, "traffic GA4 missing + X ready");
    assertNoFakeMetricValues(result, "traffic GA4 missing + X ready");

    result = resolve(resolver, {
      raw_user_goal_message: "Increase website traffic from social.",
      normalized_goal_kind: "traffic",
      capabilities: {
        app: [ga4("ready")],
        channel: [xPost("missing")],
      },
    });
    results.push(result);
    assert.equal(result.primary_source?.source_type, "ga4_utm", "traffic GA4 ready + X missing: expected GA4 primary");
    assert.equal(requirementFor(result, "x_post_insights")?.severity, "non_blocking", "traffic GA4 ready + X missing: X missing must be non-blocking");
    assert.equal(result.baseline_status, "available", "traffic GA4 ready + X missing: expected available baseline status");
    assertNoFakeMetricValues(result, "traffic GA4 ready + X missing");

    result = resolve(resolver, {
      raw_user_goal_message: "Increase website traffic this week.",
      normalized_goal_kind: "traffic",
      capabilities: {
        app: [ga4("missing")],
        channel: [meta("missing"), xPost("missing")],
      },
    });
    results.push(result);
    assert.equal(result.primary_source, null, "traffic all missing: expected no primary truth source");
    assert.ok(result.baseline_status === "missing" || result.baseline_status === "estimated", "traffic all missing: expected missing or estimated baseline status");
    assertFallbacks(result, "traffic all missing");
    assert.equal(requirementFor(result, "ga4_utm")?.severity, "blocking", "traffic all missing: GA4 should block traffic truth");
    assertNoFakeMetricValues(result, "traffic all missing");

    result = resolve(resolver, {
      raw_user_goal_message: "Improve Facebook engagement this week.",
      normalized_goal_kind: "facebook_engagement",
      existing_channel_metrics_availability: [
        {
          channel: "facebook",
          status: "connected",
          available_metrics: ["facebook_views", "facebook_engagement", "facebook_follower_count"],
          missing_metrics: ["facebook_link_clicks", "facebook_ctr"],
        },
      ],
    });
    results.push(result);
    assert.equal(result.primary_source?.source_type, "meta_page_insights", "Facebook engagement: expected Meta primary");
    assert.equal(result.primary_source?.source_id, "facebook_channel_metrics", "Facebook engagement: expected current Facebook channel metrics abstraction");
    assert.equal(result.baseline_status, "available", "Facebook engagement: expected available baseline status");
    assertNoFakeMetricValues(result, "Facebook engagement");

    result = resolve(resolver, {
      raw_user_goal_message: "Improve X engagement this week.",
      normalized_goal_kind: "x_engagement",
      capabilities: {
        channel: [xPost("missing"), xApi("ready")],
      },
    });
    results.push(result);
    assert.ok(["x_post_insights", "x_api"].includes(result.primary_source?.source_type), "X engagement: expected X primary");
    assert.equal(result.primary_source?.source_type, "x_api", "X engagement: expected ready X API when post insights are missing");
    assert.equal(result.baseline_status, "available", "X engagement: expected available baseline status");
    assertNoFakeMetricValues(result, "X engagement");

    result = resolve(resolver, {
      raw_user_goal_message: "Increase website traffic this week.",
      normalized_goal_kind: "traffic",
      capabilities: {
        app: [ga4("ready")],
        channel: [meta("permission_failed")],
      },
    });
    results.push(result);
    assert.equal(result.primary_source?.source_type, "ga4_utm", "Meta permission failed: expected GA4 traffic primary");
    assert.equal(requirementFor(result, "meta_page_insights")?.severity, "non_blocking", "Meta permission failed: expected non-blocking traffic requirement");
    assert.equal(result.baseline_status, "available", "Meta permission failed: expected available baseline status");
    assertNoFakeMetricValues(result, "Meta permission failed");

    result = resolve(resolver, {
      raw_user_goal_message: "Increase website traffic this week.",
      normalized_goal_kind: "traffic",
      capabilities: {
        app: [ga4("ready")],
        channel: [xApi("permission_failed")],
      },
    });
    results.push(result);
    assert.equal(result.primary_source?.source_type, "ga4_utm", "X API permission failed: expected GA4 traffic primary");
    assert.equal(requirementFor(result, "x_api")?.severity, "non_blocking", "X API permission failed: expected non-blocking traffic requirement");
    assert.equal(result.baseline_status, "available", "X API permission failed: expected available baseline status");
    assertNoFakeMetricValues(result, "X API permission failed");

    assert.doesNotMatch(JSON.stringify(results), /\b(?:access_token|refresh_token|authorization|headers|cookie|rawGa4Response|raw_google_response)\b/i, "source resolution output must not expose connector secrets or raw API payloads");
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
}

assert.ok(fs.existsSync(resolverPath), "src/lib/cmo/lens-metric-source-resolution.ts is missing");
assertIncludes("src/lib/cmo/lens-metric-source-resolution.ts", 'LENS_METRIC_SOURCE_RESOLUTION_CONTRACT = "lens.metric_source_resolution.v1"', "Lens source resolution contract must exist");
assertIncludes("src/lib/cmo/lens-metric-source-resolution.ts", "export interface MetricSourceOptionV1", "MetricSourceOptionV1 must exist");
assertIncludes("src/lib/cmo/lens-metric-source-resolution.ts", '"ga4_utm"', "GA4/UTM source type must exist");
assertIncludes("src/lib/cmo/lens-metric-source-resolution.ts", '"meta_page_insights"', "Meta source type must exist");
assertIncludes("src/lib/cmo/lens-metric-source-resolution.ts", '"x_post_insights"', "X post source type must exist");
assertIncludes("src/lib/cmo/lens-metric-source-resolution.ts", '"x_api"', "X API source type must exist");
assertIncludes("src/lib/cmo/lens-metric-source-resolution.ts", '"manual_input"', "manual_input fallback source type must exist");
assertIncludes("src/lib/cmo/lens-metric-source-resolution.ts", '"estimated"', "estimated fallback source type must exist");
assertIncludes("src/lib/cmo/lens-metric-source-resolution.ts", "existing_channel_metrics_availability", "Resolver must accept existing channel metrics availability");
assertIncludes("src/lib/cmo/lens-metric-source-resolution.ts", '"facebook" ? "meta_page_insights"', "Facebook channel metrics must map to Meta Page Insights abstraction");
assertIncludes("src/lib/cmo/lens-metric-source-resolution.ts", "primary_source", "Resolver output must include primary_source");
assertIncludes("src/lib/cmo/lens-metric-source-resolution.ts", "enrichment_sources", "Resolver output must include enrichment_sources");
assertIncludes("src/lib/cmo/lens-metric-source-resolution.ts", "fallback_sources", "Resolver output must include fallback_sources");
assertIncludes("src/lib/cmo/lens-metric-source-resolution.ts", "missing_requirements", "Resolver output must include missing_requirements");
assertExcludes("src/lib/cmo/lens-metric-source-resolution.ts", /\b(?:fetch|runReport|runRealtimeReport|analyticsdata\.googleapis|graph\.facebook\.com|api\.x\.com)\b/i, "Source resolver must not implement real connector calls");
assertExcludes("src/lib/cmo/lens-metric-source-resolution.ts", /\b(?:current_value|currentMetric|baselineMetric)\b/i, "Source resolver must not fake current or baseline metric values");
assertProductionHardcodeAudit();

await assertResolverBehavior();

console.log(JSON.stringify({
  ok: true,
  contract: "lens.metric_source_resolution.v1",
  cases: 9,
}, null, 2));
