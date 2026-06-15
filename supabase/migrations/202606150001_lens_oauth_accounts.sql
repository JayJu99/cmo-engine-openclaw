-- M6.1: Product-owned Lens Google OAuth account storage.
-- Refresh tokens are encrypted by the Product backend before insertion.

create extension if not exists pgcrypto;

create table if not exists public.lens_oauth_accounts (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null,
  workspace_id text null,
  app_id text null,
  provider text not null default 'google' check (provider in ('google')),
  google_email text,
  google_subject text null,
  scopes text[] not null default '{}',
  encrypted_refresh_token text not null,
  status text not null default 'connected' check (status in ('connected', 'revoked', 'error')),
  created_by_user_id text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_refresh_at timestamptz null,
  access_token_expires_at timestamptz null,
  last_error text null
);

create unique index if not exists idx_lens_oauth_accounts_google_email_tenant
on public.lens_oauth_accounts(tenant_id, provider, lower(google_email))
where google_email is not null;

create index if not exists idx_lens_oauth_accounts_tenant_provider_updated
on public.lens_oauth_accounts(tenant_id, provider, updated_at desc);

create or replace function public.set_lens_oauth_accounts_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_lens_oauth_accounts_updated_at on public.lens_oauth_accounts;

create trigger set_lens_oauth_accounts_updated_at
before update on public.lens_oauth_accounts
for each row
execute function public.set_lens_oauth_accounts_updated_at();

alter table public.lens_oauth_accounts enable row level security;

comment on table public.lens_oauth_accounts is
  'Product-side Lens OAuth account metadata and encrypted Google refresh tokens. Client-safe APIs must never expose encrypted_refresh_token.';
