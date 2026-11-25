// Google Places API (New) — Text Search. https://developers.google.com/maps/documentation/places/web-service/text-search
import { normalizeState } from '../data/geo.js';

const FIELDS = [
  'places.id', 'places.displayName', 'places.formattedAddress', 'places.addressComponents',
  'places.websiteUri', 'places.nationalPhoneNumber', 'places.userRatingCount', 'places.primaryType',
  'places.businessStatus', 'nextPageToken',
].join(',');

export function mapPlace(p) {
  const comp = (type, short = true) => {
    const c = (p.addressComponents || []).find((x) => x.types?.includes(type));
    return c ? (short ? c.shortText : c.longText) : null;
  };
  return {
    place_id: p.id,
    name: p.displayName?.text || 'Unknown',
    category: p.primaryType || null,
    website: p.websiteUri || null,
    phone: p.nationalPhoneNumber || null,
    address: p.formattedAddress || null,
    city: comp('locality', false) || comp('postal_town', false) || comp('sublocality', false),
    state: normalizeState(comp('administrative_area_level_1')),
    zip: comp('postal_code'),
    country: comp('country'),
    rating_count: Number.isFinite(p.userRatingCount) ? p.userRatingCount : null,
    open: p.businessStatus ? p.businessStatus === 'OPERATIONAL' : true,
  };
}

/** Runs one text search, following up to `maxPages` pages (20 results each). */
export async function searchPlaces(apiKey, textQuery, { maxPages = 3, fetchImpl = fetch } = {}) {
  if (!apiKey) throw new Error('GOOGLE_PLACES_API_KEY is not set');
  const out = [];
  let pageToken;
  for (let page = 0; page < maxPages; page++) {
    const res = await fetchImpl('https://places.googleapis.com/v1/places:searchText', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey, 'x-goog-fieldmask': FIELDS },
      body: JSON.stringify({ textQuery, regionCode: 'US', pageSize: 20, ...(pageToken ? { pageToken } : {}) }),
      signal: AbortSignal.timeout(20000),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`Places API ${res.status}: ${data.error?.message || res.statusText}`);
    for (const p of data.places || []) {
      const mapped = mapPlace(p);
      if (mapped.open && (!mapped.country || mapped.country === 'US')) out.push(mapped);
    }
    pageToken = data.nextPageToken;
    if (!pageToken) break;
    await new Promise((r) => setTimeout(r, 1500)); // next page token needs a moment to become valid
  }
  return out;
}
