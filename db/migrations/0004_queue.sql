-- ═══════════════════════════════════════════════════════════════
-- 0004_queue.sql — Postgres-backed ingestion job queue
--
-- claim_ingestion_jobs() uses FOR UPDATE SKIP LOCKED so any number of
-- concurrent workers can safely pull batches. Jobs stuck 'processing'
-- for >15 min (crashed worker / lambda timeout) are reclaimed
-- automatically by the same query.
-- ═══════════════════════════════════════════════════════════════

create table if not exists public.ingestion_jobs (
  id          uuid primary key default gen_random_uuid(),
  dedupe_key  text not null unique,
  payload     jsonb not null,
  status      text not null default 'pending'
              check (status in ('pending','processing','done','failed')),
  attempts    integer not null default 0,
  run_after   timestamptz,                 -- backoff scheduling
  started_at  timestamptz,
  finished_at timestamptz,
  last_error  text,
  created_at  timestamptz not null default now()
);

create index if not exists ingestion_jobs_claim_idx
  on public.ingestion_jobs (status, run_after, created_at);

alter table public.ingestion_jobs enable row level security;

create or replace function public.claim_ingestion_jobs(p_limit integer)
returns table (id uuid, payload jsonb, attempts integer)
language sql
security definer
set search_path = public
as $$
  with claimable as (
    select j.id
    from public.ingestion_jobs j
    where
      (j.status = 'pending' and (j.run_after is null or j.run_after <= now()))
      or (j.status = 'processing' and j.started_at < now() - interval '15 minutes')
    order by j.created_at
    limit least(greatest(coalesce(p_limit, 10), 1), 50)
    for update skip locked
  )
  update public.ingestion_jobs j
  set status = 'processing',
      started_at = now(),
      attempts = j.attempts + 1
  from claimable c
  where j.id = c.id
  returning j.id, j.payload, j.attempts;
$$;

create or replace function public.ingestion_queue_depth()
returns table (status text, n bigint)
language sql
stable
security definer
set search_path = public
as $$
  select status, count(*)::bigint from public.ingestion_jobs group by status;
$$;
