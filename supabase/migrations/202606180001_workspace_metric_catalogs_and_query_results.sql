-- M9B-1: Product-owned GA4 metadata catalog and ad-hoc query cache.
-- These tables store safe normalized metadata and query results only.
-- They must not contain OAuth tokens, raw GA4 payloads, Vault/GBrain data, or final CMO answers.

create table if not exists public.workspace_metric_catalogs (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null,
  workspace_id text not null,
  app_id text not null,
  source_type text not null default 'ga4',
  source_id text not null default 'ga4_native',
  provider text not null default 'google_analytics',
  property_id text not null,
  property_display_name text,
  dimensions_json jsonb not null default '[]'::jsonb,
  metrics_json jsonb not null default '[]'::jsonb,
  custom_dimensions_json jsonb not null default '[]'::jsonb,
  custom_metrics_json jsonb not null default '[]'::jsonb,
  synced_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  constraint workspace_metric_catalogs_source_type_check check (source_type in ('ga4')),
  constraint workspace_metric_catalogs_source_id_check check (source_id in ('ga4_native')),
  constraint workspace_metric_catalogs_unique_property unique (
    tenant_id,
    workspace_id,
    app_id,
    source_type,
    source_id,
    property_id
  )
);

create index if not exists idx_workspace_metric_catalogs_lookup
on public.workspace_metric_catalogs(tenant_id, workspace_id, app_id, source_type, source_id, property_id);

create or replace function public.set_workspace_metric_catalogs_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_workspace_metric_catalogs_updated_at on public.workspace_metric_catalogs;

create trigger set_workspace_metric_catalogs_updated_at
before update on public.workspace_metric_catalogs
for each row
execute function public.set_workspace_metric_catalogs_updated_at();

alter table public.workspace_metric_catalogs enable row level security;

comment on table public.workspace_metric_catalogs is
'Product-owned GA4 metadata catalog cache. Stores normalized metadata only; no OAuth token fields, raw GA4 payloads, Vault/GBrain data, or CMO answer synthesis.';

create table if not exists public.workspace_metric_query_results (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null,
  workspace_id text not null,
  app_id text not null,
  source_type text not null default 'ga4',
  source_id text not null default 'ga4_native',
  provider text not null default 'google_analytics',
  property_id text not null,
  query_hash text not null,
  range_key text not null,
  date_start date not null,
  date_end date not null,
  timezone text,
  metrics_json jsonb not null default '[]'::jsonb,
  dimensions_json jsonb not null default '[]'::jsonb,
  filters_json jsonb not null default '[]'::jsonb,
  order_bys_json jsonb not null default '[]'::jsonb,
  limit_rows integer,
  rows_json jsonb not null default '[]'::jsonb,
  totals_json jsonb not null default '{}'::jsonb,
  row_count integer default 0,
  cache_ttl_minutes integer default 60,
  expires_at timestamptz,
  generated_at timestamptz,
  quality_json jsonb not null default '{}'::jsonb,
  created_at timestamptz default now(),
  constraint workspace_metric_query_results_source_type_check check (source_type in ('ga4')),
  constraint workspace_metric_query_results_source_id_check check (source_id in ('ga4_native')),
  constraint workspace_metric_query_results_unique_query unique (
    tenant_id,
    workspace_id,
    app_id,
    source_type,
    source_id,
    query_hash
  )
);

create index if not exists idx_workspace_metric_query_results_lookup
on public.workspace_metric_query_results(tenant_id, workspace_id, app_id, source_type, source_id, query_hash);

create index if not exists idx_workspace_metric_query_results_expires
on public.workspace_metric_query_results(expires_at);

alter table public.workspace_metric_query_results enable row level security;

comment on table public.workspace_metric_query_results is
'Product-owned GA4 ad-hoc query result cache. Stores normalized rows and safe quality metadata only; no OAuth token fields, raw GA4 payloads, Vault/GBrain data, or CMO answer synthesis.';
