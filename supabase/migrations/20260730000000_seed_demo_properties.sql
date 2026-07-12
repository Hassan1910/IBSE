-- Seed 10 agency-owned demo properties with clear Unsplash listing photos.
-- Idempotent: skips any title that already exists.

INSERT INTO public.properties (title, description, type, category, price, location, status, image_urls)
SELECT v.title, v.description, v.type, v.category, v.price, v.location, v.status, v.image_urls
FROM (
  VALUES
    (
      'Sunny 2-Bedroom Flat near Market',
      'Bright second-floor flat with balcony, fitted kitchen, and reliable water. Walking distance to Marsabit market.',
      'rental',
      'residential',
      18000.00,
      'Marsabit Market Area',
      'available',
      ARRAY[
        'https://images.unsplash.com/photo-1522708323590-d24dbb6b0267?w=1200&q=80',
        'https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?w=1200&q=80',
        'https://images.unsplash.com/photo-1502672260266-1c1ef2d93688?w=1200&q=80'
      ]::text[]
    ),
    (
      'Family Bungalow with Garden',
      '3-bedroom bungalow on a quiet street, private compound, borehole access, and shaded outdoor seating.',
      'rental',
      'residential',
      35000.00,
      'Marsabit Stadium Road',
      'available',
      ARRAY[
        'https://images.unsplash.com/photo-1564013799919-ab600027ffc6?w=1200&q=80',
        'https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?w=1200&q=80',
        'https://images.unsplash.com/photo-1600585154340-be6161a56a0c?w=1200&q=80'
      ]::text[]
    ),
    (
      'Executive Studio Apartment',
      'Fully furnished studio ideal for professionals. Secure parking, Wi-Fi ready, and modern finishes throughout.',
      'rental',
      'residential',
      15000.00,
      'Marsabit Town Center',
      'available',
      ARRAY[
        'https://images.unsplash.com/photo-1536376072261-38c75010e6c9?w=1200&q=80',
        'https://images.unsplash.com/photo-1493809842364-78817add7ffb?w=1200&q=80'
      ]::text[]
    ),
    (
      'Spacious 4-Bedroom Maisonette',
      'Two-level maisonette with master en-suite, servants quarter, and ample parking for three vehicles.',
      'rental',
      'residential',
      55000.00,
      'Marsabit Hospital Road',
      'available',
      ARRAY[
        'https://images.unsplash.com/photo-1600047509807-ba8f99d2cdde?w=1200&q=80',
        'https://images.unsplash.com/photo-1600607687939-ce8a6c25118c?w=1200&q=80',
        'https://images.unsplash.com/photo-1600566753190-17f0baa2a6c3?w=1200&q=80'
      ]::text[]
    ),
    (
      'Affordable Bedsitter Block Unit',
      'Clean bedsitter in a managed block. Shared compound security, prepaid electricity, and nearby shops.',
      'rental',
      'residential',
      8000.00,
      'Marsabit Manyatta',
      'available',
      ARRAY[
        'https://images.unsplash.com/photo-1554995207-c18c203602cb?w=1200&q=80',
        'https://images.unsplash.com/photo-1484154218962-a197022b5858?w=1200&q=80'
      ]::text[]
    ),
    (
      'Hillview 3-Bedroom Apartment',
      'Corner unit with panoramic views, open-plan lounge, two bathrooms, and assigned parking bay.',
      'rental',
      'residential',
      28000.00,
      'Marsabit Hill Area',
      'available',
      ARRAY[
        'https://images.unsplash.com/photo-1512917774080-9991f1c4c750?w=1200&q=80',
        'https://images.unsplash.com/photo-1613490493576-7fde63acd811?w=1200&q=80',
        'https://images.unsplash.com/photo-1570129477492-45c003edd2be?w=1200&q=80'
      ]::text[]
    ),
    (
      'Corner Shop on Main Street',
      'Ground-floor retail unit with street frontage, roll-up shutter, and storage room at the rear.',
      'rental',
      'commercial',
      40000.00,
      'Marsabit Main Street',
      'available',
      ARRAY[
        'https://images.unsplash.com/photo-1441986300917-64674bd600d8?w=1200&q=80',
        'https://images.unsplash.com/photo-1604719312566-8912e9227c6a?w=1200&q=80',
        'https://images.unsplash.com/photo-1556740738-b6a63e27c4df?w=1200&q=80'
      ]::text[]
    ),
    (
      'Office Suite above Bank Plaza',
      'Open-plan office floor (approx. 900 sq ft) with partitioned meeting room, toilets, and lift access.',
      'rental',
      'commercial',
      60000.00,
      'Marsabit Bank Plaza',
      'available',
      ARRAY[
        'https://images.unsplash.com/photo-1497366216548-37526070297c?w=1200&q=80',
        'https://images.unsplash.com/photo-1497366811353-6870744d04b2?w=1200&q=80',
        'https://images.unsplash.com/photo-1524758631624-e2822e304c36?w=1200&q=80'
      ]::text[]
    ),
    (
      'Half-Acre Plot near Airport Road',
      'Cleared half-acre with road access, survey beaconed, and title ready for transfer. Ideal for residential development.',
      'sale',
      'land',
      2500000.00,
      'Marsabit Airport Road',
      'available',
      ARRAY[
        'https://images.unsplash.com/photo-1500382017468-9049fed747ef?w=1200&q=80',
        'https://images.unsplash.com/photo-1464226184884-fa280b87c399?w=1200&q=80',
        'https://images.unsplash.com/photo-1628624747186-a941c476b7ef?w=1200&q=80'
      ]::text[]
    ),
    (
      'Quarter-Acre Residential Plot',
      'Serviced quarter-acre plot in a growing neighbourhood. Water and electricity within 200 m.',
      'sale',
      'land',
      950000.00,
      'Marsabit Dakabaricha',
      'available',
      ARRAY[
        'https://images.unsplash.com/photo-1500382017468-9049fed747ef?w=1200&q=80',
        'https://images.unsplash.com/photo-1472214103451-9374bd1c798e?w=1200&q=80'
      ]::text[]
    )
) AS v(title, description, type, category, price, location, status, image_urls)
WHERE NOT EXISTS (
  SELECT 1 FROM public.properties p WHERE p.title = v.title
);
