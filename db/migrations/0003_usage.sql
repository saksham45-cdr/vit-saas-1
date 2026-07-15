-- ═══════════════════════════════════════════════════════════════
-- 0003_usage.sql — API usage & cost accounting
--
-- One row per (provider, day). record_api_usage() is a single atomic
-- INSERT ... ON CONFLICT DO UPDATE, so concurrent serverless
-- instances can never lose an increment — this is what makes the
-- DataForSEO $20 hard stop and the 80% quota gates trustworthy.
-- ═══════════════════════════════════════════════════════════════

create table if not exists public.api_usage_daily (
  provider         text not null check (provider in ('nvidia_key_1','nvidia_key_2','dataforseo')),
  usage_date       date not null default current_date,
  requests         bigint not null default 0,
  failures         bigint not null default 0,
  retries          bigint not null default 0,
  tokens           bigint not null default 0,
  cost_usd         numeric(10,4) not null default 0,
  total_latency_ms bigint not null default 0,
  last_request_at  timestamptz,
  primary key (provider, usage_date)
);

alter table public.api_usage_daily enable row level security;

create or replace function public.record_api_usage(
  p_provider   text,
  p_success    boolean,
  p_retries    integer,
  p_tokens     bigint,
  p_cost_usd   numeric,
  p_latency_ms integer
)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.api_usage_daily as u
    (provider, usage_date, requests, failures, retries, tokens, cost_usd, total_latency_ms, last_request_at)
  values
    (p_provider, current_date, 1,
     case when p_success then 0 else 1 end,
     greatest(p_retries, 0),
     greatest(p_tokens, 0),
     greatest(p_cost_usd, 0),
     greatest(p_latency_ms, 0),
     now())
  on conflict (provider, usage_date) do update set
    requests         = u.requests + 1,
    failures         = u.failures + (case when p_success then 0 else 1 end),
    retries          = u.retries + greatest(p_retries, 0),
    tokens           = u.tokens + greatest(p_tokens, 0),
    cost_usd         = u.cost_usd + greatest(p_cost_usd, 0),
    total_latency_ms = u.total_latency_ms + greatest(p_latency_ms, 0),
    last_request_at  = now();
$$;
