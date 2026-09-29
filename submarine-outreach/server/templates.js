// Starter sequence: one introduction and one gentle follow-up — no more.
// With AI enabled each step is only the brief: every business gets its own email, written from its
// website, recommending the pens from the Catalog that suit it. Without AI these templates are filled in.
export const STARTER_STEPS = [
  {
    delay_days: 0,
    subject: 'Pens for {{company}}',
    body: `Hi {{first_name|there}},

I'm {{sender_first_name}} from Submarine Pens — we've been making metal pens in Mumbai since 1995 and now work with businesses across the US.

I had a look at {{company}} and thought a few of our pens might suit you:
{{products}}

I've put our catalog here: {{brochure_link}}

Would it be useful if I sent you {{sample_offer}}? Happy to pick them to match what you carry.

Thanks,
{{sender_first_name}}`,
  },
  {
    delay_days: 6,
    subject: 'Re:',
    body: `Hi {{first_name|there}},

Just following up in case my note got buried. I'd be glad to send {{company}} {{sample_offer}} so you can see the quality in person — no obligation at all.

Would that be helpful?

{{sender_first_name}}`,
  },
];
