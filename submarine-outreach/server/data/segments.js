// Target segments for Submarine Pens in the US.
// phase 1 = resellers & partners (mostly small businesses, highest fit)
// phase 2 = end buyers who gift pens to their own clients (small/mid)
// phase 3 = segments dominated by large organisations — swept last.
// `queries` are Google Places text searches; `pitch` feeds templates and AI drafts.
export const SEGMENTS = [
  {
    key: 'promo_distributor', label: 'Promotional products distributors', phase: 1,
    queries: ['promotional products distributor', 'promotional products company'],
    pitch: 'factory-direct custom-imprint metal pens with low MOQs and wholesale pricing your clients will notice',
  },
  {
    key: 'corporate_gifting', label: 'Corporate gifting companies', phase: 1,
    queries: ['corporate gift company', 'corporate gifting service'],
    pitch: 'premium personalised metal pens and gift sets that fit corporate gift boxes at a fraction of luxury-brand cost',
  },
  {
    key: 'stationery', label: 'Stationery & pen shops', phase: 1,
    queries: ['stationery store', 'fountain pen store', 'pen shop'],
    pitch: 'distinctive metal, fountain and coffee-scented pens that give your shelf something customers have not seen before',
  },
  {
    key: 'gift_shop', label: 'Gift shops & boutiques', phase: 1,
    queries: ['gift shop', 'boutique gift store'],
    pitch: 'giftable pens in presentation boxes, including our coffee-aroma collection, with healthy retail margins',
  },
  {
    key: 'bookstore', label: 'Independent bookstores', phase: 1,
    queries: ['independent bookstore'],
    pitch: 'writer-friendly metal and fountain pens that pair naturally with books and journals at the register',
  },
  {
    key: 'museum_shop', label: 'Museum, science & space center shops', phase: 1,
    queries: ['science museum gift shop', 'planetarium', 'space center gift shop', 'museum store'],
    pitch: 'space-themed pens built on designs approved for NASA and ISRO programs — a natural fit for science and space retail',
  },
  {
    key: 'coffee', label: 'Coffee roasters & cafés', phase: 1,
    queries: ['coffee roaster', 'specialty coffee shop'],
    pitch: 'coffee-scented pens (Americano, Cappuccino, Mocha, Espresso, Latte, Macchiato) for retail or branded merch',
  },
  {
    key: 'engraving', label: 'Engraving, awards & trophy shops', phase: 1,
    queries: ['engraving shop', 'trophy and awards store'],
    pitch: 'engrave-ready metal pen blanks and gift sets at wholesale for your personalisation orders',
  },
  {
    key: 'office_supply', label: 'Independent office supply dealers', phase: 1,
    queries: ['office supply store'],
    pitch: 'reliable, good-looking metal pens at wholesale prices that stand out from commodity brands',
  },
  {
    key: 'real_estate', label: 'Real estate brokerages', phase: 2,
    queries: ['real estate brokerage', 'real estate agency'],
    pitch: 'closing-gift pens personalised with your brokerage logo — clients keep them long after the keys',
  },
  {
    key: 'law_firm', label: 'Law & accounting firms', phase: 2,
    queries: ['law firm', 'accounting firm', 'CPA firm'],
    pitch: 'executive metal pens personalised for client gifts and signings',
  },
  {
    key: 'medical_dental', label: 'Medical & dental practices', phase: 2,
    queries: ['dental office', 'medical clinic', 'veterinary clinic'],
    pitch: 'doctor-clip pens and branded pens for staff and patients',
  },
  {
    key: 'insurance_finance', label: 'Insurance agencies & credit unions', phase: 2,
    queries: ['insurance agency', 'credit union', 'financial advisor'],
    pitch: 'branded premium pens for account openings, signings and client appreciation',
  },
  {
    key: 'events', label: 'Event & wedding planners', phase: 2,
    queries: ['event planner', 'wedding planner', 'conference organizer'],
    pitch: 'personalised pens for guest books, welcome kits and conference swag',
  },
  {
    key: 'hotel', label: 'Hotels & resorts', phase: 3,
    queries: ['boutique hotel', 'resort'],
    pitch: 'branded in-room and front-desk pens that feel premium without luxury-brand cost',
  },
  {
    key: 'university', label: 'Universities & campus stores', phase: 3,
    queries: ['university bookstore', 'college campus store'],
    pitch: 'custom-branded metal pens for campus retail, graduation gifts and alumni programs',
  },
  {
    key: 'corporate', label: 'Corporate offices (HR / procurement)', phase: 3,
    queries: ['corporate headquarters'],
    pitch: 'custom-branded pens for onboarding kits, client gifts and events, shipped direct from our factory',
  },
];

export const SEGMENT_BY_KEY = Object.fromEntries(SEGMENTS.map((s) => [s.key, s]));
