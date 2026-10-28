# Submarine Outreach: the Claude portal

The portal is a private page in the owner's Claude account:
https://claude.ai/artifact/FzaDcnMxDPR7K9LJkzUbLZ

Nothing to install or host. It runs inside claude.ai, keeps its data in the page's own database, and works with two helpers.

| Part | What it does | When it runs |
|---|---|---|
| **Prospector** (scheduled Claude agent, `prospector-prompt.md`) | Researches businesses you add. Then it finds new small and mid-size US businesses in the types chosen in Setup and finds a *published* business email for each. It writes each one a personal intro email recommending the pens that suit it, and drafts one follow-up after N days without a reply. | Weekdays 8:49am US Eastern, or **Run now** in the portal |
| **Inbox watcher** (inside the portal, uses your Gmail read-only) | Confirms which approved drafts you actually sent, and reads replies from those businesses. It sorts them (interested, question, not interested, unsubscribe, out of office), drafts suggested answers and records bounces. Unsubscribes and bounces go on the do-not-email list. | When the portal is open: on load, then every 10 minutes |
| **You** | Approve, edit or rewrite each email. **Approve → Gmail draft** puts it in your Gmail drafts with your signature, postal address and an unsubscribe line. You press Send in Gmail. | Whenever you like |

Nothing is ever sent automatically.

## Data (page database)

The page keeps these collections:

- `config/main`: sender details, postal address, sample offer, brochure link, pricing notes, business types, states, daily target, follow-up days, large-company switch, extra agent instructions. The Setup tab edits this document, and the Prospector reads it on every run.
- `config/catalog`: the pens the agents may recommend.
- `config/agents`: the Prospector's routine id, which the Run now button uses.
- `leads/<website-host-with-dashes>`: one document per business, holding its research, fit, email, where the email was found, and its status.
- `drafts/<lead>-intro`, `drafts/<lead>-f1` and `drafts/<lead>-r-<gmail message id>`: intro, follow-up and reply drafts, with status `pending`, `in_gmail`, `sent` or `skipped`.
- `replies/<gmail message id>`: replies, each with its classification and a one-line summary.
- `suppressions/<email or domain>`: the do-not-email list.
- `runs/<timestamp>`: the activity log.

## Optional: an Inbox watcher that runs without the portal open

`inbox-prompt.md` is a standalone version of the inbox check for a scheduled routine. A routine can only use Gmail if you create it yourself in claude.ai → Routines with the Gmail connector attached. The portal's built-in check covers this as long as you open the portal once or twice a day.
