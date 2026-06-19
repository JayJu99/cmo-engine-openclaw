-- M12B: Product-owned native Meta/Facebook Page connector.
-- Stores encrypted OAuth tokens and normalized channel snapshots only.
-- Must not contain raw Meta API responses, Vault/GBrain data, Hermes data, or final CMO answers.

create extension if not exists pgcrypto;

create table if not exists public.workspace_social_oauth_accounts (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null,
  provider text not null default 'meta',
  provider_user_id text,
  account_name text,
  encrypted_access_token text not null,
  token_expires_at timestamptz,
  scopes_json jsonb not null default '[]'::jsonb,
  metadata_json jsonb not null default '{}'::jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  constraint workspace_social_oauth_accounts_provider_check check (provider = 'meta')
);

create index if not exists idx_workspace_social_oauth_accounts_tenant_provider
on public.workspace_social_oauth_accounts(tenant_id, provider, updated_at desc);

create unique index if not exists idx_workspace_social_oauth_accounts_provider_user
on public.workspace_social_oauth_accounts(tenant_id, provider, provider_user_id)
where provider_user_id is not null;

create table if not exists public.workspace_channel_sources (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null,
  workspace_id text not null,
  app_id text not null,
  source_type text not null default 'facebook_page',
  source_id text not null default 'facebook_native',
  provider text not null default 'meta',
  page_id text not null,
  page_name text,
  auth_ref uuid references public.workspace_social_oauth_accounts(id) on delete set null,
  enabled boolean not null default true,
  verified_at timestamptz,
  config_json jsonb not null default '{}'::jsonb,
  quality_json jsonb not null default '{}'::jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  constraint workspace_channel_sources_source_type_check check (source_type = 'facebook_page'),
  constraint workspace_channel_sources_source_id_check check (source_id = 'facebook_native'),
  constraint workspace_channel_sources_provider_check check (provider = 'meta'),
  constraint workspace_channel_sources_unique_source unique (
    tenant_id,
    workspace_id,
    app_id,
    source_type,
    source_id
  )
);

create index if not exists idx_workspace_channel_sources_lookup
on public.workspace_channel_sources(tenant_id, workspace_id, app_id, source_type, source_id);

create table if not exists public.workspace_social_metric_snapshots (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null,
  workspace_id text not null,
  app_id text not null,
  source_type text not null default 'facebook_page',
  source_id text not null default 'facebook_native',
  provider text not null default 'meta',
  page_id text not null,
  range_key text,
  date_start date,
  date_end date,
  timezone text,
  status text not null,
  metrics_json jsonb not null default '[]'::jsonb,
  series_json jsonb not null default '[]'::jsonb,
  posts_json jsonb not null default '[]'::jsonb,
  diagnostics_json jsonb not null default '{}'::jsonb,
  provenance_json jsonb not null default '{}'::jsonb,
  synced_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  constraint workspace_social_metric_snapshots_source_type_check check (source_type = 'facebook_page'),
  constraint workspace_social_metric_snapshots_source_id_check check (source_id = 'facebook_native'),
  constraint workspace_social_metric_snapshots_provider_check check (provider = 'meta'),
  constraint workspace_social_metric_snapshots_status_check check (
    status in ('connected', 'partial', 'missing', 'stale', 'failed')
  ),
  constraint workspace_social_metric_snapshots_unique_range unique (
    tenant_id,
    workspace_id,
    app_id,
    source_type,
    source_id,
    range_key
  )
);

create index if not exists idx_workspace_social_metric_snapshots_lookup
on public.workspace_social_metric_snapshots(tenant_id, workspace_id, app_id, source_type, source_id, range_key);

create index if not exists idx_workspace_social_metric_snapshots_latest
on public.workspace_social_metric_snapshots(tenant_id, workspace_id, app_id, synced_at desc);

create or replace function public.set_workspace_social_facebook_native_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_workspace_social_oauth_accounts_updated_at
on public.workspace_social_oauth_accounts;
create trigger set_workspace_social_oauth_accounts_updated_at
before update on public.workspace_social_oauth_accounts
for each row
execute function public.set_workspace_social_facebook_native_updated_at();

drop trigger if exists set_workspace_channel_sources_updated_at
on public.workspace_channel_sources;
create trigger set_workspace_channel_sources_updated_at
before update on public.workspace_channel_sources
for each row
execute function public.set_workspace_social_facebook_native_updated_at();

drop trigger if exists set_workspace_social_metric_snapshots_updated_at
on public.workspace_social_metric_snapshots;
create trigger set_workspace_social_metric_snapshots_updated_at
before update on public.workspace_social_metric_snapshots
for each row
execute function public.set_workspace_social_facebook_native_updated_at();

alter table public.workspace_social_oauth_accounts enable row level security;
alter table public.workspace_channel_sources enable row level security;
alter table public.workspace_social_metric_snapshots enable row level security;

revoke all on table public.workspace_social_oauth_accounts from anon;
revoke all on table public.workspace_social_oauth_accounts from authenticated;
grant select, insert, update, delete on table public.workspace_social_oauth_accounts to service_role;

revoke all on table public.workspace_channel_sources from anon;
revoke all on table public.workspace_channel_sources from authenticated;
grant select, insert, update, delete on table public.workspace_channel_sources to service_role;

revoke all on table public.workspace_social_metric_snapshots from anon;
revoke all on table public.workspace_social_metric_snapshots from authenticated;
grant select, insert, update, delete on table public.workspace_social_metric_snapshots to service_role;

comment on table public.workspace_social_oauth_accounts is
'Product-owned Meta OAuth token references. Access tokens are encrypted by Product backend and must never be exposed through client-safe APIs.';

comment on table public.workspace_channel_sources is
'Product-owned Facebook Page source mapping for workspace channel metrics. Stores config and quality only; no raw Meta responses.';

comment on table public.workspace_social_metric_snapshots is
'Product-owned native Facebook channel metric snapshots. Stores normalized metrics, series, posts, diagnostics, and provenance only; no Meta tokens, raw Meta API responses, Vault/GBrain data, Hermes data, or CMO answer synthesis.';
