import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";
import path from "node:path";

const execFileAsync = promisify(execFile);
const filePath = path.join(process.cwd(), "data", "cmo-dashboard", "channel-metrics", "holdstation-mini-app", "facebook.json");
const requiredMetrics = [
  "facebook_views",
  "facebook_unique_views",
  "facebook_engagement",
  "facebook_post_count",
  "facebook_video_views",
  "facebook_follower_count",
  "facebook_follower_growth",
  "facebook_link_clicks",
  "facebook_ctr",
];

function assert(condition, message, detail) {
  if (!condition) {
    console.error(`FAIL: ${message}`);
    if (detail !== undefined) {
      console.error(detail);
    }
    process.exit(1);
  }
}

function validateSnapshot(snapshot, label) {
  assert(snapshot.schemaVersion === "cmo.channel-metrics.v1", `${label}: expected cmo.channel-metrics.v1 schema`);
  assert(snapshot.workspaceId === "holdstation", `${label}: expected holdstation workspace`);
  assert(snapshot.appId === "holdstation-mini-app", `${label}: expected Holdstation Mini App scope`);
  assert(snapshot.sourceId === "holdstation__holdstation-mini-app", `${label}: expected app-scoped sourceId`);
  assert(snapshot.channel === "facebook", `${label}: expected facebook channel`);
  assert(["lens.facebook_page", "placeholder", "not_connected"].includes(snapshot.source), `${label}: invalid source`);
  assert(["connected", "missing", "partial", "placeholder"].includes(snapshot.status), `${label}: invalid status`);
  assert(Array.isArray(snapshot.metrics), `${label}: expected metrics array`);

  const metricIds = new Set(snapshot.metrics.map((metric) => metric.id));

  for (const id of requiredMetrics) {
    assert(metricIds.has(id), `${label}: missing metric ${id}`);
  }

  for (const metric of snapshot.metrics) {
    assert(requiredMetrics.includes(metric.id), `${label}: unknown metric ${metric.id}`);
    assert(metric.value === null || typeof metric.value === "number", `${label}: invalid value for ${metric.id}`);
    assert(typeof metric.displayValue === "string" && metric.displayValue.length > 0, `${label}: missing displayValue for ${metric.id}`);
    assert(["connected", "missing", "partial", "placeholder"].includes(metric.status), `${label}: invalid status for ${metric.id}`);

    if (metric.value === null) {
      assert(metric.displayValue === "No data", `${label}: missing metric ${metric.id} must display No data`);
      assert(metric.status !== "connected", `${label}: null metric ${metric.id} cannot be connected`);
    }
  }

  assert(Array.isArray(snapshot.diagnostics?.missingMetrics), `${label}: expected diagnostics.missingMetrics`);
  assert(Array.isArray(snapshot.diagnostics?.availableMetrics), `${label}: expected diagnostics.availableMetrics`);
  assert(Array.isArray(snapshot.diagnostics?.notes), `${label}: expected diagnostics.notes`);
}

const fileSnapshot = JSON.parse(await readFile(filePath, "utf8"));
validateSnapshot(fileSnapshot, "file");

const { stdout } = await execFileAsync(process.execPath, ["scripts/cmo-lens-facebook-normalize.mjs", "--dry-run", "--print-snapshot"], {
  cwd: process.cwd(),
  maxBuffer: 5 * 1024 * 1024,
});
const normalizedSnapshot = JSON.parse(stdout);
validateSnapshot(normalizedSnapshot, "normalizer dry-run");

if (normalizedSnapshot.status === "missing") {
  const connectedMetrics = normalizedSnapshot.metrics.filter((metric) => metric.status === "connected" || metric.value !== null);
  assert(connectedMetrics.length === 0, "normalizer dry-run: missing snapshot must not generate fake connected metrics", connectedMetrics);
}

console.log(JSON.stringify({ ok: true, metricCount: fileSnapshot.metrics.length, normalizerStatus: normalizedSnapshot.status }, null, 2));
