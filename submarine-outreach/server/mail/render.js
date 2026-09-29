import { createHmac, timingSafeEqual } from 'node:crypto';

/** Replace {{key}} / {{key|fallback}} placeholders. Unknown keys render as their fallback or empty. */
export function renderTemplate(text, vars) {
  return String(text || '').replace(/\{\{\s*([a-z_]+)\s*(?:\|([^}]*))?\}\}/gi, (_, key, fallback) => {
    const v = vars[key.toLowerCase()];
    return v != null && String(v).trim() !== '' ? String(v) : (fallback ?? '').trim();
  });
}

export function firstName(name) {
  if (!name) return '';
  const first = String(name).trim().split(/\s+/)[0];
  return /^[A-Za-z][A-Za-z'-]+$/.test(first) ? first[0].toUpperCase() + first.slice(1) : '';
}

export function mergeVars({ contact, business, segment, settings }) {
  return {
    first_name: firstName(contact?.name),
    contact_name: contact?.name || '',
    title: contact?.title || '',
    company: business?.name || '',
    city: business?.city || '',
    state: business?.state || '',
    segment: segment?.label || '',
    pitch: segment?.pitch || 'premium personalised metal pens at factory-direct prices',
    sender_name: settings.sender_name,
    sender_company: settings.company_name,
    website: settings.website,
  };
}

export function unsubscribeToken(contactId, secret) {
  const id = Buffer.from(String(contactId)).toString('base64url');
  const sig = createHmac('sha256', secret).update(`unsub:${contactId}`).digest('base64url').slice(0, 22);
  return `${id}.${sig}`;
}

export function verifyUnsubscribeToken(token, secret) {
  const [id, sig] = String(token || '').split('.');
  if (!id || !sig) return null;
  const contactId = Number(Buffer.from(id, 'base64url').toString());
  if (!Number.isInteger(contactId)) return null;
  const expected = unsubscribeToken(contactId, secret).split('.')[1];
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b) ? contactId : null;
}

/** CAN-SPAM footer: identifies the sender, gives a physical postal address and a working opt-out. */
export function complianceFooter({ settings, unsubscribeUrl }) {
  return [
    '',
    '--',
    [settings.sender_name, settings.company_name].filter(Boolean).join(' · '),
    settings.physical_address,
    `Not relevant for you? Unsubscribe here: ${unsubscribeUrl} (or just reply "unsubscribe").`,
  ].filter((l) => l !== undefined && l !== null).join('\n');
}

/** Is `date` inside business hours in the recipient's timezone? */
export function inBusinessHours(date, tz, { start = 9, end = 16, weekdaysOnly = true } = {}) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', hourCycle: 'h23', weekday: 'short' })
      .formatToParts(date).map((p) => [p.type, p.value]),
  );
  const hour = Number(parts.hour);
  if (weekdaysOnly && (parts.weekday === 'Sat' || parts.weekday === 'Sun')) return false;
  return hour >= start && hour < end;
}
