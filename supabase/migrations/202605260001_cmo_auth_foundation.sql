-- Phase U2: CMO Engine auth and workspace permission foundation.
-- Apply through Supabase migrations/SQL editor after reviewing in production.

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  display_name text,
  status text not null default 'active' check (status in ('active', 'invited', 'disabled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  owner_user_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.workspaces (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  workspace_key text not null,
  name text not null,
  workspace_group text,
  project text,
  default_visibility text not null default 'workspace' check (default_visibility in ('private', 'workspace', 'organization', 'system')),
  created_at timestamptz not null default now(),
  unique (organization_id, workspace_key)
);

create table if not exists public.workspace_memberships (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role text not null check (role in ('owner', 'admin', 'member', 'viewer', 'agent_system')),
  status text not null default 'active' check (status in ('active', 'invited', 'disabled')),
  created_at timestamptz not null default now(),
  unique (workspace_id, user_id)
);

create table if not exists public.chat_sessions_index (
  id text primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  app_id text not null,
  source_id text,
  user_id uuid references public.profiles(id) on delete set null,
  status text,
  runtime_mode text,
  json_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.chat_messages_index (
  id text primary key,
  session_id text not null references public.chat_sessions_index(id) on delete cascade,
  user_id uuid references public.profiles(id) on delete set null,
  role text not null check (role in ('user', 'assistant', 'system', 'agent_system')),
  created_at timestamptz not null default now()
);

create table if not exists public.vault_captures_index (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  app_id text,
  user_id uuid references public.profiles(id) on delete set null,
  visibility text not null default 'workspace' check (visibility in ('private', 'workspace', 'organization', 'system')),
  vault_path text not null,
  source_agent text,
  mode text,
  skill text,
  source_class text,
  capture_origin text,
  review_status text,
  gbrain_status text,
  created_at timestamptz not null default now()
);

create table if not exists public.gbrain_candidates_index (
  id uuid primary key default gen_random_uuid(),
  capture_id uuid references public.vault_captures_index(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  app_id text,
  user_id uuid references public.profiles(id) on delete set null,
  visibility text not null default 'workspace' check (visibility in ('private', 'workspace', 'organization', 'system')),
  candidate_type text,
  review_status text,
  source_path text,
  candidate_hash text,
  created_at timestamptz not null default now()
);

create table if not exists public.audit_events (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid references public.profiles(id) on delete set null,
  organization_id uuid references public.organizations(id) on delete cascade,
  workspace_id uuid references public.workspaces(id) on delete cascade,
  event_type text not null,
  resource_type text,
  resource_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_workspaces_organization_id on public.workspaces(organization_id);
create index if not exists idx_workspace_memberships_user_id on public.workspace_memberships(user_id);
create index if not exists idx_chat_sessions_workspace_user on public.chat_sessions_index(workspace_id, user_id);
create index if not exists idx_chat_messages_session_id on public.chat_messages_index(session_id);
create index if not exists idx_vault_captures_workspace_user on public.vault_captures_index(workspace_id, user_id);
create index if not exists idx_gbrain_candidates_workspace_user on public.gbrain_candidates_index(workspace_id, user_id);
create index if not exists idx_audit_events_workspace_created on public.audit_events(workspace_id, created_at desc);

alter table public.profiles enable row level security;
alter table public.organizations enable row level security;
alter table public.workspaces enable row level security;
alter table public.workspace_memberships enable row level security;
alter table public.chat_sessions_index enable row level security;
alter table public.chat_messages_index enable row level security;
alter table public.vault_captures_index enable row level security;
alter table public.gbrain_candidates_index enable row level security;
alter table public.audit_events enable row level security;

create or replace function public.is_workspace_member(target_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.workspace_memberships wm
    where wm.workspace_id = target_workspace_id
      and wm.user_id = auth.uid()
      and wm.status = 'active'
  );
$$;

create or replace function public.has_workspace_role(target_workspace_id uuid, allowed_roles text[])
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.workspace_memberships wm
    where wm.workspace_id = target_workspace_id
      and wm.user_id = auth.uid()
      and wm.status = 'active'
      and wm.role = any(allowed_roles)
  );
$$;

create policy "profiles_select_self"
on public.profiles
for select
using (id = auth.uid());

create policy "profiles_update_self"
on public.profiles
for update
using (id = auth.uid())
with check (id = auth.uid());

create policy "organizations_select_members"
on public.organizations
for select
using (
  exists (
    select 1
    from public.workspaces w
    join public.workspace_memberships wm on wm.workspace_id = w.id
    where w.organization_id = organizations.id
      and wm.user_id = auth.uid()
      and wm.status = 'active'
  )
);

create policy "workspaces_select_members"
on public.workspaces
for select
using (public.is_workspace_member(id));

create policy "workspace_memberships_select_same_workspace"
on public.workspace_memberships
for select
using (public.is_workspace_member(workspace_id));

create policy "workspace_memberships_admin_manage"
on public.workspace_memberships
for all
using (public.has_workspace_role(workspace_id, array['owner', 'admin']))
with check (public.has_workspace_role(workspace_id, array['owner', 'admin']));

create policy "chat_sessions_select_members"
on public.chat_sessions_index
for select
using (public.is_workspace_member(workspace_id));

create policy "chat_messages_select_members"
on public.chat_messages_index
for select
using (
  exists (
    select 1
    from public.chat_sessions_index s
    where s.id = chat_messages_index.session_id
      and public.is_workspace_member(s.workspace_id)
  )
);

comment on column public.vault_captures_index.visibility is
  'U2 MVP visibility model: private is user-scoped, workspace is workspace-member scoped, organization is temporarily workspace-member scoped until org-wide enforcement lands in U4/U5, and system is owner/admin only.';

create policy "vault_captures_select_members"
on public.vault_captures_index
for select
using (
  case
    when visibility = 'private'
      then user_id = auth.uid()
    when visibility = 'workspace'
      then public.is_workspace_member(workspace_id)
    when visibility = 'organization'
      -- U2 MVP: organization visibility is intentionally workspace-scoped until org-wide access is implemented in U4/U5.
      then public.is_workspace_member(workspace_id)
    when visibility = 'system'
      then public.has_workspace_role(workspace_id, array['owner', 'admin'])
    else false
  end
);

comment on column public.gbrain_candidates_index.visibility is
  'U2 MVP visibility model: private is user-scoped, workspace is workspace-member scoped, organization is temporarily workspace-member scoped until org-wide enforcement lands in U4/U5, and system is owner/admin only.';

create policy "gbrain_candidates_select_members"
on public.gbrain_candidates_index
for select
using (
  case
    when visibility = 'private'
      then user_id = auth.uid()
    when visibility = 'workspace'
      then public.is_workspace_member(workspace_id)
    when visibility = 'organization'
      -- U2 MVP: organization visibility is intentionally workspace-scoped until org-wide access is implemented in U4/U5.
      then public.is_workspace_member(workspace_id)
    when visibility = 'system'
      then public.has_workspace_role(workspace_id, array['owner', 'admin'])
    else false
  end
);

create policy "audit_events_select_admins"
on public.audit_events
for select
using (workspace_id is not null and public.has_workspace_role(workspace_id, array['owner', 'admin']));
