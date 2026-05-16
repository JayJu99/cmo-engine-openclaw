import { readFile } from "node:fs/promises";
import path from "node:path";

const filePath = path.join(process.cwd(), "data", "cmo-dashboard", "app-metrics", "holdstation-mini-app.json");
const requiredMetrics = [
  "activated_users",
  "activation_rate",
  "new_users",
  "d1_retention",
  "d7_retention",
  "pending_reviews",
  "promotions_pending",
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

const snapshot = JSON.parse(await readFile(filePath, "utf8"));

assert(snapshot.schemaVersion === "cmo.app-metrics.v1", "Expected cmo.app-metrics.v1 schema");
assert(snapshot.workspaceId === "holdstation", "Expected holdstation workspace");
assert(snapshot.appId === "holdstation-mini-app", "Expected Holdstation Mini App scope");
assert(snapshot.sourceId === "holdstation__holdstation-mini-app", "Expected app-scoped sourceId");
assert(Array.isArray(snapshot.metrics), "Expected metrics array");

const metricIds = new Set(snapshot.metrics.map((metric) => metric.id));

for (const id of requiredMetrics) {
  assert(metricIds.has(id), `Missing metric ${id}`);
}

for (const metric of snapshot.metrics) {
  assert(metric.value === null || typeof metric.value === "number", `Invalid value for ${metric.id}`);
  assert(typeof metric.displayValue === "string" && metric.displayValue.length > 0, `Missing displayValue for ${metric.id}`);
  assert(["connected", "missing", "partial", "placeholder"].includes(metric.status), `Invalid status for ${metric.id}`);
}

console.log(JSON.stringify({ ok: true, metricCount: snapshot.metrics.length }, null, 2));
