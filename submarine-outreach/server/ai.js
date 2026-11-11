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
    return `You write B2B emails for ${s.company_name}, one person to one business.
Company profile: ${s.company_profile}
Sender: ${s.sender_name || 'the business development lead'}${s.sender_title ? `, ${s.sender_title}` : ''}. Website: ${s.website}.
Sample offer the sender can make: ${s.sample_offer || 'a few sample pens'}.

Write like a real person typing a thoughtful note, not marketing copy:
- Plain text, short paragraphs, contractions, natural rhythm; under 150 words for an intro.
- No "I hope this email finds you well", no "I came across your amazing...", no hype words
  (revolutionary, game-changing, synergy), no exclamation marks in a row, no emojis, no ALL CAPS.
- No invented prices, certifications, clients or facts. If something isn't known, don't claim it.
- One easy, specific ask (e.g. "Would it be useful if I mailed you a few samples?").
- End with a simple sign-off and the sender's first name only. Never add a signature block,
  unsubscribe line or postal address — the system adds those automatically.
US English.`;
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

  /**
   * Write one email for one business. It must feel personally written: grounded in what the business
   * actually does (from its website), recommending the 2–3 pens from our catalog that suit it, with a
   * link to the brochure. Returns a fit score so poor matches can be skipped at review time.
   */
  async function draftPersonal({ business, contact, step, stepIndex, history = [], hint = '', catalog = [], brochure = null }) {
    const seg = SEGMENT_BY_KEY[business?.segment];
    const isFollowUp = stepIndex > 0;
    const catalogText = catalog.length
      ? catalog.map((p) => `[${p.id}] ${p.name} — ${p.description || ''}${p.price_note ? ` (${p.price_note})` : ''}${p.brochure?.url ? ` | brochure: ${p.brochure.url}` : ''}`).join('\n')
      : '(no catalog)';
    const earlier = history.length
      ? '\nEARLIER EMAILS IN THIS THREAD\n' + history.map((m) => `${m.direction === 'in' ? 'THEM' : 'US'}: ${m.body}`).join('\n---\n')
      : '';
    const text = await complete(
      `${baseSystem()}

Personalisation rules (most important):
- This email is for ONE business. The first lines must show you actually looked at them: refer to something
  concrete and true from the research (what they sell, who their customers are, their specialty, their town).
- Pick the 2–3 pens from OUR CATALOG that genuinely suit this business and say in a few words why each one
  suits THEM (e.g. a coffee roaster → coffee-scented pens for their retail shelf or as branded merch).
  Mention them naturally in a sentence or a short dash list — not a sales sheet.
- If a brochure link is provided, include it once, casually (e.g. "I've put our catalog here: <link>").
- Only use facts present in the research. If the research is thin, stay honest and general about their
  type of business rather than guessing.
- Greet by first name only if a real person's name is given; otherwise "Hi there" or "Hi <business> team".
- Optionally a short P.S. with one more specific, relevant thought.`,
      `BUSINESS
Name: ${business?.name || ''}
Location: ${[business?.city, business?.state].filter(Boolean).join(', ') || 'USA'}
Type: ${seg?.label || business?.category || 'unknown'}${business?.employees ? `\nEmployees: ~${business.employees}` : ''}
Website: ${business?.website || 'n/a'}
Contact: ${contact?.name || '(no name)'}${contact?.title ? ` — ${contact.title}` : ''} <${contact?.email || ''}>

RESEARCH (their public website; may be empty or noisy)
${business?.site_summary || '(none)'}

WHY SUBMARINE COULD FIT THIS TYPE OF BUSINESS
${seg?.pitch || 'premium personalised metal pens at factory-direct prices'}

OUR CATALOG (choose from these only; ids in brackets)
${catalogText}
${brochure ? (brochure.url ? `\nDEFAULT BROCHURE LINK: ${brochure.url}` : '\nOUR CATALOG PDF WILL BE ATTACHED to this email — mention it briefly instead of a link.') : ''}

THIS EMAIL
${isFollowUp
    ? `A short, friendly follow-up (email ${stepIndex + 1}) in the same thread — under 80 words. Add one new, useful angle
(e.g. a different pen from the catalog that suits them, or offer to mail samples). No guilt-tripping, no "just bumping this".`
    : 'The first introduction email.'}
Brief from the rep's campaign (use as intent, not wording):
${step?.body || ''}
${earlier}
${hint ? `\nREP'S INSTRUCTIONS FOR THIS ONE: ${hint}` : ''}

Also judge fit honestly: 5 = obvious buyer/reseller of custom or retail pens, 1 = no plausible reason to contact.
Return ONLY JSON:
{"subject":"specific to them, under 8 words, lower-key, no clickbait","body":"...","product_ids":[ids you mentioned],"fit":1-5,"fit_reason":"one sentence"}`,
      1800,
    );
    const json = parseJson(text);
    const known = new Set(catalog.map((p) => p.id));
    return {
      subject: String(json.subject || '').trim(),
      body: String(json.body || '').trim(),
      product_ids: (Array.isArray(json.product_ids) ? json.product_ids : []).map(Number).filter((id) => known.has(id)),
      fit: Math.max(1, Math.min(5, Number(json.fit) || 3)),
      fit_reason: String(json.fit_reason || '').trim(),
    };
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

  return { enabled, draftSequence, draftReply, draftPersonal, classify };
}
