// Pulls publicly listed business email addresses out of web pages.

const EMAIL_RE = /[a-z0-9][a-z0-9._%+-]{0,63}@[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?)*\.[a-z]{2,24}/gi;
const ASSET_TLDS = /\.(png|jpe?g|gif|webp|svg|css|js|ico|bmp|tiff?|mp4|woff2?)$/i;
const JUNK_DOMAINS = new Set([
  'example.com', 'example.org', 'domain.com', 'email.com', 'yourdomain.com', 'yoursite.com', 'mysite.com',
  'sentry.io', 'wixpress.com', 'sentry.wixpress.com', 'sentry-next.wixpress.com', 'godaddy.com',
  'squarespace.com', 'shopify.com', 'wordpress.com', 'test.com', 'company.com', 'website.com',
]);
const JUNK_LOCAL = /^(no-?reply|do-?not-?reply|donotreply|mailer-daemon|postmaster|abuse|webmaster|privacy|legal|dmca|unsubscribe|bounce[s]?)$/i;
const ROLE_PREFERENCE = [
  [/^(wholesale|purchasing|buyer|buying|procurement|orders?|sales|b2b|corporate|gifts?|events?)$/i, 90],
  [/^(owner|manager|gm|ceo|founder|president|office)$/i, 85],
  [/^(info|contact|hello|hi|shop|store|team|mail|admin|inquiries|enquiries)$/i, 70],
  [/^(support|help|service|customerservice|care)$/i, 55],
  [/^(jobs|careers|hr|press|media|marketing|billing|accounts?)$/i, 35],
];

export function decodeCfEmail(hex) {
  const key = parseInt(hex.slice(0, 2), 16);
  let out = '';
  for (let i = 2; i < hex.length; i += 2) out += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16) ^ key);
  return out;
}

function deobfuscate(html) {
  return html
    .replace(/&#0*64;|&#x0*40;|&commat;/gi, '@')
    .replace(/&#0*46;|&#x0*2e;|&period;/gi, '.')
    .replace(/%40/g, '@')
    .replace(/\s*[[(]\s*at\s*[\])]\s*/gi, '@')
    .replace(/\s*[[(]\s*dot\s*[\])]\s*/gi, '.');
}

export function extractEmails(html) {
  const found = new Set();
  for (const m of html.matchAll(/data-cfemail="([0-9a-f]+)"/gi)) {
    try { found.add(decodeCfEmail(m[1])); } catch { /* ignore malformed */ }
  }
  for (const m of html.matchAll(/mailto:([^"'?>\s]+)/gi)) {
    try { found.add(decodeURIComponent(m[1])); } catch { found.add(m[1]); }
  }
  for (const m of deobfuscate(html).matchAll(EMAIL_RE)) found.add(m[0]);
  return [...found].map((e) => e.trim().toLowerCase().replace(/^[.]+|[.]+$/g, '')).filter(isUsableEmail);
}

export function isUsableEmail(email) {
  const m = /^([^@\s]+)@([^@\s]+\.[a-z]{2,24})$/i.exec(email);
  if (!m) return false;
  const [, local, domain] = m;
  if (ASSET_TLDS.test(email)) return false;
  if (JUNK_DOMAINS.has(domain) || [...JUNK_DOMAINS].some((d) => domain.endsWith('.' + d))) return false;
  if (JUNK_LOCAL.test(local)) return false;
  if (/^[0-9a-f]{16,}$/i.test(local)) return false; // tracking hashes
  return true;
}

export function rootDomain(host) {
  if (!host) return '';
  return host.toLowerCase().replace(/^www\./, '');
}

/** Score 0–100 how useful an email is for B2B outreach to this business. */
export function scoreEmail(email, siteDomain) {
  const [local, domain] = email.toLowerCase().split('@');
  let score = 50;
  for (const [re, s] of ROLE_PREFERENCE) {
    if (re.test(local)) { score = s; break; }
  }
  if (score === 50 && /^[a-z]+(\.[a-z]+)?$/.test(local)) score = 75; // looks like a person
  const site = rootDomain(siteDomain);
  if (site && (domain === site || domain.endsWith('.' + site))) score += 10;
  else if (/^(gmail|yahoo|outlook|hotmail|aol|icloud)\./.test(domain)) score -= 5; // small shops often use these — still fine
  else score -= 25; // a third party's address on the page
  return Math.max(0, Math.min(100, score));
}
