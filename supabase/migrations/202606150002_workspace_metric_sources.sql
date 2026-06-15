-- M6.2: Product-owned workspace metric source mapping.
-- This table stores operational source registry config only. It is not Vault content.

create extension if not exists pgcrypto;

create table if not exists public.workspace_metric_sources (
  tenant_id text not null,
  workspace_id text not null,
  source_id text not null,
  app_id text not null,
  source_type text not null,
  auth_ref text,
  config_json jsonb not null default '{}'::jsonb,
  refresh_policy jsonb not null default '{}'::jsonb,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, workspace_id, source_id),
  constraint workspace_metric_sources_unique_source unique (tenant_id, workspace_id, source_type, source_id)
);

create index if not exists idx_workspace_metric_sources_app
on public.workspace_metric_sources(tenant_id, workspace_id, app_id);

create index if not exists idx_workspace_metric_sources_type
on public.workspace_metric_sources(tenant_id, workspace_id, source_type, source_id);

create or replace function public.set_workspace_metric_sources_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_workspace_metric_sources_updated_at on public.workspace_metric_sources;

create trigger set_workspace_metric_sources_updated_at
before update on public.workspace_metric_sources
for each row
execute function public.set_workspace_metric_sources_updated_at();

alter table public.workspace_metric_sources enable row level security;

comment on table public.workspace_metric_sources is
  'Product-side generic workspace metric source registry. Client-safe APIs must never expose OAuth token material.';
