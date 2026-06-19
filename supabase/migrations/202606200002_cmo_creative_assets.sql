-- M13: Creative Agent product bridge asset store.
-- Stores Product-side Creative job and asset metadata only. Local Hermes paths must be redacted.

create table if not exists public.cmo_creative_jobs (
  id text primary key,
  tenant_id text not null,
  workspace_id text not null,
  app_id text not null,
  agent text not null default 'creative',
  status text not null,
  prompt_used text,
  visual_summary text,
  notes text,
  metadata_json jsonb not null default '{}'::jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  constraint cmo_creative_jobs_agent_check check (agent = 'creative'),
  constraint cmo_creative_jobs_status_check check (
    status in (
      'creative.started',
      'creative.generating',
      'creative.asset_ready',
      'creative.partial',
      'creative.blocked',
      'creative.failed',
      'asset_ready',
      'partial',
      'blocked',
      'failed'
    )
  )
);

create index if not exists idx_cmo_creative_jobs_scope
on public.cmo_creative_jobs(tenant_id, workspace_id, app_id, created_at desc);

create or replace function public.set_cmo_creative_jobs_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_cmo_creative_jobs_updated_at on public.cmo_creative_jobs;

create trigger set_cmo_creative_jobs_updated_at
before update on public.cmo_creative_jobs
for each row
execute function public.set_cmo_creative_jobs_updated_at();

alter table public.cmo_creative_jobs enable row level security;

grant select, insert, update, delete on table public.cmo_creative_jobs to service_role;

comment on table public.cmo_creative_jobs is
'Product-side Creative Agent job metadata. Stores prompts, summaries, and safe metadata only; no raw auth paths, tokens, or unredacted Hermes local paths.';

create table if not exists public.cmo_creative_assets (
  id text primary key,
  job_id text references public.cmo_creative_jobs(id) on delete set null,
  tenant_id text not null,
  workspace_id text not null,
  app_id text not null,
  agent text not null default 'creative',
  type text not null,
  provider text,
  prompt_used text,
  visual_summary text,
  storage_path text,
  preview_url text,
  signed_url text,
  source_local_path_redacted text,
  bytes bigint,
  sha256 text,
  width integer,
  height integer,
  model text,
  operation text,
  status text not null,
  metadata_json jsonb not null default '{}'::jsonb,
  created_at timestamptz default now(),
  constraint cmo_creative_assets_agent_check check (agent = 'creative'),
  constraint cmo_creative_assets_type_check check (type in ('image', 'video')),
  constraint cmo_creative_assets_status_check check (
    status in ('stored', 'artifact_transport_missing', 'partial', 'blocked', 'failed')
  ),
  constraint cmo_creative_assets_sha256_check check (sha256 is null or sha256 ~ '^[a-f0-9]{64}$'),
  constraint cmo_creative_assets_local_path_redacted_check check (
    source_local_path_redacted is null or source_local_path_redacted not like '/tmp/%'
  )
);

create index if not exists idx_cmo_creative_assets_scope
on public.cmo_creative_assets(tenant_id, workspace_id, app_id, created_at desc);

create index if not exists idx_cmo_creative_assets_job
on public.cmo_creative_assets(job_id, created_at desc);

alter table public.cmo_creative_assets enable row level security;

grant select, insert, update, delete on table public.cmo_creative_assets to service_role;

comment on table public.cmo_creative_assets is
'Product-side Creative Agent asset metadata. Asset bytes live in Supabase Storage bucket cmo-creative-assets; local Hermes paths are stored only in redacted form.';

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'cmo-creative-assets',
  'cmo-creative-assets',
  false,
  52428800,
  array['image/png', 'image/jpeg', 'image/webp', 'video/mp4', 'video/webm']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;
