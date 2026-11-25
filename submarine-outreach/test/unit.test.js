import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractEmails, scoreEmail, decodeCfEmail } from '../server/sourcing/emails.js';
import { parseRobots } from '../server/sourcing/robots.js';
import { classifySize, parseEmployees } from '../server/sourcing/sizing.js';
import { planSweep } from '../server/sourcing/sweep.js';
import { parseCsv, toCsv } from '../server/sourcing/csv.js';
import { mapPlace } from '../server/sourcing/places.js';
import { renderTemplate, unsubscribeToken, verifyUnsubscribeToken, inBusinessHours, firstName } from '../server/mail/render.js';
import { stripQuoted, classifyIncoming } from '../server/mail/inbox.js';
import { normalizeState, STATES } from '../server/data/geo.js';

test('extractEmails finds plain, mailto, entity-encoded and Cloudflare-obfuscated addresses', () => {
  const key = 0x2a;
  const encoded = key.toString(16) + [...'sales@pens.co'].map((c) => (c.charCodeAt(0) ^ key).toString(16).padStart(2, '0')).join('');
  assert.equal(decodeCfEmail(encoded), 'sales@pens.co');
  const html = `
    <a href="mailto:Orders@GiftShop.com?subject=hi">email</a>
    Write to info&#64;giftshop.com or owner [at] giftshop.com
    <span data-cfemail="${encoded}"></span>
    <img src="logo@2x.png"> noreply@giftshop.com user@example.com 9f86d081884c7d659a2feaa0c55ad015@sentry.io`;
  const found = extractEmails(html).sort();
  assert.deepEqual(found, ['info@giftshop.com', 'orders@giftshop.com', 'owner@giftshop.com', 'sales@pens.co']);
});

test('scoreEmail prefers buyer roles on the business domain', () => {
  assert.ok(scoreEmail('purchasing@shop.com', 'shop.com') > scoreEmail('info@shop.com', 'shop.com'));
  assert.ok(scoreEmail('info@shop.com', 'shop.com') > scoreEmail('info@agency.com', 'shop.com'));
  assert.ok(scoreEmail('jane.doe@shop.com', 'www.shop.com') > scoreEmail('careers@shop.com', 'shop.com'));
});

test('robots.txt rules are honoured', () => {
  const allowed = parseRobots(`User-agent: *\nDisallow: /private\nAllow: /private/contact\n\nUser-agent: BadBot\nDisallow: /`);
  assert.equal(allowed('/'), true);
  assert.equal(allowed('/private/x'), false);
  assert.equal(allowed('/private/contact'), true);
  assert.equal(parseRobots('User-agent: *\nDisallow: /')('/contact'), false);
  assert.equal(parseRobots('User-agent: *\nDisallow:')('/contact'), true);
});

test('size classification: employees > chain > reviews', () => {
  assert.equal(classifySize({ employees: 12 }).tier, 'small');
  assert.equal(classifySize({ employees: 120 }).tier, 'mid');
  assert.equal(classifySize({ employees: 5000, locationsSeen: 1 }).tier, 'large');
  assert.equal(classifySize({ locationsSeen: 4, ratingCount: 10 }).tier, 'mid');
  assert.equal(classifySize({ locationsSeen: 25 }).tier, 'large');
  assert.equal(classifySize({ ratingCount: 80 }).tier, 'small');
  assert.equal(classifySize({ ratingCount: 900 }).tier, 'mid');
  assert.deepEqual(classifySize({}), { tier: 'small', source: 'default' });
  assert.equal(parseEmployees('11-50'), 11);
  assert.equal(parseEmployees('1,001+'), 1001);
});

test('sweep plan covers every state and runs phase-1 top cities first', () => {
  const plan = planSweep().sort((a, b) => a.priority - b.priority);
  assert.equal(new Set(plan.map((j) => j.state)).size, 51);
  const firstBatch = plan.slice(0, 51);
  assert.equal(new Set(firstBatch.map((j) => j.state)).size, 51, 'first 51 jobs hit every state once');
  assert.ok(firstBatch.every((j) => j.segment === 'promo_distributor'));
  const firstPhase3 = plan.findIndex((j) => j.segment === 'corporate' || j.segment === 'hotel');
  assert.ok(plan.slice(0, firstPhase3).every((j) => j.priority < 30_000_000));
  assert.equal(STATES.length, 51);
});

test('CSV round trip with quotes and commas', () => {
  const rows = parseCsv('Company,Email,City\n"Pens, Inc.",a@pens.com,Austin\r\n"Say ""hi""",b@x.com,\n');
  assert.deepEqual(rows, [{ company: 'Pens, Inc.', email: 'a@pens.com', city: 'Austin' }, { company: 'Say "hi"', email: 'b@x.com', city: '' }]);
  assert.equal(toCsv(rows, ['company', 'city']), 'company,city\n"Pens, Inc.",Austin\n"Say ""hi""",\n');
});

test('Places result mapping', () => {
  const m = mapPlace({
    id: 'abc', displayName: { text: 'Paper & Pen' }, websiteUri: 'https://paperpen.com', userRatingCount: 42,
    addressComponents: [
      { types: ['locality'], longText: 'Austin', shortText: 'Austin' },
      { types: ['administrative_area_level_1'], longText: 'Texas', shortText: 'TX' },
      { types: ['postal_code'], longText: '78701', shortText: '78701' },
      { types: ['country'], longText: 'United States', shortText: 'US' },
    ],
    businessStatus: 'OPERATIONAL',
  });
  assert.equal(m.city, 'Austin');
  assert.equal(m.state, 'TX');
  assert.equal(m.rating_count, 42);
  assert.equal(normalizeState('texas'), 'TX');
});

test('templates, tokens and business hours', () => {
  assert.equal(renderTemplate('Hi {{first_name|there}}, {{company}}!', { first_name: '', company: 'Acme' }), 'Hi there, Acme!');
  assert.equal(firstName('jane doe'), 'Jane');
  assert.equal(firstName('Info Desk 123'), 'Info');
  const tok = unsubscribeToken(42, 'secret');
  assert.equal(verifyUnsubscribeToken(tok, 'secret'), 42);
  assert.equal(verifyUnsubscribeToken(tok, 'other'), null);
  assert.equal(verifyUnsubscribeToken(tok.slice(0, -1) + 'x', 'secret'), null);
  const wed15utc = new Date('2026-09-30T15:00:00Z'); // 11:00 New York, 08:00 Los Angeles
  assert.equal(inBusinessHours(wed15utc, 'America/New_York'), true);
  assert.equal(inBusinessHours(wed15utc, 'America/Los_Angeles'), false);
  assert.equal(inBusinessHours(new Date('2026-10-03T15:00:00Z'), 'America/New_York'), false, 'Saturday');
});

test('reply parsing', () => {
  const text = 'Yes please send samples.\n\nOn Tue, Sep 29, 2026 at 10:00 AM Sam <sam@x.com> wrote:\n> Hi there\n> old';
  assert.equal(stripQuoted(text), 'Yes please send samples.');
  assert.equal(classifyIncoming({ subject: 'Re: pens', text: 'Please remove me from your list' }), 'unsubscribe');
  assert.equal(classifyIncoming({ subject: 'Automatic reply: pens', text: 'I am away' }), 'auto_reply');
  assert.equal(classifyIncoming({ subject: 'Re: pens', text: 'x', headers: { 'auto-submitted': 'auto-replied' } }), 'auto_reply');
  assert.equal(classifyIncoming({ subject: 'Re: pens', text: 'No thanks, we are all set.' }), 'not_interested');
  assert.equal(classifyIncoming({ subject: 'Re: pens', text: 'What is your MOQ?' }), 'reply');
});
