-- Base schema for hotel enrichment pipeline

CREATE TABLE IF NOT EXISTS hotels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_name TEXT NOT NULL,
  location TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS hotel_enrichments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_name TEXT NOT NULL,
  location TEXT NOT NULL,
  booking_url TEXT,
  rating NUMERIC(3,1),
  rating_count INTEGER,
  number_of_rooms INTEGER,
  family_rooms BOOLEAN,
  family_detail TEXT,
  connected_rooms BOOLEAN,
  connecting_rooms TEXT,
  connecting_detail TEXT,
  ai_summary TEXT,
  sources TEXT[],
  extraction_confidence NUMERIC(3,2),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(hotel_name, location)
);

CREATE INDEX IF NOT EXISTS idx_enrichments_lookup
  ON hotel_enrichments(hotel_name, location);

CREATE INDEX IF NOT EXISTS idx_enrichments_updated
  ON hotel_enrichments(updated_at);

-- SerpAPI usage tracking (quota: 250/month on free tier)
CREATE TABLE IF NOT EXISTS serp_usage (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  query TEXT NOT NULL,
  called_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_serp_usage_called_at
  ON serp_usage(called_at);
