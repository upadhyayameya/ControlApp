import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server/app.js';
import { envConfig } from '../server/settings.js';
import { crawlForEmails } from '../server/sourcing/crawler.js';

const quiet = { info() {}, warn() {} };
const WED_11AM_ET = new Date('2026-09-30T15:00:00Z');

function setup({ live = false, publicUrl = 'https://portal.submarine.test' } = {}) {
  const sent = [];
  const config = { ...envConfig({}), dbFile: ':memory:', secret: 'test-secret', publicUrl };
  if (live) Object.assign(config.smtp, { host: 'smtp.test', user: 'me@submarine.test', pass: 'x' });
  const ctx = createApp(config, {
    log: quiet,
    transportFactory: () => ({ sendMail: async (m) => { sent.push(m); return { messageId: m.messageId }; }, verify: async () => true }),
  });
  ctx.settings.set('min_gap_seconds', 0);
  return { ...ctx, sent, config };
}

test('crawler follows contact pages, respects robots.txt, filters by MX and summarises the site', async () => {
  const pages = {
    'https://shop.test/robots.txt': 'User-agent: *\nDisallow: /secret',
    'https://shop.test/': '<title>Shop &amp; Co</title><meta name="description" content="Handmade journals in Austin"><script>var x=1</script><a href="/contact-us">Contact</a><a href="/secret/team">Team</a><p>We carry fountain pens and letterpress cards for every occasion.</p> hello@shop.test',
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
  assert.match(r.summary, /Site title: Shop & Co/);
  assert.match(r.summary, /Handmade journals in Austin/);
  assert.match(r.summary, /fountain pens and letterpress cards/);
  assert.doesNotMatch(r.summary, /var x/);
});

async function draftAndApproveAll(outreach, db) {
  db.prepare("UPDATE enrollments SET draft_state = NULL WHERE draft_state = 'drafting'").run();
  await outreach.prepareDrafts(50);
  for (const r of db.prepare("SELECT id FROM enrollments WHERE draft_state = 'ready'").all()) outreach.approve(r.id);
}

test('import → enroll (small first, large held back) → review → send → follow-up → reply stops it', async () => {
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

  // Nothing is sent before a person approves it.
  let r = await outreach.tick(WED_11AM_ET);
  assert.equal(r.sent, false);
  await outreach.prepareDrafts(10);
  r = await outreach.tick(WED_11AM_ET);
  assert.equal(r.sent, false, 'drafts waiting for review are not sent');
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM enrollments WHERE draft_state = 'ready'").get().n, 2);
  const tinyEnr = db.prepare("SELECT e.* FROM enrollments e JOIN contacts c ON c.id = e.contact_id WHERE c.email = 'owner@tinypens.test'").get();
  assert.throws(() => outreach.approve(tinyEnr.id, { subject: 'Hi {{company}}', body: 'x' }), /placeholder/);
  outreach.approve(tinyEnr.id, { subject: 'Pens for Tiny Pens', body: 'Hi Ana, I noticed you stock fountain pens — distinctive metal, fountain and coffee-scented pens.' });

  // Live mode requires compliance settings.
  settings.set('send_mode', 'live');
  r = await outreach.tick(WED_11AM_ET);
  assert.equal(r.sent, false);
  assert.match(r.reason, /Physical mailing address|From email|Sender name/);
  db.prepare("UPDATE campaigns SET status = 'active'").run();
  settings.set('from_email', 'me@submarine.test');
  settings.set('sender_name', 'Priya');
  settings.set('physical_address', '1 Pen Street, Mumbai, India');
  db.prepare("UPDATE enrollments SET next_send_at = datetime('now', '-1 minute')").run();

  r = await outreach.tick(WED_11AM_ET);
  assert.equal(r.sent, true);
  assert.equal(r.to, 'owner@tinypens.test', 'only the approved email goes out');
  const first = sent[0];
  assert.equal(first.subject, 'Pens for Tiny Pens');
  assert.match(first.text, /^Hi Ana, I noticed you stock fountain pens/, 'the reviewed text is what is sent');
  assert.match(first.text, /1 Pen Street, Mumbai/);
  assert.match(first.text, /\/u\/[\w-]+\.[\w-]+/);
  assert.match(first.headers['List-Unsubscribe'], /^<http/);
  r = await outreach.tick(WED_11AM_ET);
  assert.equal(r.sent, false, 'Mid Gifts draft is still unapproved');

  // Outside business hours nothing goes out.
  await draftAndApproveAll(outreach, db);
  r = await outreach.tick(new Date('2026-09-30T03:00:00Z'));
  assert.equal(r.sent, false);

  // Follow-up threads onto the first message.
  const enr = db.prepare('SELECT * FROM enrollments WHERE id = ?').get(tinyEnr.id);
  assert.equal(enr.current_step, 1);
  db.prepare("UPDATE enrollments SET next_send_at = datetime('now', '-1 minute')").run();
  await draftAndApproveAll(outreach, db);
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

test('AI drafts are written per business from its website research, with a fit score', async () => {
  const { leads, outreach, ai, db, catalog } = setup();
  const prompts = [];
  ai.enabled = () => true;
  ai.draftPersonal = async (args) => {
    prompts.push(args);
    const coffee = args.catalog.find((p) => p.name === 'Coffee Aroma Collection');
    return {
      subject: `Pens for ${args.business.name}'s journal wall`,
      body: `Hi there, saw your journal wall in ${args.business.city}. Catalog: ${args.brochure?.url}`,
      product_ids: [coffee.id, 99999], fit: 5, fit_reason: 'Sells premium stationery.',
    };
  };
  const brochure = catalog.addBrochure({ title: 'Spring catalog', filename: 'submarine.pdf', data: Buffer.from('%PDF-1.4 test').toString('base64') });
  leads.importRows([{ company: 'Ink & Paper', email: 'hello@inkpaper.test', city: 'Portland', state: 'OR', segment: 'stationery' }]);
  db.prepare("UPDATE businesses SET site_summary = 'Site title: Ink & Paper — journals and fountain pens'").run();
  const cid = Number(db.prepare("INSERT INTO campaigns(name, status) VALUES ('ai', 'active')").run().lastInsertRowid);
  db.prepare("INSERT INTO campaign_steps(campaign_id, step_no, delay_days, subject, body) VALUES (?, 0, 0, 'x', 'brief')").run(cid);
  outreach.enroll(cid, {});
  assert.equal(await outreach.prepareDrafts(5), 1);
  assert.match(prompts[0].business.site_summary, /fountain pens/);
  const e = db.prepare('SELECT * FROM enrollments').get();
  assert.equal(e.draft_state, 'ready');
  assert.equal(e.draft_subject, "Pens for Ink & Paper's journal wall");
  assert.equal(db.prepare('SELECT fit_score FROM businesses').get().fit_score, 5);
  assert.ok(prompts[0].catalog.length >= 5, 'the whole catalog is offered to choose from');
  assert.equal(prompts[0].brochure.url, brochure.url);
  assert.match(e.draft_body, /\/b\/[\w-]+/);
  const chosen = JSON.parse(e.draft_products);
  assert.equal(chosen.length, 1, 'unknown product ids are dropped');

  await outreach.draftFor(e.id, 'mention free samples');
  assert.equal(prompts[1].hint, 'mention free samples');

  outreach.skip(e.id, { notAFit: true });
  assert.equal(db.prepare('SELECT status FROM businesses').get().status, 'not_a_fit');
  assert.equal(outreach.enroll(cid, {}), 0, 'not-a-fit businesses are never re-enrolled');
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

    // Brochure upload is behind login; its share link is public so recipients can open it.
    const up = await fetch(base + '/api/brochures', { method: 'POST', headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ title: 'Catalog', filename: 'cat.pdf', mime: 'application/pdf', data: Buffer.from('%PDF-1.4 hi').toString('base64') }) }).then((r) => r.json());
    const pdf = await fetch(base + up.open_path);
    assert.equal(pdf.headers.get('content-type'), 'application/pdf');
    assert.equal(await pdf.text(), '%PDF-1.4 hi');
    assert.equal((await fetch(base + '/b/nope')).status, 404);
    assert.equal((await fetch(base + '/api/brochures', { method: 'POST' })).status, 401);
  } finally {
    server.close();
  }
});

test('template drafts list suitable pens + brochure link; attached brochures are really sent', async () => {
  const { leads, outreach, db, settings, catalog, sent } = setup({ live: true });
  settings.set('from_email', 'me@submarine.test');
  settings.set('sender_name', 'Ameya Upadhyay');
  settings.set('sender_phone', '+1 555 0100');
  settings.set('physical_address', '1 Pen Street, Mumbai, India');
  settings.set('send_mode', 'live');
  const b = catalog.addBrochure({ title: 'Catalog', filename: 'submarine-catalog.pdf', data: Buffer.from('%PDF-1.4 x').toString('base64') });
  leads.importRows([{ company: 'Bean There Roasters', email: 'hello@beanthere.test', state: 'NY', segment: 'coffee' }]);
  const cid = Number(db.prepare("INSERT INTO campaigns(name, status) VALUES ('c', 'active')").run().lastInsertRowid);
  const { STARTER_STEPS } = await import('../server/templates.js');
  STARTER_STEPS.forEach((st, i) => db.prepare('INSERT INTO campaign_steps(campaign_id, step_no, delay_days, subject, body) VALUES (?,?,?,?,?)').run(cid, i, st.delay_days, st.subject, st.body));
  outreach.enroll(cid, {});
  await outreach.prepareDrafts(5);
  const e = db.prepare('SELECT * FROM enrollments').get();
  assert.match(e.draft_body, /^Hi there,\n\nI'm Ameya from Submarine Pens/);
  assert.match(e.draft_body, /- Coffee Aroma Collection: /, 'coffee roaster gets the coffee pens first');
  assert.ok(e.draft_body.includes(b.url), 'brochure link included');
  assert.doesNotMatch(e.draft_body, /\{\{/);

  outreach.approve(e.id, { attachments: [b.id] });
  const r = await outreach.tick(WED_11AM_ET);
  assert.equal(r.sent, true, r.reason);
  const m = sent[0];
  assert.equal(m.attachments[0].filename, 'submarine-catalog.pdf');
  assert.match(m.text, /Ameya Upadhyay\nUS Partnerships, Submarine Pens\n\+1 555 0100\nwww\.submarinepens\.com/);
  assert.match(m.text, /reply "no thanks"/);
  assert.equal(db.prepare('SELECT attachments FROM messages').get().attachments, 'submarine-catalog.pdf');
  settings.set('min_gap_seconds', 60);
  assert.ok(Number(settings.get('next_send_after')) >= WED_11AM_ET.getTime(), 'randomised spacing recorded');
});

test('on a home computer (localhost): opt-out by reply, brochures attached, keys entered in the portal', async () => {
  const { leads, outreach, db, settings, catalog, sent, config, app } = setup({ live: true, publicUrl: 'http://localhost:3000' });
  settings.set('from_email', 'ameya@submarine.test');
  settings.set('sender_name', 'Ameya Upadhyay');
  settings.set('physical_address', 'Andheri East, Mumbai 400069, India');
  settings.set('send_mode', 'live');
  const b = catalog.addBrochure({ title: 'Catalog', filename: 'catalog.pdf', data: Buffer.from('%PDF-1.4 x').toString('base64') });
  assert.equal(b.url, null, 'no link recipients could open');
  leads.importRows([{ company: 'Bean There Roasters', email: 'hello@beanthere.test', state: 'NY', segment: 'coffee' }]);
  const cid = Number(db.prepare("INSERT INTO campaigns(name, status) VALUES ('c', 'active')").run().lastInsertRowid);
  const { STARTER_STEPS } = await import('../server/templates.js');
  STARTER_STEPS.forEach((st, i) => db.prepare('INSERT INTO campaign_steps(campaign_id, step_no, delay_days, subject, body) VALUES (?,?,?,?,?)').run(cid, i, st.delay_days, st.subject, st.body));
  outreach.enroll(cid, {});
  await outreach.prepareDrafts(5);
  const e = db.prepare('SELECT * FROM enrollments').get();
  assert.match(e.draft_body, /I've attached our catalog/);
  assert.doesNotMatch(e.draft_body, /localhost/);
  assert.deepEqual(JSON.parse(e.draft_attachments), [b.id]);
  outreach.approve(e.id);
  assert.equal((await outreach.tick(WED_11AM_ET)).sent, true);
  const m = sent[0];
  assert.equal(m.attachments[0].filename, 'catalog.pdf');
  assert.doesNotMatch(m.text, /localhost|\/u\//);
  assert.match(m.text, /reply "no thanks" or "unsubscribe"/);
  assert.equal(m.headers['List-Unsubscribe'], '<mailto:ameya@submarine.test?subject=unsubscribe>');
  assert.equal(m.headers['List-Unsubscribe-Post'], undefined);

  // A Google Drive link set on the brochure is used instead of attaching.
  catalog.setBrochureLink(b.id, 'https://drive.example/catalog');
  assert.equal(catalog.listBrochures()[0].url, 'https://drive.example/catalog');

  // Connection details entered on the Settings page take effect immediately; passwords are never sent back.
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const put = (body) => fetch(base + '/api/connections', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json());
    let r = await put({ smtp_host: 'smtp.gmail.com', smtp_port: '465', smtp_user: 'me@gmail.test', smtp_pass: 'app-pass', anthropic_key: 'sk-test' });
    assert.equal(config.smtp.host, 'smtp.gmail.com');
    assert.equal(config.smtp.port, 465);
    assert.equal(config.imap.user, 'me@gmail.test', 'IMAP login defaults to the SMTP login');
    assert.equal(config.anthropicKey, 'sk-test');
    assert.deepEqual(r.fields.smtp_pass, { set: true });
    assert.ok(!JSON.stringify(r).includes('app-pass'));
    r = await put({ smtp_pass: '' });
    assert.equal(config.smtp.pass, 'app-pass', 'blank password box keeps the saved one');
    r = await put({ clear: ['anthropic_key'] });
    assert.equal(config.anthropicKey, '');
    const meta = await fetch(base + '/api/meta').then((x) => x.json());
    assert.equal(meta.integrations.smtp, true);
    assert.equal(meta.integrations.ai, false);
  } finally {
    server.close();
  }
});
