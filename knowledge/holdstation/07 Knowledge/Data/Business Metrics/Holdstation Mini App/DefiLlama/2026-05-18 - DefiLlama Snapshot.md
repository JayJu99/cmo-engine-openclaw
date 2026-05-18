# 2026-05-18 - DefiLlama Business Metrics Snapshot

Generated at: 2026-05-18T09:48:15.326Z
App: Holdstation Wallet Miniapp
Workspace: holdstation
CMO appId: holdstation-mini-app
Source: DefiLlama handoff via n8n
Schema: cmo.business-metrics.v1

## Summary

This snapshot summarizes the latest normalized DefiLlama business metrics received by CMO for Holdstation Mini App.

- Latest source timestamp: No connected timestamp
- DEX Aggregator Volume status: missing
- Fees / Revenue status: missing
- JSON files are the source of truth for machine-readable metrics.

## DEX Aggregator Volume

| Metric | Value | Status |
| --- | ---: | --- |
| 24h | No data | missing |
| 7d | No data | missing |
| 30d | No data | missing |
| Cumulative | No data | missing |

## Fees / Revenue

| Metric | Value | Status |
| --- | ---: | --- |
| 24h | No data | missing |
| 7d | No data | missing |
| 30d | No data | missing |
| Annualized | No data | missing |
| Cumulative | No data | missing |

## Source & Provenance

- Missing JSON snapshot.
- Missing JSON snapshot.

### DEX Provenance

- Not supplied.

### Fees Provenance

- Not supplied.

## Diagnostics / Caveats

- DEX Aggregator Volume: JSON file missing.
- Fees / Revenue: JSON file missing.
- DefiLlama values are latest rolling-window snapshots, not fixed calendar-period accounting close data.
- CMO does not call DefiLlama directly; n8n remains the exporter.
- Missing values remain No data and are not inferred.

## JSON Source of Truth

- data/cmo-dashboard/business-metrics/holdstation-mini-app/defillama/dex_aggregator_volume.json
- data/cmo-dashboard/business-metrics/holdstation-mini-app/defillama/fees_usd.json
