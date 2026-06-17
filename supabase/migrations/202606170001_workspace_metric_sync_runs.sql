-- M9A-1: Product-owned hourly metric sync run audit.
-- This table stores machine-readable sync summaries only. It must not contain
-- OAuth tokens, raw GA4 payloads, Vault/GBrain data, or final CMO answers.

create table if not exists public.workspace_metric_sync_runs (
  id uuid primary key default gen_random_uuid(),
  tenant_id text,
  workspace_id text,
  app_id text,
  source_type text,
  source_id text,
  trigger text,
  mode text,
  range_keys jsonb,
  status text,
  started_at timestamptz,
  completed_at timestamptz,
  summary_json jsonb,
  errors_json jsonb,
  created_at timestamptz default now()
);

create index if not exists idx_workspace_metric_sync_runs_workspace
on public.workspace_metric_sync_runs(tenant_id, workspace_id, app_id, created_at desc);

create index if not exists idx_workspace_metric_sync_runs_source
on public.workspace_metric_sync_runs(source_type, source_id, created_at desc);

alter table public.workspace_metric_sync_runs enable row level security;

comment on table public.workspace_metric_sync_runs is
'Product-owned Lens metric sync run audit table. Stores safe summaries only; no OAuth token fields, raw GA4 payloads, Vault/GBrain data, or CMO answer synthesis.';
