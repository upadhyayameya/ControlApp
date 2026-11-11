import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';

const FREEMAIL = /^(gmail|googlemail|yahoo|ymail|outlook|hotmail|live|msn|aol|icloud|me|mac|proton|protonmail|gmx|comcast|att|verizon)\./i;
const UNSUB_RE = /\b(unsubscribe|remove me|take me off|stop (emailing|contacting|sending)|opt[\s-]?out|do not (contact|email)|no longer (contact|email))\b/i;
const AUTO_SUBJECT = /(out of (the )?office|automatic reply|auto[\s-]?reply|autoreply|away from (my|the) (desk|office)|on vacation)/i;
const NEGATIVE = /\b(not interested|no thanks|no thank you|we('re| are) (all )?set|not a fit|pass on this|not at this time)\b/i;

/** Drop quoted history ("On … wrote:" and "> " lines) so threads read cleanly. */
export function stripQuoted(text) {
  const lines = String(text || '').replace(/\r\n/g, '\n').split('\n');
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^On .+(wrote|a écrit):\s*$/i.test(line) || (/^On .+/.test(line) && /wrote:\s*$/.test(lines[i + 1] || ''))) break;
    if (/^-{2,}\s*Original Message\s*-{2,}/i.test(line) || /^_{10,}$/.test(line) || /^From: .+/.test(line) && /^(Sent|Date): /.test(lines[i + 1] || '')) break;
    if (/^\s*>/.test(line)) continue;
    out.push(line);
  }
  return out.join('\n').trim();
}

export function classifyIncoming({ subject = '', text = '', headers = {} }) {
  const auto = headers['auto-submitted'];
  if ((auto && auto !== 'no') || headers['x-autoreply'] || headers['x-autorespond'] || AUTO_SUBJECT.test(subject)) return 'auto_reply';
  const head = `${subject}\n${String(text).slice(0, 600)}`;
  if (UNSUB_RE.test(head)) return 'unsubscribe';
  if (NEGATIVE.test(head)) return 'not_interested';
  return 'reply';
}

function isBounce(from, parsed) {
  return /^(mailer-daemon|postmaster|mail-daemon)@/i.test(from) ||
    /multipart\/report/i.test(parsed.headers?.get?.('content-type')?.value || '') ||
    /^(undeliverable|delivery status notification \(failure\)|mail delivery failed|returned mail)/i.test(parsed.subject || '');
}

export function makeInbox({ db, settings, config, leads, onReply = () => {}, log = console }) {
  const findMsg = db.prepare('SELECT * FROM messages WHERE message_id = ?');
  const contactByEmail = db.prepare('SELECT * FROM contacts WHERE email = ?');

  function stopSequences(contactId, status) {
    db.prepare("UPDATE enrollments SET status = ? WHERE contact_id = ? AND status = 'active'").run(status, contactId);
  }

  function handleBounce(parsed) {
    const raw = `${parsed.text || ''}\n${parsed.html || ''}`;
    let contact = null;
    for (const m of raw.matchAll(/<[^<>\s]+@[^<>\s]+>/g)) {
      const out = findMsg.get(m[0]);
      if (out?.direction === 'out') { contact = contactByEmail.get(out.to_addr); break; }
    }
    if (!contact) {
      const rcpt = /(?:Final|Original)-Recipient:\s*rfc822;\s*<?([^\s>]+)/i.exec(raw)?.[1];
      if (rcpt) contact = contactByEmail.get(rcpt.toLowerCase());
    }
    if (!contact) return { handled: false };
    db.prepare("UPDATE contacts SET status = 'bounced' WHERE id = ?").run(contact.id);
    leads.suppress(contact.email, 'bounced');
    stopSequences(contact.id, 'bounced');
    const thread = db.prepare('SELECT id FROM threads WHERE contact_id = ? ORDER BY last_message_at DESC LIMIT 1').get(contact.id);
    if (thread) db.prepare("UPDATE threads SET classification = 'bounced', status = 'closed' WHERE id = ?").run(thread.id);
    return { handled: true, kind: 'bounce', contactId: contact.id };
  }

  /** Match a parsed incoming email to an outreach thread and record it. Unrelated mail is ignored. */
  function processIncoming(parsed) {
    const messageId = parsed.messageId || null;
    if (messageId && findMsg.get(messageId)) return { handled: false, reason: 'duplicate' };
    const fromAddr = (parsed.from?.value?.[0]?.address || '').toLowerCase();
    const fromName = parsed.from?.value?.[0]?.name || null;
    if (!fromAddr) return { handled: false, reason: 'no sender' };
    if (isBounce(fromAddr, parsed)) return handleBounce(parsed);

    const refs = [parsed.inReplyTo, ...[].concat(parsed.references || [])].filter(Boolean);
    let threadId = null;
    let contact = null;
    for (const ref of refs) {
      const m = findMsg.get(ref);
      if (m?.thread_id) { threadId = m.thread_id; break; }
    }
    contact = contactByEmail.get(fromAddr);
    if (threadId && !contact) {
      const t = db.prepare('SELECT * FROM threads WHERE id = ?').get(threadId);
      // Someone else at the business answered (e.g. owner replying for info@): add them as a contact.
      if (t?.business_id) contact = leads.addContact(t.business_id, { email: fromAddr, name: fromName, source: 'reply', confidence: 95 }).contact;
    }
    if (!contact) {
      const domain = fromAddr.split('@')[1];
      const biz = !FREEMAIL.test(domain) && db.prepare('SELECT * FROM businesses WHERE domain = ?').get(domain);
      if (!biz) return { handled: false, reason: 'not an outreach contact' };
      contact = leads.addContact(biz.id, { email: fromAddr, name: fromName, source: 'reply', confidence: 95 }).contact;
    }
    if (!contact) return { handled: false, reason: 'could not create contact' };
    if (!contact.name && fromName) db.prepare('UPDATE contacts SET name = ? WHERE id = ?').run(fromName, contact.id);
    if (!threadId) threadId = db.prepare('SELECT id FROM threads WHERE contact_id = ? ORDER BY last_message_at DESC LIMIT 1').get(contact.id)?.id ?? null;

    const headers = {};
    for (const h of ['auto-submitted', 'x-autoreply', 'x-autorespond']) {
      const v = parsed.headers?.get?.(h);
      if (v) headers[h] = String(v).toLowerCase();
    }
    const body = stripQuoted(parsed.text || '') || (parsed.text || '').trim();
    const classification = classifyIncoming({ subject: parsed.subject || '', text: body, headers });

    db.exec('BEGIN');
    try {
      if (!threadId) {
        threadId = Number(db.prepare('INSERT INTO threads(contact_id, business_id, subject) VALUES (?,?,?)')
          .run(contact.id, contact.business_id, parsed.subject || '(no subject)').lastInsertRowid);
      }
      db.prepare(`INSERT INTO messages(thread_id, direction, message_id, in_reply_to, from_addr, to_addr, subject, body, status, created_at)
        VALUES (?,?,?,?,?,?,?,?, 'received', ?)`).run(
        threadId, 'in', messageId, parsed.inReplyTo || null, fromAddr, config.imap.user, parsed.subject || '', body,
        (parsed.date instanceof Date && !isNaN(parsed.date) ? parsed.date : new Date()).toISOString().replace('T', ' ').slice(0, 19),
      );
      const threadStatus = classification === 'auto_reply' ? 'waiting' : classification === 'unsubscribe' ? 'closed' : 'needs_reply';
      db.prepare("UPDATE threads SET unread = 1, status = ?, classification = ?, last_message_at = datetime('now') WHERE id = ?")
        .run(threadStatus, classification, threadId);
      if (classification !== 'auto_reply') {
        stopSequences(contact.id, 'replied');
        const bizStatus = classification === 'not_interested' ? 'not_interested' : classification === 'unsubscribe' ? 'do_not_contact' : 'replied';
        db.prepare("UPDATE businesses SET status = ? WHERE id = ? AND status NOT IN ('customer')").run(bizStatus, contact.business_id);
      } else {
        // Out of office: push the next follow-up back a week instead of stopping.
        db.prepare("UPDATE enrollments SET next_send_at = datetime('now', '+7 days') WHERE contact_id = ? AND status = 'active'").run(contact.id);
      }
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
    if (classification === 'unsubscribe') leads.suppress(contact.email, 'replied unsubscribe');
    if (classification === 'reply') onReply(threadId);
    return { handled: true, threadId, classification, contactId: contact.id };
  }

  let polling = false;
  async function poll() {
    if (polling) return { skipped: true };
    if (!config.imap.host || !config.imap.user || !config.imap.pass) return { skipped: true, reason: 'IMAP not configured' };
    polling = true;
    const client = new ImapFlow({
      host: config.imap.host, port: config.imap.port, secure: config.imap.port === 993,
      auth: { user: config.imap.user, pass: config.imap.pass }, logger: false,
    });
    let handled = 0;
    try {
      await client.connect();
      const lock = await client.getMailboxLock(config.imap.mailbox);
      try {
        const validity = String(client.mailbox.uidValidity);
        let lastUid = settings.get('imap_uid_validity') === validity ? Number(settings.get('imap_last_uid') || 0) : 0;
        let uids;
        if (lastUid > 0) uids = await client.search({ uid: `${lastUid + 1}:*` }, { uid: true });
        else uids = await client.search({ since: new Date(Date.now() - 14 * 86400_000) }, { uid: true });
        uids = (uids || []).filter((u) => u > lastUid).sort((a, b) => a - b).slice(0, 200);
        for (const uid of uids) {
          const msg = await client.fetchOne(String(uid), { source: true }, { uid: true });
          if (msg?.source) {
            try {
              const res = processIncoming(await simpleParser(msg.source));
              if (res.handled) handled++;
            } catch (err) {
              log.warn?.(`[inbox] could not process uid ${uid}: ${err.message}`);
            }
          }
          lastUid = uid;
          settings.set('imap_last_uid', lastUid);
        }
        settings.set('imap_uid_validity', validity);
      } finally {
        lock.release();
      }
      await client.logout();
      settings.set('imap_last_poll', new Date().toISOString());
      settings.set('imap_last_error', '');
    } catch (err) {
      settings.set('imap_last_error', err.message);
      log.warn?.(`[inbox] poll failed: ${err.message}`);
      try { client.close(); } catch { /* ignore */ }
    } finally {
      polling = false;
    }
    return { handled };
  }

  return { processIncoming, poll };
}
