// Optional AI drafting via the Claude API. Everything works without it; the buttons just hide.
import { SEGMENT_BY_KEY } from './data/segments.js';

export function makeAi({ config, settings, fetchImpl = fetch }) {
  const enabled = () => Boolean(config.anthropicKey);

  async function complete(system, user, maxTokens = 1200) {
    if (!enabled()) throw new Error('ANTHROPIC_API_KEY is not set');
    const res = await fetchImpl('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': config.anthropicKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: config.anthropicModel, max_tokens: maxTokens, system, messages: [{ role: 'user', content: user }] }),
      signal: AbortSignal.timeout(90000),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`Claude API ${res.status}: ${data.error?.message || res.statusText}`);
    return (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
  }

  function parseJson(text) {
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) throw new Error('AI response was not JSON');
    return JSON.parse(m[0]);
  }

  const baseSystem = () => {
    const s = settings.all();
    return `You write B2B sales emails for ${s.company_name}.
Company profile: ${s.company_profile}
Sender: ${s.sender_name || 'the business development lead'}. Website: ${s.website}.
Style: plain text, warm, specific, under 130 words, no hype, no fake claims, no invented prices or certifications,
one clear low-friction call to action (e.g. "want me to send a sample kit?"). US English. Never include an
unsubscribe line or postal address — the system appends a compliant footer automatically.`;
  };

  /** Draft a multi-step sequence for a segment using merge fields. */
  async function draftSequence({ segment, goal = '', steps = 3 }) {
    const seg = SEGMENT_BY_KEY[segment];
    const text = await complete(
      baseSystem(),
      `Write a ${steps}-step cold outreach sequence to US ${seg ? seg.label : 'small and mid-size businesses'}.
Angle: ${seg?.pitch || 'premium personalised metal pens at factory-direct prices'}.
${goal ? `Extra goal/context: ${goal}` : ''}
Use these merge fields where natural: {{first_name|there}}, {{company}}, {{city}}, {{sender_name}}.
Step 1 is the intro; later steps are short follow-ups sent in the same thread (subject "Re:").
Return ONLY JSON: {"steps":[{"delay_days":0,"subject":"...","body":"..."},{"delay_days":4,"subject":"Re:","body":"..."}]}`,
      2000,
    );
    const json = parseJson(text);
    return (json.steps || []).map((s, i) => ({
      delay_days: i === 0 ? 0 : Number(s.delay_days) || 4,
      subject: String(s.subject || (i ? 'Re:' : 'Hello')),
      body: String(s.body || ''),
    }));
  }

  /** Draft a reply to the latest message in a thread. */
  async function draftReply({ thread, messages, business, contact, instructions = '' }) {
    const history = messages
      .map((m) => `${m.direction === 'in' ? `THEM (${m.from_addr})` : 'US'} — ${m.created_at}\nSubject: ${m.subject}\n${m.body}`)
      .join('\n\n---\n\n');
    return complete(
      baseSystem(),
      `Business: ${business?.name || 'unknown'} (${business?.city || ''}, ${business?.state || ''}; segment: ${SEGMENT_BY_KEY[business?.segment]?.label || 'n/a'}).
Contact: ${contact?.name || ''} <${contact?.email || ''}> ${contact?.title || ''}
Conversation so far (oldest first):
${history}

Write our next reply to their latest message. Answer their questions directly; if you do not know a fact
(price, lead time, MOQ), say we will confirm it rather than inventing it. ${instructions ? `Guidance from the rep: ${instructions}` : ''}
Return only the email body text (no subject line, no signature block beyond the sender's first name).`,
    );
  }

  /** Classify a human reply for triage. */
  async function classify(text) {
    const out = await complete(
      'You triage replies to B2B sales emails. Answer with exactly one word.',
      `Classify this reply as one of: interested, question, referral, not_interested, unsubscribe.\n\n${text.slice(0, 3000)}`,
      10,
    );
    const word = out.toLowerCase().match(/interested|question|referral|not_interested|unsubscribe/)?.[0];
    return word === 'interested' && /not/.test(out.toLowerCase()) ? 'not_interested' : word || 'reply';
  }

  return { enabled, draftSequence, draftReply, classify };
}
