-- M9C-1: Product-owned daily GA4 deep sync report packs.
-- This table stores normalized machine-readable report packs only. It must not
-- contain OAuth tokens, raw GA4 payloads, Vault/GBrain data, or final CMO answers.

create table if not exists public.workspace_metric_report_packs (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null,
  workspace_id text not null,
  app_id text not null,
  source_type text not null default 'ga4',
  source_id text not null default 'ga4_native',
  provider text not null default 'google_analytics',
  property_id text not null,
  property_display_name text,
  pack_key text not null,
  range_key text not null,
  date_start date not null,
  date_end date not null,
  timezone text,
  query_hash text,
  query_result_id uuid null,
  metrics_json jsonb not null default '[]'::jsonb,
  dimensions_json jsonb not null default '[]'::jsonb,
  rows_json jsonb not null default '[]'::jsonb,
  totals_json jsonb not null default '{}'::jsonb,
  row_count integer default 0,
  payload_json jsonb not null default '{}'::jsonb,
  quality_json jsonb not null default '{}'::jsonb,
  generated_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  constraint workspace_metric_report_packs_source_type_check check (source_type in ('ga4')),
  constraint workspace_metric_report_packs_source_id_check check (source_id in ('ga4_native')),
  constraint workspace_metric_report_packs_unique_pack unique (
    tenant_id,
    workspace_id,
    app_id,
    source_type,
    source_id,
    property_id,
    pack_key,
    range_key,
    date_start,
    date_end
  )
);

create index if not exists idx_workspace_metric_report_packs_latest
on public.workspace_metric_report_packs(tenant_id, workspace_id, app_id, source_type, source_id, range_key, generated_at desc);

create index if not exists idx_workspace_metric_report_packs_pack
on public.workspace_metric_report_packs(tenant_id, workspace_id, app_id, pack_key, range_key, date_start desc);

create or replace function public.set_workspace_metric_report_packs_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_workspace_metric_report_packs_updated_at on public.workspace_metric_report_packs;

create trigger set_workspace_metric_report_packs_updated_at
before update on public.workspace_metric_report_packs
for each row
execute function public.set_workspace_metric_report_packs_updated_at();

alter table public.workspace_metric_report_packs enable row level security;

grant select, insert, update, delete on table public.workspace_metric_report_packs to service_role;

comment on table public.workspace_metric_report_packs is
'Product-owned GA4 daily deep sync report packs. Stores normalized rows and safe quality metadata only; no OAuth token fields, raw GA4 payloads, Vault/GBrain data, or CMO answer synthesis.';
