import { readFile } from "node:fs/promises";
import path from "node:path";

const appId = "holdstation-mini-app";
const duneDir = path.join(process.cwd(), "data", "cmo-dashboard", "business-metrics", appId, "dune");
const aggregatorPath = path.join(duneDir, "wld_aggregator_daily.json");
const partnerPath = path.join(duneDir, "wld_partner_stats_daily.json");

function assert(condition, message, detail) {
  if (!condition) {
    console.error(`FAIL: ${message}`);
    if (detail !== undefined) {
      console.error(detail);
    }
    process.exit(1);
  }
}

async function readJsonOptional(filePath) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch {
    return null;
  }
}

function numberField(record, key) {
  const value = record?.[key];

  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);

    return Number.isFinite(parsed) ? parsed : 0;
  }

  return 0;
}

function stringField(record, key) {
  const value = record?.[key];

  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function seriesPoints(snapshot, id) {
  return snapshot?.series?.find((series) => series.id === id)?.points ?? [];
}

function tableRows(snapshot, id) {
  return snapshot?.tables?.find((table) => table.id === id)?.rows ?? [];
}

function aggregatorPoints(snapshot) {
  return seriesPoints(snapshot, "wld_aggregator_daily_series")
    .map((record) => ({
      date: stringField(record, "evt_block_date"),
      countTx: numberField(record, "count_tx"),
      cumulativeTxCount: numberField(record, "cumulative_tx_count"),
      dailyVolume: numberField(record, "daily_volume"),
      cumulativeVolume: numberField(record, "cumulative_volume"),
      feeAmount: numberField(record, "fee_amount"),
    }))
    .filter((point) => point.date)
    .sort((left, right) => left.date.localeCompare(right.date));
}

function partnerPoints(snapshot) {
  return seriesPoints(snapshot, "wld_partner_daily_series")
    .map((record) => ({
      date: stringField(record, "evt_block_date"),
      partnerCode: stringField(record, "partnerCode") || "Unknown",
      volume: numberField(record, "volume"),
      countTx: numberField(record, "count_tx"),
    }))
    .filter((point) => point.date)
    .sort((left, right) => left.date.localeCompare(right.date) || left.partnerCode.localeCompare(right.partnerCode));
}

function partnerSummaryRows(snapshot) {
  return tableRows(snapshot, "wld_partner_summary")
    .map((record) => ({
      partnerCode: stringField(record, "partnerCode") || "Unknown",
      totalVolume: numberField(record, "total_volume"),
      totalTransactions: numberField(record, "total_transactions"),
    }))
    .filter((row) => row.totalVolume > 0 || row.totalTransactions > 0);
}

function topNPlusOther(rows, valueFor, limit = 8) {
  const sorted = [...rows].sort((left, right) => valueFor(right) - valueFor(left));
  const top = sorted.slice(0, limit);
  const rest = sorted.slice(limit);

  if (!rest.length) {
    return top;
  }

  return [
    ...top,
    rest.reduce(
      (acc, row) => ({
        partnerCode: "Other",
        totalVolume: acc.totalVolume + row.totalVolume,
        totalTransactions: acc.totalTransactions + row.totalTransactions,
      }),
      { partnerCode: "Other", totalVolume: 0, totalTransactions: 0 },
    ),
  ];
}

function partnerCodesByTotal(points, field, limit = 8) {
  const totals = new Map();

  points.forEach((point) => {
    totals.set(point.partnerCode, (totals.get(point.partnerCode) ?? 0) + point[field]);
  });

  const sorted = [...totals.entries()]
    .filter(([, value]) => value > 0)
    .sort((left, right) => right[1] - left[1])
    .map(([partner]) => partner);

  return sorted.length > limit ? [...sorted.slice(0, limit), "Other"] : sorted;
}

function fixtureSnapshots() {
  const timestamp = new Date().toISOString();

  return {
    aggregator: {
      schemaVersion: "cmo.business-metrics.v1",
      appId,
      source: { type: "dune", sourceId: "dune", fetchedAt: timestamp },
      metricGroup: "wld_aggregator_daily",
      metrics: [],
      series: [
        {
          id: "wld_aggregator_daily_series",
          points: [
            { evt_block_date: "2026-05-16", count_tx: 200, cumulative_tx_count: 11000, daily_volume: 1500, cumulative_volume: 14177980, fee_amount: 8 },
            { evt_block_date: "2026-05-17", count_tx: 321, cumulative_tx_count: 11321, daily_volume: 2020, cumulative_volume: 14180000, fee_amount: 12 },
          ],
        },
      ],
    },
    partner: {
      schemaVersion: "cmo.business-metrics.v1",
      appId,
      source: { type: "dune", sourceId: "dune", fetchedAt: timestamp },
      metricGroup: "wld_partner_stats_daily",
      metrics: [],
      series: [
        {
          id: "wld_partner_daily_series",
          points: [
            { evt_block_date: "2026-05-16", partnerCode: "HOLD", volume: 51000, count_tx: 900 },
            { evt_block_date: "2026-05-16", partnerCode: "MINI", volume: 14000, count_tx: 300 },
            { evt_block_date: "2026-05-17", partnerCode: "HOLD", volume: 61000, count_tx: 1300 },
            { evt_block_date: "2026-05-17", partnerCode: "MINI", volume: 37000, count_tx: 1100 },
          ],
        },
      ],
      tables: [
        {
          id: "wld_partner_summary",
          rows: [
            { partnerCode: "HOLD", total_volume: 112000, total_transactions: 2200, volume_share_pct: 68.71, tx_share_pct: 61.11, active_days: 2 },
            { partnerCode: "MINI", total_volume: 51000, total_transactions: 1400, volume_share_pct: 31.29, tx_share_pct: 38.89, active_days: 2 },
          ],
        },
      ],
    },
  };
}

const existingAggregator = await readJsonOptional(aggregatorPath);
const existingPartner = await readJsonOptional(partnerPath);
const usedFixture = !existingAggregator || !existingPartner;
const fixtures = fixtureSnapshots();
const aggregator = existingAggregator ?? fixtures.aggregator;
const partner = existingPartner ?? fixtures.partner;
const aggregatorChartPoints = aggregatorPoints(aggregator);
const partnerChartPoints = partnerPoints(partner);
const partnerTableRows = partnerSummaryRows(partner);
const nativeAggregatorChartPoints = aggregatorPoints({
  ...aggregator,
  source: { ...aggregator.source, sourceId: "dune_native", queryId: "5057875" },
});
const nativePartnerChartPoints = partnerPoints({
  ...partner,
  source: { ...partner.source, sourceId: "dune_native", queryId: "5454333" },
});
const nativePartnerTableRows = partnerSummaryRows({
  ...partner,
  source: { ...partner.source, sourceId: "dune_native", queryId: "5454333" },
});
const partnerVolumeTop = topNPlusOther(partnerTableRows, (row) => row.totalVolume, 8);
const partnerTxTop = topNPlusOther(partnerTableRows, (row) => row.totalTransactions, 8);
const dailyVolumePartners = partnerCodesByTotal(partnerChartPoints, "volume", 8);
const dailyTxPartners = partnerCodesByTotal(partnerChartPoints, "countTx", 8);
const missingAggregatorPoints = aggregatorPoints(null);
const missingPartnerRows = partnerSummaryRows(null);

assert(aggregator.schemaVersion === "cmo.business-metrics.v1", "Expected aggregator business metrics schema", aggregator);
assert(partner.schemaVersion === "cmo.business-metrics.v1", "Expected partner business metrics schema", partner);
assert(aggregator.source?.type === "dune", "Expected Dune aggregator source", aggregator.source);
assert(partner.source?.type === "dune", "Expected Dune partner source", partner.source);
assert(aggregatorChartPoints.length > 0, "Expected aggregator daily series points", aggregator.series);
assert(partnerChartPoints.length > 0, "Expected partner daily series points", partner.series);
assert(partnerTableRows.length > 0, "Expected partner summary table rows", partner.tables);
assert(nativeAggregatorChartPoints.length === aggregatorChartPoints.length, "Expected native aggregator chart adapter parity", nativeAggregatorChartPoints);
assert(nativePartnerChartPoints.length === partnerChartPoints.length, "Expected native partner chart adapter parity", nativePartnerChartPoints);
assert(nativePartnerTableRows.length === partnerTableRows.length, "Expected native partner summary adapter parity", nativePartnerTableRows);
assert(partnerVolumeTop.length > 0, "Expected topNPlusOther volume data", partnerVolumeTop);
assert(partnerTxTop.length > 0, "Expected topNPlusOther transaction data", partnerTxTop);
assert(dailyVolumePartners.length > 0, "Expected daily volume partner keys", dailyVolumePartners);
assert(dailyTxPartners.length > 0, "Expected daily transaction partner keys", dailyTxPartners);
assert(Array.isArray(missingAggregatorPoints) && missingAggregatorPoints.length === 0, "Expected missing aggregator state not to crash", missingAggregatorPoints);
assert(Array.isArray(missingPartnerRows) && missingPartnerRows.length === 0, "Expected missing partner state not to crash", missingPartnerRows);

console.log(
  JSON.stringify(
    {
      ok: true,
      usedFixture,
      aggregatorPoints: aggregatorChartPoints.length,
      partnerPoints: partnerChartPoints.length,
      partnerSummaryRows: partnerTableRows.length,
      nativeAggregatorPoints: nativeAggregatorChartPoints.length,
      nativePartnerPoints: nativePartnerChartPoints.length,
      nativePartnerSummaryRows: nativePartnerTableRows.length,
      volumePartners: dailyVolumePartners.length,
      transactionPartners: dailyTxPartners.length,
    },
    null,
    2,
  ),
);
