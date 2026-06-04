# CMO Profile-backed Runtime User Identity SQL Plan

This is a review-only plan for production Supabase. Do not apply automatically from Product code.

## Current Assumption

`public.profiles` already exists with:

```sql
id uuid primary key references auth.users(id) on delete cascade,
email text,
display_name text
```

No `profiles.slug` column is required for M5.5A6. Product derives `user_slug` in code from `profiles.display_name`, email local part, or short user id.

## Optional New-user Profile Bootstrap

If production does not already create `public.profiles` rows for new auth users, review a trigger like this before applying:

```sql
create or replace function public.handle_new_user_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, display_name)
  values (
    new.id,
    new.email,
    nullif(coalesce(
      new.raw_user_meta_data ->> 'full_name',
      new.raw_user_meta_data ->> 'name',
      new.raw_user_meta_data ->> 'display_name'
    ), '')
  )
  on conflict (id) do update
    set email = coalesce(excluded.email, public.profiles.email),
        display_name = coalesce(public.profiles.display_name, excluded.display_name),
        updated_at = now();

  return new;
end;
$$;

drop trigger if exists on_auth_user_created_profile on auth.users;

create trigger on_auth_user_created_profile
after insert on auth.users
for each row execute function public.handle_new_user_profile();
```

## Optional Existing-profile Backfill

Review current rows before updating:

```sql
select id, email, display_name
from public.profiles
where display_name is null
   or btrim(display_name) = ''
   or display_name ~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$';
```

Backfill empty or email-like display names from email local part. Keep Jay as `Jay`.

```sql
update public.profiles
set display_name = initcap(replace(replace(split_part(email, '@', 1), '.', ' '), '_', ' ')),
    updated_at = now()
where email is not null
  and (
    display_name is null
    or btrim(display_name) = ''
    or display_name ~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
  );

update public.profiles
set display_name = 'Jay',
    updated_at = now()
where id = '04acf682-0067-4a8c-8a42-3520a30f8ccf';
```

## Duplicate Display Name Audit

Product can derive safe fallback slugs when no explicit profile slug exists, but a durable unique slug column would require a separate reviewed schema change. Audit duplicates first:

```sql
select lower(display_name) as display_name_key, count(*) as users
from public.profiles
where display_name is not null and btrim(display_name) <> ''
group by lower(display_name)
having count(*) > 1
order by users desc, display_name_key;
```

