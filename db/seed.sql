-- ═══════════════════════════════════════════════════════════════
-- seed.sql — development seed so the frontend has data instantly.
-- Never run in production; the real data path is the ingestion
-- pipeline.
-- ═══════════════════════════════════════════════════════════════

insert into public.hotels
  (external_id, hotel_name, country, city, rating, rating_count, number_of_rooms,
   nearby_transit, nearby_landmarks, family_rooms, connected_rooms, facilities,
   ai_summary, hotel_url, search_keywords, search_ranking_score, source_metadata)
values
  ('seed-001', 'Hotel Miramar Barcelona', 'Spain', 'Barcelona', 4.6, 2412, 75,
   'Paral·lel metro station, Funicular de Montjuïc',
   'Montjuïc, Plaça d''Espanya, Gothic Quarter',
   true, true,
   array['Free WiFi','Pool','Spa','Restaurant','Family rooms','Parking'],
   'Hotel Miramar Barcelona is a 75-room property on Montjuïc hill with sweeping city views. It offers a pool, spa and on-site restaurant, and provides family and connected rooms suited to travelers with children. Paral·lel metro station and the Montjuïc funicular are nearby, with the Gothic Quarter a short ride away.',
   'https://example.com/miramar',
   array['family','connected rooms','pool','spa','barcelona','spain','montjuic'],
   0.87, '{"seed": true}'),

  ('seed-002', 'Le Grand Paris Étoile', 'France', 'Paris', 4.8, 5210, 120,
   'Charles de Gaulle–Étoile metro station, RER A',
   'Arc de Triomphe, Champs-Élysées, Eiffel Tower',
   true, false,
   array['Free WiFi','Restaurant','Bar','Concierge','Fitness center'],
   'Le Grand Paris Étoile is a 120-room hotel steps from the Arc de Triomphe and the Champs-Élysées, with the Eiffel Tower a short journey away. Guests have direct access to Charles de Gaulle–Étoile metro and RER A. The hotel offers family rooms, a fitness center, restaurant and concierge service, and holds a 4.8 rating across more than five thousand reviews.',
   'https://example.com/grand-paris',
   array['family','luxury','paris','france','eiffel tower','arc de triomphe'],
   0.95, '{"seed": true}'),

  ('seed-003', 'Kyoto Machiya Boutique Inn', 'Japan', 'Kyoto', 4.7, 890, 18,
   'Gion-Shijo train station, Kawaramachi station',
   'Gion district, Yasaka Shrine, Kamo River',
   false, false,
   array['Free WiFi','Breakfast','Air conditioning'],
   'Kyoto Machiya Boutique Inn is an intimate 18-room boutique property in the Gion district, close to Yasaka Shrine and the Kamo River. Gion-Shijo and Kawaramachi stations are within walking distance. The inn serves breakfast and offers air-conditioned rooms, and is rated 4.7 by nearly nine hundred guests.',
   'https://example.com/kyoto-machiya',
   array['boutique','kyoto','japan','gion','traditional'],
   0.82, '{"seed": true}'),

  ('seed-004', 'Thamesview Budget Stay', 'United Kingdom', 'London', 3.9, 3104, 210,
   'Waterloo underground station, Southwark tube station',
   'London Eye, South Bank, Big Ben',
   true, false,
   array['Free WiFi','Breakfast','Laundry'],
   'Thamesview Budget Stay is a 210-room budget hotel on the South Bank near the London Eye and Big Ben. Waterloo and Southwark underground stations are both close by. It offers family rooms, breakfast and laundry facilities, and maintains a 3.9 rating from over three thousand reviews.',
   'https://example.com/thamesview',
   array['budget','family','london','united kingdom','south bank'],
   0.71, '{"seed": true}')
on conflict (external_id) do nothing;
