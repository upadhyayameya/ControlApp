// Starter sequence used when a campaign is created without AI. Edit freely in the portal.
export const STARTER_STEPS = [
  {
    delay_days: 0,
    subject: 'Custom metal pens for {{company}}',
    body: `Hi {{first_name|there}},

I'm {{sender_name}} with Submarine Pens — we've manufactured metal pens in Mumbai since 1995 and now supply businesses across the US.

I thought of {{company}} because we offer {{pitch}}.

Would it help if I sent a small sample kit so you can feel the quality before deciding anything?

Best,
{{sender_name}}`,
  },
  {
    delay_days: 4,
    subject: 'Re:',
    body: `Hi {{first_name|there}},

Quick follow-up — happy to send a few samples (including our coffee-scented and space-themed pens) to {{company}} in {{city|your city}}, no obligation.

Should I send them to your attention?

{{sender_name}}`,
  },
  {
    delay_days: 7,
    subject: 'Re:',
    body: `Hi {{first_name|there}},

I'll close the loop here so I don't crowd your inbox. If custom or wholesale pens ever come up for {{company}}, just reply to this email and I'll get you pricing and samples the same week.

Thanks,
{{sender_name}}`,
  },
];
