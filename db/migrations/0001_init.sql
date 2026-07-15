-- ═══════════════════════════════════════════════════════════════
-- 0001_init.sql — extensions + hotels table
-- Run in order via supabase db push / psql (see README).
-- ═══════════════════════════════════════════════════════════════

create extension if not exists pgcrypto;   -- gen_random_uuid
create extension if not exists pg_trgm;    -- trigram: typo tolerance + partial matches
create extension if not exists unaccent;   -- accent-insensitive matching (Café ≈ Cafe)

-- ── Hotels: the single enriched source of truth for search ────
create table if not exists public.hotels (
  id                   uuid primary key default gen_random_uuid(),
  external_id          text unique,                       -- client DB id
  hotel_name           text not null check (length(hotel_name) between 1 and 300),
  country              text,
  city                 text,
  rating               numeric(3,1) check (rating is null or (rating >= 0 and rating <= 10)),
  rating_count         integer check (rating_count is null or rating_count >= 0),
  number_of_rooms      integer check (number_of_rooms is null or number_of_rooms > 0),
  nearby_transit       text,                              -- comma-separated (frontend contract)
  nearby_landmarks     text,                              -- comma-separated
  family_rooms         boolean,                           -- tri-state: true / false / unknown
  connected_rooms      boolean,
  facilities           text[] not null default '{}',
  ai_summary           text,                              -- generated once at ingestion, immutable at search
  hotel_url            text,
  images               text[] not null default '{}',
  search_keywords      text[] not null default '{}',
  search_ranking_score numeric(6,4) not null default 0,   -- precomputed static quality score
  source_metadata      jsonb not null default '{}'::jsonb,
  last_updated         timestamptz not null default now(),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  -- upsert identity when external_id is missing:
  unique (hotel_name, city)
);

comment on table public.hotels is
  'Enriched hotel records. Written only by the ingestion pipeline; read-only for the search pipeline.';

-- keep updated_at honest on any write path
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists hotels_touch_updated_at on public.hotels;
create trigger hotels_touch_updated_at
  before update on public.hotels
  for each row execute function public.touch_updated_at();

-- Lock the table down: only the service role (backend) may touch it.
alter table public.hotels enable row level security;
