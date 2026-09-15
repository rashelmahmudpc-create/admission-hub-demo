-- Admission Hub private sync vault.
-- Apply only to the dedicated `admission-hub` Supabase project.
-- The database password and service-role key are never used by the web app.

create extension if not exists pgcrypto with schema extensions;

create table if not exists public.admission_sync_vaults (
  id uuid primary key default gen_random_uuid(),
  secret_hash text not null unique,
  schema_version integer not null default 1 check (schema_version = 1),
  latest_revision bigint not null default 0 check (latest_revision >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.admission_sync_snapshots (
  vault_id uuid not null references public.admission_sync_vaults(id) on delete restrict,
  revision bigint not null check (revision > 0),
  device_id text not null check (char_length(device_id) between 8 and 160),
  ciphertext text not null check (char_length(ciphertext) > 40),
  manifest jsonb not null,
  content_hash text not null check (char_length(content_hash) between 32 and 160),
  created_at timestamptz not null default now(),
  primary key (vault_id, revision)
);

create index if not exists admission_sync_snapshots_latest_idx
  on public.admission_sync_snapshots (vault_id, revision desc);

alter table public.admission_sync_vaults enable row level security;
alter table public.admission_sync_snapshots enable row level security;

revoke all on table public.admission_sync_vaults from anon, authenticated;
revoke all on table public.admission_sync_snapshots from anon, authenticated;

create or replace function public.admission_sync_secret_hash(p_secret text)
returns text
language sql
immutable
strict
set search_path = public, extensions
as $$
  select encode(extensions.digest(p_secret, 'sha256'), 'hex');
$$;

create or replace function public.admission_sync_bootstrap(
  p_secret text,
  p_device_id text,
  p_ciphertext text,
  p_manifest jsonb,
  p_content_hash text
)
returns table (vault_id uuid, revision bigint)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_hash text;
  v_id uuid;
begin
  if char_length(p_secret) < 40 then
    raise exception 'invalid_recovery_secret' using errcode = '22023';
  end if;

  v_hash := public.admission_sync_secret_hash(p_secret);
  insert into public.admission_sync_vaults (secret_hash, latest_revision)
    values (v_hash, 1)
    returning id into v_id;

  insert into public.admission_sync_snapshots (
    vault_id, revision, device_id, ciphertext, manifest, content_hash
  ) values (
    v_id, 1, p_device_id, p_ciphertext, coalesce(p_manifest, '{}'::jsonb), p_content_hash
  );

  return query select v_id, 1::bigint;
end;
$$;

create or replace function public.admission_sync_pull(
  p_vault_id uuid,
  p_secret text
)
returns table (
  revision bigint,
  ciphertext text,
  manifest jsonb,
  content_hash text,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if not exists (
    select 1 from public.admission_sync_vaults
    where id = p_vault_id
      and secret_hash = public.admission_sync_secret_hash(p_secret)
  ) then
    raise exception 'invalid_sync_vault' using errcode = '28000';
  end if;

  return query
  select s.revision, s.ciphertext, s.manifest, s.content_hash, s.created_at
  from public.admission_sync_snapshots s
  where s.vault_id = p_vault_id
  order by s.revision desc
  limit 1;
end;
$$;

create or replace function public.admission_sync_push(
  p_vault_id uuid,
  p_secret text,
  p_expected_revision bigint,
  p_device_id text,
  p_ciphertext text,
  p_manifest jsonb,
  p_content_hash text
)
returns table (revision bigint)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_current bigint;
  v_next bigint;
begin
  select latest_revision into v_current
  from public.admission_sync_vaults
  where id = p_vault_id
    and secret_hash = public.admission_sync_secret_hash(p_secret)
  for update;

  if not found then
    raise exception 'invalid_sync_vault' using errcode = '28000';
  end if;

  if v_current <> p_expected_revision then
    raise exception 'sync_revision_conflict' using errcode = 'P0001';
  end if;

  v_next := v_current + 1;
  insert into public.admission_sync_snapshots (
    vault_id, revision, device_id, ciphertext, manifest, content_hash
  ) values (
    p_vault_id, v_next, p_device_id, p_ciphertext, coalesce(p_manifest, '{}'::jsonb), p_content_hash
  );

  update public.admission_sync_vaults
  set latest_revision = v_next, updated_at = now()
  where id = p_vault_id;

  -- Keep sixteen known-good encrypted recovery points. The current snapshot is never deleted.
  delete from public.admission_sync_snapshots
  where vault_id = p_vault_id
    and revision < greatest(v_next - 15, 1);

  return query select v_next;
end;
$$;

revoke all on function public.admission_sync_secret_hash(text) from public;
revoke all on function public.admission_sync_bootstrap(text, text, text, jsonb, text) from public;
revoke all on function public.admission_sync_pull(uuid, text) from public;
revoke all on function public.admission_sync_push(uuid, text, bigint, text, text, jsonb, text) from public;
grant execute on function public.admission_sync_bootstrap(text, text, text, jsonb, text) to anon, authenticated;
grant execute on function public.admission_sync_pull(uuid, text) to anon, authenticated;
grant execute on function public.admission_sync_push(uuid, text, bigint, text, text, jsonb, text) to anon, authenticated;
