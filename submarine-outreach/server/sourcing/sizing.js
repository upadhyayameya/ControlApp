export const TIERS = ['small', 'mid', 'large'];
export const TIER_RANK = { small: 0, mid: 1, large: 2 };

/**
 * Classify a business as small (<50 staff), mid (50–499) or large (500+).
 * A known employee count wins; otherwise we fall back to signals we can see:
 * how many locations share one website (chains), then review volume.
 */
export function classifySize({ employees, locationsSeen = 1, ratingCount } = {}) {
  if (Number.isFinite(employees) && employees > 0) {
    return { tier: employees < 50 ? 'small' : employees < 500 ? 'mid' : 'large', source: 'employees' };
  }
  if (locationsSeen >= 10) return { tier: 'large', source: 'chain' };
  if (locationsSeen >= 3) return { tier: 'mid', source: 'chain' };
  if (Number.isFinite(ratingCount)) {
    if (ratingCount >= 2500) return { tier: 'large', source: 'reviews' };
    if (ratingCount >= 400) return { tier: 'mid', source: 'reviews' };
    return { tier: 'small', source: 'reviews' };
  }
  return { tier: 'small', source: 'default' };
}

/** Parses "11-50", "51-200", "1,000+", "250" style headcount ranges to a representative number. */
export function parseEmployees(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'number') return value;
  const nums = String(value).replace(/,/g, '').match(/\d+/g);
  if (!nums) return null;
  return Number(nums[0]);
}
