-- M12A-1: Product-owned native Dune business metric snapshots.
-- Stores normalized machine-readable Dune snapshots only.
-- Must not contain API tokens, raw Dune API responses, Vault/GBrain data, or final CMO answers.

create extension if not exists pgcrypto;

create table if not exists public.workspace_business_metric_snapshots (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null,
  workspace_id text not null,
  app_id text not null,
  source_type text not null default 'dune',
  source_id text not null default 'dune_native',
  provider text not null default 'dune',
  metric_domain text not null default 'business',
  metric_group text not null,
  query_id text,
  query_name text,
  range_preset text,
  date_start date,
  date_end date,
  timezone text,
  status text not null,
  metrics_json jsonb not null default '[]'::jsonb,
  series_json jsonb not null default '[]'::jsonb,
  tables_json jsonb not null default '[]'::jsonb,
  diagnostics_json jsonb not null default '{}'::jsonb,
  provenance_json jsonb not null default '{}'::jsonb,
  synced_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  constraint workspace_business_metric_snapshots_source_type_check check (source_type = 'dune'),
  constraint workspace_business_metric_snapshots_source_id_check check (source_id = 'dune_native'),
  constraint workspace_business_metric_snapshots_provider_check check (provider = 'dune'),
  constraint workspace_business_metric_snapshots_metric_domain_check check (metric_domain = 'business'),
  constraint workspace_business_metric_snapshots_group_check check (
    metric_group in ('wld_aggregator_daily', 'wld_partner_stats_daily')
  ),
  constraint workspace_business_metric_snapshots_status_check check (
    status in ('connected', 'partial', 'missing', 'stale', 'failed')
  ),
  constraint workspace_business_metric_snapshots_unique_group unique (
    tenant_id,
    workspace_id,
    app_id,
    source_type,
    source_id,
    metric_group
  )
);

create index if not exists idx_workspace_business_metric_snapshots_lookup
on public.workspace_business_metric_snapshots(tenant_id, workspace_id, app_id, source_type, source_id, metric_group);

create index if not exists idx_workspace_business_metric_snapshots_latest
on public.workspace_business_metric_snapshots(tenant_id, workspace_id, app_id, synced_at desc);

create or replace function public.set_workspace_business_metric_snapshots_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_workspace_business_metric_snapshots_updated_at
on public.workspace_business_metric_snapshots;

create trigger set_workspace_business_metric_snapshots_updated_at
before update on public.workspace_business_metric_snapshots
for each row
execute function public.set_workspace_business_metric_snapshots_updated_at();

alter table public.workspace_business_metric_snapshots enable row level security;

revoke all on table public.workspace_business_metric_snapshots from anon;
revoke all on table public.workspace_business_metric_snapshots from authenticated;
grant select, insert, update, delete on table public.workspace_business_metric_snapshots to service_role;

comment on table public.workspace_business_metric_snapshots is
'Product-owned native Dune business metric snapshots. Stores normalized metrics, series, tables, diagnostics, and provenance only; no Dune API tokens, raw Dune API responses, Vault/GBrain data, or CMO answer synthesis.';
