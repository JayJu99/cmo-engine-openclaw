-- Studio Image-to-Video input assets.
-- Allows Product-owned studio_input assets to be uploaded before a generation job exists.

alter table public.studio_asset_upload_sessions
  add column if not exists tenant_id text,
  add column if not exists created_by text;

update public.studio_asset_upload_sessions s
set
  tenant_id = j.tenant_id,
  created_by = j.created_by
from public.studio_generation_jobs j
where s.job_id = j.id
  and s.tenant_id is null;

alter table public.studio_asset_upload_sessions
  alter column tenant_id set not null,
  alter column job_id drop not null;

alter table public.studio_asset_upload_sessions
  drop constraint if exists studio_asset_upload_sessions_job_or_input_check,
  add constraint studio_asset_upload_sessions_job_or_input_check check (
    job_id is not null or purpose = 'studio_input'
  );

create index if not exists idx_studio_asset_upload_sessions_scope
on public.studio_asset_upload_sessions(tenant_id, created_at desc);

alter table public.studio_assets
  add column if not exists tenant_id text,
  add column if not exists created_by text;

update public.studio_assets a
set
  tenant_id = j.tenant_id,
  created_by = j.created_by
from public.studio_generation_jobs j
where a.job_id = j.id
  and a.tenant_id is null;

alter table public.studio_assets
  alter column tenant_id set not null,
  alter column job_id drop not null;

alter table public.studio_assets
  drop constraint if exists studio_assets_job_or_input_check,
  add constraint studio_assets_job_or_input_check check (
    job_id is not null or purpose = 'studio_input'
  );

create index if not exists idx_studio_assets_scope
on public.studio_assets(tenant_id, created_at desc);

comment on column public.studio_assets.tenant_id is
'Tenant/user scope for pre-job Studio input assets and job-linked Studio outputs.';

comment on column public.studio_asset_upload_sessions.tenant_id is
'Tenant/user scope for pre-job Studio input upload sessions and job-linked Studio upload sessions.';
