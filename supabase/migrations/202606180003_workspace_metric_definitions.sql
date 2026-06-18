-- M10A: Product-owned workspace metric definitions and computed snapshots.
-- These tables store configurable metric definitions and safe computed values only.
-- They must not contain OAuth tokens, raw GA4 payloads, Vault/GBrain data, or final CMO answers.

create table if not exists public.workspace_metric_definitions (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null,
  workspace_id text not null,
  app_id text not null,
  source_type text not null default 'ga4',
  source_id text not null default 'ga4_native',
  provider text not null default 'google_analytics',
  definition_type text not null,
  definition_json jsonb not null default '{}'::jsonb,
  enabled boolean not null default true,
  created_by text null,
  updated_by text null,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  constraint workspace_metric_definitions_source_type_check check (source_type in ('ga4')),
  constraint workspace_metric_definitions_source_id_check check (source_id in ('ga4_native')),
  constraint workspace_metric_definitions_type_check check (definition_type in ('activation', 'retention')),
  constraint workspace_metric_definitions_unique_definition unique (
    tenant_id,
    workspace_id,
    app_id,
    source_type,
    source_id,
    definition_type
  )
);

create index if not exists idx_workspace_metric_definitions_lookup
on public.workspace_metric_definitions(tenant_id, workspace_id, app_id, source_type, source_id, definition_type);

create or replace function public.set_workspace_metric_definitions_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_workspace_metric_definitions_updated_at on public.workspace_metric_definitions;

create trigger set_workspace_metric_definitions_updated_at
before update on public.workspace_metric_definitions
for each row
execute function public.set_workspace_metric_definitions_updated_at();

alter table public.workspace_metric_definitions enable row level security;

grant select, insert, update, delete on table public.workspace_metric_definitions to service_role;

comment on table public.workspace_metric_definitions is
'Product-owned workspace activation/retention definitions. Stores configurable definition JSON only; no OAuth token fields, raw GA4 payloads, Vault/GBrain data, or CMO answer synthesis.';

create table if not exists public.workspace_metric_definition_snapshots (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null,
  workspace_id text not null,
  app_id text not null,
  source_type text not null default 'ga4',
  source_id text not null default 'ga4_native',
  provider text not null default 'google_analytics',
  property_id text not null,
  property_display_name text,
  definition_type text not null,
  range_key text not null,
  date_start date not null,
  date_end date not null,
  timezone text,
  status text not null,
  metrics_json jsonb not null default '{}'::jsonb,
  definition_json jsonb not null default '{}'::jsonb,
  evidence_json jsonb not null default '{}'::jsonb,
  quality_json jsonb not null default '{}'::jsonb,
  generated_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  constraint workspace_metric_definition_snapshots_source_type_check check (source_type in ('ga4')),
  constraint workspace_metric_definition_snapshots_source_id_check check (source_id in ('ga4_native')),
  constraint workspace_metric_definition_snapshots_type_check check (definition_type in ('activation', 'retention')),
  constraint workspace_metric_definition_snapshots_status_check check (
    status in (
      'computed',
      'definition_needed',
      'configured_but_unavailable',
      'not_matured',
      'no_data',
      'no_denominator',
      'failed'
    )
  ),
  constraint workspace_metric_definition_snapshots_unique_snapshot unique (
    tenant_id,
    workspace_id,
    app_id,
    source_type,
    source_id,
    definition_type,
    range_key,
    date_start,
    date_end
  )
);

create index if not exists idx_workspace_metric_definition_snapshots_latest
on public.workspace_metric_definition_snapshots(
  tenant_id,
  workspace_id,
  app_id,
  source_type,
  source_id,
  definition_type,
  range_key,
  generated_at desc
);

create or replace function public.set_workspace_metric_definition_snapshots_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_workspace_metric_definition_snapshots_updated_at on public.workspace_metric_definition_snapshots;

create trigger set_workspace_metric_definition_snapshots_updated_at
before update on public.workspace_metric_definition_snapshots
for each row
execute function public.set_workspace_metric_definition_snapshots_updated_at();

alter table public.workspace_metric_definition_snapshots enable row level security;

grant select, insert, update, delete on table public.workspace_metric_definition_snapshots to service_role;

comment on table public.workspace_metric_definition_snapshots is
'Product-owned activation/retention computed snapshots. Stores safe normalized metric values and quality metadata only; no OAuth token fields, raw GA4 payloads, Vault/GBrain data, or CMO answer synthesis.';
