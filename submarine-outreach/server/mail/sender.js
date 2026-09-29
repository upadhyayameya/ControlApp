import nodemailer from 'nodemailer';
import { randomUUID } from 'node:crypto';
import { complianceFooter, unsubscribeToken } from './render.js';

export function makeSender({ db, settings, config, leads, transportFactory = nodemailer.createTransport }) {
  let transport = null;
  const smtpConfigured = () => Boolean(config.smtp.host && config.smtp.user && config.smtp.pass);
  const getTransport = () => {
    transport ??= transportFactory({
      host: config.smtp.host,
      port: config.smtp.port,
      secure: config.smtp.port === 465,
      auth: { user: config.smtp.user, pass: config.smtp.pass },
    });
    return transport;
  };

  function liveReadiness() {
    const s = settings.all();
    const missing = [];
    if (!smtpConfigured()) missing.push('SMTP_HOST / SMTP_USER / SMTP_PASS env vars');
    if (!s.from_email) missing.push('From email');
    if (!s.sender_name) missing.push('Sender name');
    if (!s.physical_address) missing.push('Physical mailing address (required by CAN-SPAM)');
    if (!config.publicUrl.startsWith('https://') && !/localhost|127\.0\.0\.1/.test(config.publicUrl)) {
      missing.push('PUBLIC_URL should be https so unsubscribe links work');
    }
    return { ready: missing.length === 0, missing };
  }

  /**
   * Send (or dry-run) one email to a contact and record it in the thread.
   * Throws on suppression or configuration problems.
   */
  async function send({ contact, subject, body, threadId = null, campaignId = null, stepNo = null, inReplyTo = null, references = [] }) {
    if (!contact) throw new Error('contact required');
    if (contact.status !== 'active' && contact.status !== 'replied') throw new Error(`contact is ${contact.status}`);
    if (leads.isSuppressed(contact.email)) throw new Error('address is on the suppression list');
    const s = settings.all();
    const live = s.send_mode === 'live';
    if (live) {
      const r = liveReadiness();
      if (!r.ready) throw new Error(`Live sending not configured: ${r.missing.join(', ')}`);
    }
    const fromEmail = s.from_email || config.smtp.user || 'outreach@localhost';
    const unsubscribeUrl = `${config.publicUrl}/u/${unsubscribeToken(contact.id, config.secret)}`;
    const text = `${body.trim()}\n${complianceFooter({ settings: s, unsubscribeUrl })}\n`;
    const messageId = `<${randomUUID()}@${fromEmail.split('@')[1] || 'localhost'}>`;

    let status = 'dry_run';
    let error = null;
    if (live) {
      try {
        await getTransport().sendMail({
          from: s.sender_name ? { name: s.sender_name, address: fromEmail } : fromEmail,
          to: contact.name ? { name: contact.name, address: contact.email } : contact.email,
          replyTo: s.reply_to || undefined,
          subject,
          text,
          messageId,
          inReplyTo: inReplyTo || undefined,
          references: references.length ? references : undefined,
          headers: {
            'List-Unsubscribe': `<${unsubscribeUrl}>, <mailto:${s.reply_to || fromEmail}?subject=unsubscribe>`,
            'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
          },
        });
        status = 'sent';
      } catch (err) {
        status = 'failed';
        error = err.message;
      }
    }

    db.exec('BEGIN');
    try {
      if (!threadId) {
        const info = db.prepare('INSERT INTO threads(contact_id, business_id, subject, status) VALUES (?,?,?,?)')
          .run(contact.id, contact.business_id, subject, 'waiting');
        threadId = Number(info.lastInsertRowid);
      }
      db.prepare(`INSERT INTO messages(thread_id, direction, message_id, in_reply_to, from_addr, to_addr, subject, body, status, error, campaign_id, step_no)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
        .run(threadId, 'out', messageId, inReplyTo, fromEmail, contact.email, subject, text, status, error, campaignId, stepNo);
      if (status !== 'failed') {
        db.prepare("UPDATE threads SET last_message_at = datetime('now'), status = 'waiting', unread = 0 WHERE id = ?").run(threadId);
        db.prepare("UPDATE businesses SET status = 'contacted' WHERE id = ? AND status IN ('new','enriched','no_email')").run(contact.business_id);
      }
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
    if (status === 'failed') throw Object.assign(new Error(`SMTP error: ${error}`), { threadId });
    return { threadId, messageId, status };
  }

  return { send, liveReadiness, smtpConfigured, verify: () => getTransport().verify() };
}
