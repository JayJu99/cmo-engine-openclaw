-- Studio Product foundation.
-- Product owns job persistence, upload sessions, asset metadata, and mock runner state.

create table if not exists public.studio_generation_jobs (
  id text primary key,
  tenant_id text not null,
  created_by text,
  status text not null,
  media_kind text not null,
  agent text not null,
  backend text not null,
  operation text not null,
  context_json jsonb not null default '{}'::jsonb,
  prompt text not null,
  negative_prompt text,
  model_json jsonb not null default '{}'::jsonb,
  settings_json jsonb not null default '{}'::jsonb,
  input_asset_ids text[] not null default array[]::text[],
  output_asset_ids text[] not null default array[]::text[],
  cost_json jsonb not null default '{}'::jsonb,
  provider_job_id text,
  provider_status text,
  error_json jsonb,
  diagnostics_json jsonb not null default '{}'::jsonb,
  request_id text,
  dispatch_attempts integer not null default 0,
  dispatch_started_at timestamptz,
  locked_until timestamptz,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint studio_generation_jobs_status_check check (
    status in ('draft', 'queued', 'running', 'completed', 'failed', 'cancelled')
  ),
  constraint studio_generation_jobs_media_kind_check check (media_kind in ('video', 'image')),
  constraint studio_generation_jobs_agent_check check (agent in ('video', 'image')),
  constraint studio_generation_jobs_backend_check check (backend in ('higgsfield', 'codex-imagen')),
  constraint studio_generation_jobs_prompt_check check (length(trim(prompt)) > 0),
  constraint studio_generation_jobs_operation_check check (
    operation in ('generate_video', 'generate_image', 'edit_video', 'motion_control')
  )
);

create index if not exists idx_studio_generation_jobs_scope
on public.studio_generation_jobs(tenant_id, created_at desc);

create index if not exists idx_studio_generation_jobs_status
on public.studio_generation_jobs(status, created_at desc);

create unique index if not exists idx_studio_generation_jobs_request_id
on public.studio_generation_jobs(tenant_id, request_id)
where request_id is not null;

create or replace function public.set_studio_generation_jobs_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_studio_generation_jobs_updated_at on public.studio_generation_jobs;

create trigger set_studio_generation_jobs_updated_at
before update on public.studio_generation_jobs
for each row
execute function public.set_studio_generation_jobs_updated_at();

alter table public.studio_generation_jobs enable row level security;

grant select, insert, update, delete on table public.studio_generation_jobs to service_role;

comment on table public.studio_generation_jobs is
'Product-side Studio generation jobs. Browser calls Product APIs only; Hermes/provider state is stored as safe metadata and never as local paths or secrets.';

create table if not exists public.studio_asset_upload_sessions (
  id text primary key,
  job_id text not null references public.studio_generation_jobs(id) on delete cascade,
  media_kind text not null,
  purpose text not null,
  status text not null,
  upload_target text not null,
  storage_key text not null,
  expected_mime_type text,
  allowed_mime_types text[] not null default array[]::text[],
  max_bytes bigint not null,
  expires_at timestamptz not null,
  uploaded_mime_type text,
  uploaded_bytes bigint,
  uploaded_sha256 text,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  error_json jsonb,
  constraint studio_asset_upload_sessions_media_kind_check check (media_kind in ('video', 'image')),
  constraint studio_asset_upload_sessions_purpose_check check (purpose in ('studio_input', 'studio_output')),
  constraint studio_asset_upload_sessions_status_check check (
    status in ('pending', 'uploaded', 'completed', 'expired', 'failed')
  ),
  constraint studio_asset_upload_sessions_expected_mime_check check (
    expected_mime_type is null
    or expected_mime_type in ('video/mp4', 'video/webm', 'image/png', 'image/jpeg', 'image/webp')
  ),
  constraint studio_asset_upload_sessions_uploaded_mime_check check (
    uploaded_mime_type is null
    or uploaded_mime_type in ('video/mp4', 'video/webm', 'image/png', 'image/jpeg', 'image/webp')
  ),
  constraint studio_asset_upload_sessions_sha256_check check (
    uploaded_sha256 is null or uploaded_sha256 ~ '^[a-f0-9]{64}$'
  ),
  constraint studio_asset_upload_sessions_size_check check (max_bytes > 0)
);

create index if not exists idx_studio_asset_upload_sessions_job
on public.studio_asset_upload_sessions(job_id, created_at desc);

create index if not exists idx_studio_asset_upload_sessions_status
on public.studio_asset_upload_sessions(status, expires_at);

alter table public.studio_asset_upload_sessions enable row level security;

grant select, insert, update, delete on table public.studio_asset_upload_sessions to service_role;

comment on table public.studio_asset_upload_sessions is
'Job-scoped Product-minted Studio upload sessions. Browser and future Hermes agents upload only to these Product targets.';

create table if not exists public.studio_assets (
  id text primary key,
  job_id text not null references public.studio_generation_jobs(id) on delete cascade,
  media_kind text not null,
  purpose text not null,
  storage_key text not null,
  render_url text,
  preview_url text,
  thumbnail_url text,
  mime_type text not null,
  bytes bigint not null,
  sha256 text not null,
  width integer,
  height integer,
  duration_seconds numeric,
  metadata_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint studio_assets_media_kind_check check (media_kind in ('video', 'image')),
  constraint studio_assets_purpose_check check (purpose in ('studio_input', 'studio_output')),
  constraint studio_assets_mime_type_check check (
    mime_type in ('video/mp4', 'video/webm', 'image/png', 'image/jpeg', 'image/webp')
  ),
  constraint studio_assets_sha256_check check (sha256 ~ '^[a-f0-9]{64}$'),
  constraint studio_assets_bytes_check check (bytes > 0),
  constraint studio_assets_storage_key_no_local_path_check check (
    storage_key not like '/%' and storage_key not like 'file:%'
  )
);

create index if not exists idx_studio_assets_job
on public.studio_assets(job_id, created_at desc);

alter table public.studio_assets enable row level security;

grant select, insert, update, delete on table public.studio_assets to service_role;

comment on table public.studio_assets is
'Product-side Studio asset metadata. storage_key is the durable source of truth; temporary signed URLs are not required for durable identity.';

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'cmo-studio-assets',
  'cmo-studio-assets',
  false,
  419430400,
  array['video/mp4', 'video/webm', 'image/png', 'image/jpeg', 'image/webp']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;
