// Optional enrichment via Hunter.io Domain Search: named contacts + company headcount.
import { parseEmployees } from './sizing.js';

export async function hunterDomainSearch(apiKey, domain, { fetchImpl = fetch } = {}) {
  const url = `https://api.hunter.io/v2/domain-search?domain=${encodeURIComponent(domain)}&limit=10&type=generic&api_key=${encodeURIComponent(apiKey)}`;
  const personalUrl = url.replace('&type=generic', '&type=personal');
  const results = [];
  let employees = null;
  for (const u of [personalUrl, url]) {
    const res = await fetchImpl(u, { signal: AbortSignal.timeout(15000) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`Hunter ${res.status}: ${data.errors?.[0]?.details || res.statusText}`);
    employees ??= parseEmployees(data.data?.headcount);
    for (const e of data.data?.emails || []) {
      results.push({
        email: e.value.toLowerCase(),
        name: [e.first_name, e.last_name].filter(Boolean).join(' ') || null,
        title: e.position || null,
        confidence: Math.min(100, e.confidence ?? 50),
      });
    }
  }
  return { employees, emails: results };
}
