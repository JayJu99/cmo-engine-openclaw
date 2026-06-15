-- M6.4A: Product-owned workspace metric snapshot cache.
-- This table stores operational metric snapshots only. It is not Vault content.
-- Client-safe APIs must never store or expose OAuth token material here.

create extension if not exists pgcrypto;

create table if not exists public.workspace_metric_snapshots (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null,
  workspace_id text not null,
  app_id text not null,
  source_type text not null,
  source_id text not null,
  range_key text not null,
  date_start date not null,
  date_end date not null,
  timezone text,
  metrics_json jsonb not null default '{}'::jsonb,
  source_meta_json jsonb not null default '{}'::jsonb,
  status text not null default 'synced',
  last_error text,
  synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint workspace_metric_snapshots_source_type_check check (source_type in ('ga4')),
  constraint workspace_metric_snapshots_source_id_check check (source_id in ('ga4_native')),
  constraint workspace_metric_snapshots_status_check check (status in ('synced', 'error')),
  constraint workspace_metric_snapshots_unique_range unique (
    tenant_id,
    workspace_id,
    app_id,
    source_type,
    source_id,
    range_key,
    date_start,
    date_end
  )
);

create index if not exists idx_workspace_metric_snapshots_latest
on public.workspace_metric_snapshots(tenant_id, workspace_id, app_id, source_type, source_id, range_key, synced_at desc);

create index if not exists idx_workspace_metric_snapshots_date
on public.workspace_metric_snapshots(tenant_id, workspace_id, app_id, range_key, date_start, date_end);

create or replace function public.set_workspace_metric_snapshots_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_workspace_metric_snapshots_updated_at on public.workspace_metric_snapshots;

create trigger set_workspace_metric_snapshots_updated_at
before update on public.workspace_metric_snapshots
for each row
execute function public.set_workspace_metric_snapshots_updated_at();

alter table public.workspace_metric_snapshots enable row level security;

comment on table public.workspace_metric_snapshots is
  'Product-side operational metric snapshot cache. Not Vault content and never stores OAuth token material or raw Google API responses by default.';
