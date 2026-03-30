-- Migration: add city, facilities, nearby_transit columns to hotel_enrichments
-- Run this against existing databases; schema.sql already includes these columns for fresh installs.

ALTER TABLE hotel_enrichments
  ADD COLUMN IF NOT EXISTS city TEXT,
  ADD COLUMN IF NOT EXISTS facilities TEXT[],
  ADD COLUMN IF NOT EXISTS nearby_transit TEXT;
