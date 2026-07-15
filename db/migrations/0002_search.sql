-- ═══════════════════════════════════════════════════════════════
-- 0002_search.sql — full-text search, indexes, ranked search RPC
--
-- Design:
--  • A generated tsvector column (search_document) weights name (A),
--    city/country/keywords (B), landmarks/transit (C), summary (D).
--    Generated columns keep it always in sync with zero trigger code.
--  • GIN on the tsvector → fast FTS, never a full table scan.
--  • Trigram GIN indexes on name/city/landmarks → partial matches
--    and typo tolerance ("Barclona" still finds Barcelona).
--  • B-tree indexes on the structured filter columns.
--  • search_hotels(): one fully parameterized function that applies
--    hard filters in WHERE (index-driven) and ranks by
--    text relevance + trigram similarity + precomputed quality score.
-- ═══════════════════════════════════════════════════════════════

alter table public.hotels
  add column if not exists search_document tsvector
  generated always as (
    setweight(to_tsvector('simple', coalesce(hotel_name, '')), 'A') ||
    setweight(to_tsvector('simple', coalesce(city, '') || ' ' || coalesce(country, '')), 'B') ||
    setweight(to_tsvector('simple', coalesce(array_to_string(search_keywords, ' '), '')), 'B') ||
    setweight(to_tsvector('simple', coalesce(nearby_landmarks, '') || ' ' || coalesce(nearby_transit, '')), 'C') ||
    setweight(to_tsvector('english', coalesce(ai_summary, '')), 'D')
  ) stored;

-- FTS
create index if not exists hotels_search_document_idx
  on public.hotels using gin (search_document);

-- Typo tolerance / partial match
create index if not exists hotels_name_trgm_idx
  on public.hotels using gin (hotel_name gin_trgm_ops);
create index if not exists hotels_city_trgm_idx
  on public.hotels using gin (city gin_trgm_ops);
create index if not exists hotels_landmarks_trgm_idx
  on public.hotels using gin (nearby_landmarks gin_trgm_ops);
create index if not exists hotels_transit_trgm_idx
  on public.hotels using gin (nearby_transit gin_trgm_ops);

-- Structured filters
create index if not exists hotels_city_lower_idx    on public.hotels (lower(city));
create index if not exists hotels_country_lower_idx on public.hotels (lower(country));
create index if not exists hotels_rating_idx        on public.hotels (rating desc nulls last);
create index if not exists hotels_family_idx        on public.hotels (family_rooms) where family_rooms = true;
create index if not exists hotels_connected_idx     on public.hotels (connected_rooms) where connected_rooms = true;
create index if not exists hotels_last_updated_idx  on public.hotels (last_updated);

-- ── Ranked search ──────────────────────────────────────────────
create or replace function public.search_hotels(
  p_country         text default null,
  p_city            text default null,
  p_hotel_name      text default null,
  p_family_rooms    boolean default null,
  p_connected_rooms boolean default null,
  p_near_landmark   text default null,
  p_near_transit    text default null,
  p_min_rating      numeric default null,
  p_min_reviews     integer default null,
  p_keywords        text[] default null,
  p_limit           integer default 12
)
returns table (
  id uuid, external_id text, hotel_name text, country text, city text,
  rating numeric, rating_count integer, number_of_rooms integer,
  nearby_transit text, nearby_landmarks text,
  family_rooms boolean, connected_rooms boolean,
  facilities text[], ai_summary text, hotel_url text, images text[],
  search_keywords text[], search_ranking_score numeric,
  source_metadata jsonb, last_updated timestamptz,
  created_at timestamptz, updated_at timestamptz,
  match_rank real
)
language sql
stable
parallel safe
as $$
  with query_input as (
    select
      nullif(trim(coalesce(p_hotel_name, '') || ' ' ||
                  coalesce(p_near_landmark, '') || ' ' ||
                  coalesce(p_near_transit, '') || ' ' ||
                  coalesce(array_to_string(p_keywords, ' '), '')), '') as text_query
  ),
  ts as (
    select case
      when text_query is null then null
      else websearch_to_tsquery('simple', unaccent(text_query))
    end as q,
    text_query
    from query_input
  )
  select
    h.id, h.external_id, h.hotel_name, h.country, h.city,
    h.rating, h.rating_count, h.number_of_rooms,
    h.nearby_transit, h.nearby_landmarks,
    h.family_rooms, h.connected_rooms,
    h.facilities, h.ai_summary, h.hotel_url, h.images,
    h.search_keywords, h.search_ranking_score,
    h.source_metadata, h.last_updated, h.created_at, h.updated_at,
    (
      -- text relevance (0 when there is no text query)
      coalesce(case when ts.q is not null then ts_rank_cd(h.search_document, ts.q) end, 0) * 2.0
      -- typo-tolerant name similarity when a hotel name was asked for
      + coalesce(case when p_hotel_name is not null
                      then similarity(lower(h.hotel_name), lower(p_hotel_name)) end, 0) * 1.5
      -- landmark / transit proximity via trigram partial matching
      + coalesce(case when p_near_landmark is not null
                      then similarity(lower(coalesce(h.nearby_landmarks, '')), lower(p_near_landmark)) end, 0) * 1.0
      + coalesce(case when p_near_transit is not null
                      then similarity(lower(coalesce(h.nearby_transit, '')), lower(p_near_transit)) end, 0) * 0.8
      -- precomputed quality (rating, review volume, data completeness)
      + h.search_ranking_score * 1.0
    )::real as match_rank
  from public.hotels h
  cross join ts
  where
    -- hard filters: index-backed, no table scan
    (p_country is null or lower(h.country) = lower(p_country)
       or similarity(lower(coalesce(h.country, '')), lower(p_country)) > 0.55)
    and (p_city is null or lower(h.city) = lower(p_city)
       or similarity(lower(coalesce(h.city, '')), lower(p_city)) > 0.45)
    and (p_family_rooms is not true or h.family_rooms = true)
    and (p_connected_rooms is not true or h.connected_rooms = true)
    and (p_min_rating is null or h.rating >= p_min_rating)
    and (p_min_reviews is null or h.rating_count >= p_min_reviews)
    -- soft text match: require at least one signal when a text query exists
    and (
      ts.q is null
      or h.search_document @@ ts.q
      or (p_hotel_name is not null and similarity(lower(h.hotel_name), lower(p_hotel_name)) > 0.3)
      or (p_near_landmark is not null and lower(coalesce(h.nearby_landmarks, '')) % lower(p_near_landmark))
      or (p_near_transit is not null and lower(coalesce(h.nearby_transit, '')) % lower(p_near_transit))
    )
  order by match_rank desc, h.rating desc nulls last, h.rating_count desc nulls last
  limit least(greatest(coalesce(p_limit, 12), 1), 50);
$$;
