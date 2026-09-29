import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server/app.js';
import { envConfig } from '../server/settings.js';
import { crawlForEmails } from '../server/sourcing/crawler.js';

const quiet = { info() {}, warn() {} };
const WED_11AM_ET = new Date('2026-09-30T15:00:00Z');

function setup({ live = false } = {}) {
  const sent = [];
  const config = { ...envConfig({}), dbFile: ':memory:', secret: 'test-secret' };
  if (live) Object.assign(config.smtp, { host: 'smtp.test', user: 'me@submarine.test', pass: 'x' });
  const ctx = createApp(config, {
    log: quiet,
    transportFactory: () => ({ sendMail: async (m) => { sent.push(m); return { messageId: m.messageId }; }, verify: async () => true }),
  });
  ctx.settings.set('min_gap_seconds', 0);
  return { ...ctx, sent, config };
}

test('crawler follows contact pages, respects robots.txt and filters by MX', async () => {
  const pages = {
    'https://shop.test/robots.txt': 'User-agent: *\nDisallow: /secret',
    'https://shop.test/': '<a href="/contact-us">Contact</a><a href="/secret/team">Team</a> hello@shop.test',
    'https://shop.test/contact-us': 'Buyers: <a href="mailto:wholesale@shop.test">w</a> or bob@deadmx.test',
    'https://shop.test/secret/team': 'hidden@shop.test',
  };
  const fetchImpl = async (url) => {
    const body = pages[url];
    return new Response(body ?? 'nope', { status: body ? 200 : 404, headers: { 'content-type': 'text/html' } });
  };
  const mxResolver = async (d) => (d === 'shop.test' ? [{ exchange: 'mx.shop.test' }] : []);
  const r = await crawlForEmails('shop.test', { fetchImpl, mxResolver });
  assert.deepEqual(r.emails.map((e) => e.email), ['wholesale@shop.test', 'hello@shop.test']);
  assert.equal(r.pagesFetched, 2);
});

test('import → enroll (small first, large held back) → send sequence → reply stops it', async () => {
  const { leads, outreach, inbox, db, settings, sent } = setup({ live: true });
  const csv = [
    { company: 'Tiny Pens', email: 'owner@tinypens.test', state: 'NY', employees: '8', segment: 'stationery', first_name: 'ana' },
    { company: 'Mega Corp', email: 'buyer@mega.test', state: 'NY', employees: '9000', segment: 'stationery' },
    { company: 'Mid Gifts', email: 'info@midgifts.test', state: 'NY', employees: '120', segment: 'stationery' },
  ];
  assert.deepEqual(leads.importRows(csv), { businesses: 3, contacts: 3, skipped: 0 });

  const campaignId = Number(db.prepare("INSERT INTO campaigns(name, status) VALUES ('t', 'active')").run().lastInsertRowid);
  const step = db.prepare('INSERT INTO campaign_steps(campaign_id, step_no, delay_days, subject, body) VALUES (?,?,?,?,?)');
  step.run(campaignId, 0, 0, 'Pens for {{company}}', 'Hi {{first_name|there}}, {{pitch}}.');
  step.run(campaignId, 1, 3, 'Re:', 'Following up, {{first_name|there}}.');
  step.run(campaignId, 2, 5, 'Re:', 'Closing the loop.');

  assert.equal(outreach.enroll(campaignId, {}), 2, 'large business excluded by default');

  // Live mode requires compliance settings.
  settings.set('send_mode', 'live');
  let r = await outreach.tick(WED_11AM_ET);
  assert.equal(r.sent, false);
  assert.match(r.reason, /Physical mailing address|From email|Sender name/);
  db.prepare("UPDATE campaigns SET status = 'active'").run();
  settings.set('from_email', 'me@submarine.test');
  settings.set('sender_name', 'Priya');
  settings.set('physical_address', '1 Pen Street, Mumbai, India');
  db.prepare("UPDATE enrollments SET next_send_at = datetime('now', '-1 minute')").run();

  r = await outreach.tick(WED_11AM_ET);
  assert.equal(r.sent, true);
  assert.equal(r.to, 'owner@tinypens.test', 'small business goes first');
  const first = sent[0];
  assert.equal(first.subject, 'Pens for Tiny Pens');
  assert.match(first.text, /^Hi Ana, distinctive metal/);
  assert.match(first.text, /1 Pen Street, Mumbai/);
  assert.match(first.text, /\/u\/[\w-]+\.[\w-]+/);
  assert.match(first.headers['List-Unsubscribe'], /^<http/);

  // Outside business hours nothing goes out.
  r = await outreach.tick(new Date('2026-09-30T03:00:00Z'));
  assert.equal(r.sent, false);

  // Follow-up threads onto the first message.
  const enr = db.prepare("SELECT * FROM enrollments WHERE contact_id = (SELECT id FROM contacts WHERE email = 'owner@tinypens.test')").get();
  assert.equal(enr.current_step, 1);
  db.prepare("UPDATE enrollments SET next_send_at = datetime('now', '-1 minute')").run();
  await outreach.tick(WED_11AM_ET); // mid business intro
  await outreach.tick(WED_11AM_ET); // tiny pens follow-up
  const followUp = sent.find((m) => m.subject === 'Re: Pens for Tiny Pens');
  assert.ok(followUp, 'follow-up sent in-thread');
  assert.equal(followUp.inReplyTo, first.messageId);

  // A reply is matched to the thread and stops the sequence.
  const res = inbox.processIncoming({
    messageId: '<reply1@tinypens.test>', inReplyTo: followUp.messageId, references: [first.messageId, followUp.messageId],
    from: { value: [{ address: 'Owner@TinyPens.test', name: 'Ana Lopez' }] }, subject: 'Re: Pens for Tiny Pens',
    text: 'Sounds good — what is the MOQ?\n\nOn Wed, Sep 30, 2026 at 11:00 AM Priya wrote:\n> Hi', date: new Date(), headers: new Map(),
  });
  assert.equal(res.handled, true);
  assert.equal(res.classification, 'reply');
  const thread = db.prepare('SELECT * FROM threads WHERE id = ?').get(res.threadId);
  assert.equal(thread.status, 'needs_reply');
  assert.equal(db.prepare('SELECT status FROM enrollments WHERE id = ?').get(enr.id).status, 'replied');
  assert.equal(db.prepare('SELECT body FROM messages WHERE message_id = ?').get('<reply1@tinypens.test>').body, 'Sounds good — what is the MOQ?');
  // Duplicate delivery is ignored; unrelated mail is ignored.
  assert.equal(inbox.processIncoming({ messageId: '<reply1@tinypens.test>', from: { value: [{ address: 'owner@tinypens.test' }] } }).handled, false);
  assert.equal(inbox.processIncoming({ messageId: '<x@y>', from: { value: [{ address: 'friend@gmail.com' }] }, subject: 'lunch?', text: 'hi', headers: new Map() }).handled, false);
});

test('unsubscribe reply and bounce both suppress the contact', async () => {
  const { leads, outreach, inbox, db, sender } = setup();
  leads.importRows([
    { company: 'A Shop', email: 'a@ashop.test', state: 'TX' },
    { company: 'B Shop', email: 'b@bshop.test', state: 'TX' },
  ]);
  const cA = db.prepare("SELECT * FROM contacts WHERE email = 'a@ashop.test'").get();
  const cB = db.prepare("SELECT * FROM contacts WHERE email = 'b@bshop.test'").get();
  const sA = await sender.send({ contact: cA, subject: 'hello', body: 'hi' });
  const sB = await sender.send({ contact: cB, subject: 'hello', body: 'hi' });
  assert.equal(sA.status, 'dry_run');

  const u = inbox.processIncoming({ messageId: '<u1@ashop.test>', inReplyTo: sA.messageId, from: { value: [{ address: 'a@ashop.test' }] },
    subject: 'Re: hello', text: 'Please unsubscribe me', headers: new Map() });
  assert.equal(u.classification, 'unsubscribe');
  assert.equal(leads.isSuppressed('a@ashop.test'), true);
  await assert.rejects(sender.send({ contact: db.prepare('SELECT * FROM contacts WHERE id = ?').get(cA.id), subject: 'x', body: 'y' }), /unsubscribed|suppression/);

  const b = inbox.processIncoming({ messageId: '<bounce@mx>', from: { value: [{ address: 'MAILER-DAEMON@mx.google.com' }] },
    subject: 'Delivery Status Notification (Failure)', text: `Original message ${sB.messageId}\nFinal-Recipient: rfc822; b@bshop.test`, headers: new Map() });
  assert.equal(b.kind, 'bounce');
  assert.equal(db.prepare('SELECT status FROM contacts WHERE id = ?').get(cB.id).status, 'bounced');
  assert.equal(outreach.enroll(1, {}), 0);
});

test('HTTP: unsubscribe link, login gate, leads API', async () => {
  const config = { ...envConfig({}), dbFile: ':memory:', secret: 's', portalPassword: 'pw' };
  const { app, leads, db } = createApp(config, { log: quiet });
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    assert.equal((await fetch(base + '/api/leads')).status, 401);
    const login = await fetch(base + '/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: 'pw' }) });
    assert.equal(login.status, 200);
    const cookie = login.headers.get('set-cookie').split(';')[0];
    const created = await fetch(base + '/api/leads', { method: 'POST', headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ name: 'Joe Gifts', website: 'joegifts.test', email: 'joe@joegifts.test', state: 'Ohio' }) }).then((r) => r.json());
    assert.equal(created.business.state, 'OH');
    const list = await fetch(base + '/api/leads?state=OH', { headers: { cookie } }).then((r) => r.json());
    assert.equal(list.total, 1);
    assert.equal(list.rows[0].best_email, 'joe@joegifts.test');

    const { unsubscribeToken } = await import('../server/mail/render.js');
    const c = db.prepare('SELECT * FROM contacts').get();
    const url = `${base}/u/${unsubscribeToken(c.id, 's')}`;
    assert.match(await fetch(url).then((r) => r.text()), /Yes, unsubscribe me/);
    assert.equal(leads.isSuppressed(c.email), false, 'GET alone does not unsubscribe (link scanners)');
    assert.equal((await fetch(url, { method: 'POST' })).status, 200);
    assert.equal(leads.isSuppressed(c.email), true);
    assert.equal((await fetch(`${base}/u/bogus.token`, { method: 'POST' })).status, 400);
  } finally {
    server.close();
  }
});
