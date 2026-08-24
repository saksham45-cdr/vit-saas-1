-- ═══════════════════════════════════════════════════════════════
-- 0005_fix_unique_constraints.sql
-- Adds the unique constraints that 0001_init.sql defined inline
-- in CREATE TABLE but which were skipped when the table already
-- existed (CREATE TABLE IF NOT EXISTS is a no-op on an existing
-- table, so the UNIQUE clauses were never applied).
-- ═══════════════════════════════════════════════════════════════

-- external_id: client DB identifier — one row per source hotel
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.hotels'::regclass
      and contype = 'u'
      and conname = 'hotels_external_id_key'
  ) then
    alter table public.hotels
      add constraint hotels_external_id_key unique (external_id);
  end if;
end $$;

-- (hotel_name, city): fallback dedup when external_id is absent
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.hotels'::regclass
      and contype = 'u'
      and conname = 'hotels_hotel_name_city_key'
  ) then
    alter table public.hotels
      add constraint hotels_hotel_name_city_key unique (hotel_name, city);
  end if;
end $$;
