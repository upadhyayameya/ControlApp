# Weekly per-engineer digest — runbook

This is the procedure the Monday-morning Routine follows. It is written to be
executed by a fresh Claude session with the **monday.com** and **Microsoft 365**
connectors available. Follow it exactly and in order.

## What it produces

1. **One email per engineer**, containing only that engineer's own projects.
2. **One roll-up email** to management, covering every engineer.

Nothing is typed by hand. Everything is read live from the two monday.com
boards, so the digests reflect whatever the boards say at the moment it runs.

## Sources

| Board | ID | What it supplies |
|---|---|---|
| ICF/HBS Project Tracker | `18424932045` | The project list, current phase, ICF and HBS engineer assignment, PA/CO dates, ageing |
| Master TU Tracker | `1069746645` | Audit and implementation dates, SOW status and dates, auditor / PA lead / CO lead, running admin notes |

The two are joined through the Master TU Tracker's board-relation column
`board_relation_mm5xccpb`, which points back at the ICF board. Around 330 of the
450 ICF-board projects carry that link; the rest still appear, just without
SOW or audit-date detail.

## Steps

1. **Get the builder script.** Read `tracker/weekly-digest.mjs` from this
   repository, on branch `claude/monday-project-tracker-dashboard-x5zkit`.

2. **Run it in the monday sandbox.** Call the monday.com tool `execute_code`
   with `language: "javascript"` and the entire contents of that file as `code`.
   The sandbox is already authenticated against the monday account, so the
   script needs no token. It only reads; it sends nothing.

   - To preview without sending, pass `vars: { "DIGEST_MODE": "summary" }`.
   - For a real run, pass no vars. The script prints a JSON envelope.

3. **Check the envelope before sending anything.**
   - If `warnings` is non-empty, or `projectCount` is 0, **send nothing**.
     Report the problem and stop.
   - If `projectCount` is far below the usual few hundred, treat that as a
     failed read rather than a quiet week — stop and report.

4. **Send the individual digests.** For each entry in `perEngineer`, send a
   plain-text email with the Microsoft 365 tool `outlook_send_mail`, using that
   entry's `to`, `subject` and `body`. One recipient per email — never CC the
   other engineers onto each other's digests.

5. **Send the roll-up.** Send one email to every address in `rollup.to`, using
   `rollup.subject` and `rollup.body`.

6. **Report back** how many individual digests went out, to whom, and who was
   skipped (the `unroutable` list).

## Who receives what

**Roll-up** goes to the addresses in `ROLLUP_TO` at the top of the script:
Ameya Upadhyay, Devon Goforth, Michael Costa, David Rodriguez, Harry Haywood.

**Individual digests** go to:

- **HBS engineers** — resolved automatically. The HBS Engineer column is a real
  monday people field, so the address comes from the engineer's own monday user
  record. No mapping to maintain.
- **ICF engineers** — only those listed in `ICF_EMAILS` in the script. The ICF
  Engineer column is a dropdown of first names, so there is nothing to resolve
  an address from. Every ICF engineer still appears in the roll-up whether or
  not they receive their own email.

### Adding an ICF engineer

Uncomment or add the line in `ICF_EMAILS` in `tracker/weekly-digest.mjs`:

```js
const ICF_EMAILS = {
  'Jason': 'jason.frazier@icf.com',
};
```

The key must match the dropdown label on the board exactly. Only add an address
that has been confirmed by a person — a wrong match sends one engineer's project
list to someone at another company. Names that are placeholders rather than
people (`TBD`, `ESAI Team`, `Centralized Engineering`) are never addressed.

## Turning the schedule on

The Routine has to be created from the claude.ai Routines UI rather than from a
Claude Code session. A Routine carries its own connector grants, and a session
cannot hand its monday.com and Microsoft 365 connections to one it creates — a
Routine made that way fires with no connectors and fails every week. Creating it
in the UI attaches your own connections.

1. Go to claude.ai → **Routines** → **New routine**.
2. Name it `Weekly ICF x HBS project digests`.
3. Schedule: **Mondays at 7:00 AM Eastern** (see the note below about UTC).
4. Connectors: enable **monday.com** and **Microsoft 365**.
5. Paste this as the prompt:

```
Send the weekly ICF x HBS per-engineer project digests and the management roll-up.

Work in the repository upadhyayameya/ControlApp on branch
claude/monday-project-tracker-dashboard-x5zkit.

1. Read tracker/WEEKLY-AUTOMATION.md and follow it exactly. It is the runbook.

2. In short: read tracker/weekly-digest.mjs and run its entire contents as the
   `code` argument of the monday.com execute_code tool (language "javascript",
   no vars). The monday sandbox is already authenticated, so it needs no token.
   It only reads monday.com and sends nothing.

3. The script prints a JSON envelope:
   { perEngineer, rollup, unroutable, warnings, projectCount }.

   SAFETY CHECK before sending anything: if warnings is non-empty, or
   projectCount is 0, or projectCount is far below the usual few hundred,
   send NOTHING. Report the problem and stop.

4. For each entry in perEngineer, send one plain-text email with the
   Microsoft 365 outlook_send_mail tool using that entry's to, subject and body.
   One recipient per email - never CC engineers onto each other's digests,
   because each digest contains only that person's own projects.

5. Send one email to all the addresses in rollup.to using rollup.subject and
   rollup.body.

6. Reply with a short report: how many digests went out and to whom, plus the
   unroutable list.

Anything bound for ICF must use only the shared ICF/HBS Project Tracker, never
the HBS-internal Master TU Tracker, workload boards, admin notes or incentive
figures. The script already enforces this; do not widen it.
```

Until that is switched on, the digests can be produced on demand: ask Claude in
any session with the two connectors to "run the weekly digest runbook", and add
"preview only, do not send" to see the output without emailing anyone.

## Schedule

The Routine fires **Mondays at 11:00 UTC**. Cron runs on UTC and does not shift
with daylight saving, so that is 7:00 AM Eastern from March to November and
6:00 AM Eastern from November to March. Adjust the cron to `0 12 * * 1` over the
winter if the hour matters.

## The Monday team update (draft, not sent)

`tracker/weekly-team-update.mjs` builds a whole-team **engineering execution
update** — the counterpart to Harry's Monday revenue scoreboard rather than a
second copy of it. It reports what actually moved through the funnel last week,
what is blocked, and what has to happen this week. It needs no manually
maintained goals.

It is created as an Outlook **draft**, never sent automatically, so it is read
before it goes to the team.

### Steps

1. Read `tracker/weekly-team-update.mjs` and run its entire contents as the
   `code` argument of the monday.com `execute_code` tool (language
   `"javascript"`). Pass `vars: { "UPDATE_MODE": "summary" }` to preview it.
2. It prints `{ weekEnding, subject, body, suggestedTo, stats, warnings }`.
   If `warnings` is non-empty, stop and report.
3. Create an Outlook **draft** with the Microsoft 365 `outlook_create_draft`
   tool using `subject`, `body` and `suggestedTo`. Do not send it.
4. Reply with the headline stats so it is clear what the draft says.

### What it draws on

| Source | What it contributes |
|---|---|
| Monthly KPIs | Milestones reached last week vs the week before vs month to date, and the incentive / HBS share / savings banked |
| ICF/HBS Project Tracker + Master TU Tracker | RFIs, flawed applications, closeouts ready to move, ageing projects, projects with no engineer |
| Preapproval + Closeout Workload | Open and overdue to-dos per person |
| Projections/Actuals boards | This month's projected closeout value per programme, and invoiced-to-date against it |

The Projections/Actuals boards store their value in a formula column wrapping a
mirror. The mirror itself is unreadable through the connector, but the formula
reads back fine, which is what makes the projection figures available at all.

### Recipients

`SUGGESTED_TO` at the top of the script is a starting point taken from the
standing engineering meetings, not an authoritative distribution list. Edit it
to match who should actually receive the update.

## Changing what the digests say

The stage definitions and the "what needs to happen / who owns it" rules live in
two places and must be kept in step:

- `tracker/weekly-digest.mjs` — used by the weekly email
- `tracker/pipeline-dashboard.html` — used by the live dashboard

Both derive the next step from the board's own status labels, so most changes
are a matter of editing the `TU_ACTIONS`, `ICF_ACTIONS` and `PHASE_FALLBACK`
tables rather than writing new logic.
