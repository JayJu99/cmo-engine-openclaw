import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const baseUrl = (process.env.CMO_SMOKE_BASE_URL || "http://127.0.0.1:3002").replace(/\/+$/, "");
const endpoint = `${baseUrl}/api/cmo/apps/holdstation-mini-app/metrics/ingest`;
const metricsPath = path.join(process.cwd(), "data", "cmo-dashboard", "app-metrics", "holdstation-mini-app.json");
const ingestKey = process.env.CMO_METRICS_INGEST_API_KEY || "local-metrics-ingest-smoke";

function assert(condition, message, detail) {
  if (!condition) {
    console.error(`FAIL: ${message}`);
    if (detail !== undefined) {
      console.error(detail);
    }
    process.exit(1);
  }
}

async function post(payload, headers = {}) {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
    body: JSON.stringify(payload),
  });
  const text = await response.text();
  const data = text
    ? (() => {
        try {
          return JSON.parse(text);
        } catch {
          return null;
        }
      })()
    : null;

  return { response, data, text };
}

const originalContent = await readFile(metricsPath, "utf8");
const timestamp = new Date().toISOString();
const payload = {
  schemaVersion: "cmo.app-metrics.v1",
  workspaceId: "holdstation",
  appId: "holdstation-mini-app",
  sourceId: "holdstation__holdstation-mini-app",
  dateRange: {
    preset: "custom",
    startDate: "2026-01-01",
    endDate: "2026-01-07",
    timezone: "Asia/Ho_Chi_Minh",
  },
  compareToPrevious: false,
  status: "partial",
  lastUpdatedAt: timestamp,
  metrics: [
    {
      id: "activated_users",
      label: "Activated Users",
      value: 123,
      displayValue: "123",
      unit: "users",
      status: "connected",
      trend: "unknown",
    },
    {
      id: "activation_rate",
      label: "Activation Rate",
      value: 12.3,
      displayValue: "12.3%",
      unit: "percent",
      status: "connected",
      trend: "unknown",
    },
  ],
  diagnostics: {
    source: "json",
    missingMetrics: [],
    notes: ["Imported from metrics ingest smoke."],
  },
};

try {
  const unauthenticated = await post(payload);

  if (unauthenticated.response.status === 401 || unauthenticated.response.status === 503) {
    assert(unauthenticated.data?.code === "metrics_ingest_unauthorized" || unauthenticated.data?.code === "metrics_ingest_key_not_configured", "Expected clear missing/invalid key response", unauthenticated.data);
  }

  const result = await post(payload, { "x-cmo-metrics-ingest-key": ingestKey });

  assert(result.response.ok, "Expected successful metrics ingest", {
    status: result.response.status,
    body: result.data ?? result.text,
  });

  const snapshot = result.data?.data;

  assert(snapshot?.schemaVersion === "cmo.app-metrics.v1", "Expected metrics schemaVersion", snapshot);
  assert(snapshot.appId === "holdstation-mini-app", "Expected Holdstation Mini App scope", snapshot);
  assert(snapshot.workspaceId === "holdstation", "Expected holdstation workspace", snapshot);
  assert(snapshot.sourceId === "holdstation__holdstation-mini-app", "Expected app sourceId", snapshot);

  const metrics = new Map(snapshot.metrics.map((metric) => [metric.id, metric]));

  assert(metrics.get("activated_users")?.status === "connected", "Expected supplied activated_users to be connected", snapshot.metrics);
  assert(metrics.get("activated_users")?.value === 123, "Expected supplied activated_users value", snapshot.metrics);
  assert(metrics.get("activation_rate")?.status === "connected", "Expected supplied activation_rate to be connected", snapshot.metrics);
  assert(metrics.get("new_users")?.value === null, "Expected missing new_users to remain null", snapshot.metrics);
  assert(metrics.get("d7_retention")?.displayValue === "No data", "Expected missing d7_retention to remain No data", snapshot.metrics);
  assert(metrics.get("new_users")?.status === "missing", "Expected missing metrics to remain missing", snapshot.metrics);
  assert(!snapshot.metrics.some((metric) => metric.id === "fake_metric"), "Expected no fake metric ids", snapshot.metrics);

  const invalidScope = await post(
    {
      ...payload,
      sourceId: "holdstation__wrong-app",
    },
    { "x-cmo-metrics-ingest-key": ingestKey },
  );

  assert(invalidScope.response.status === 403, "Expected invalid sourceId to be rejected", {
    status: invalidScope.response.status,
    body: invalidScope.data ?? invalidScope.text,
  });

  console.log(JSON.stringify({ ok: true, ingestedMetrics: snapshot.metrics.length, restored: true }, null, 2));
} finally {
  await writeFile(metricsPath, originalContent, "utf8");
}
