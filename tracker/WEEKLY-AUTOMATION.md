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

## Schedule

The Routine fires **Mondays at 11:00 UTC**. Cron runs on UTC and does not shift
with daylight saving, so that is 7:00 AM Eastern from March to November and
6:00 AM Eastern from November to March. Adjust the cron to `0 12 * * 1` over the
winter if the hour matters.

## Changing what the digests say

The stage definitions and the "what needs to happen / who owns it" rules live in
two places and must be kept in step:

- `tracker/weekly-digest.mjs` — used by the weekly email
- `tracker/pipeline-dashboard.html` — used by the live dashboard

Both derive the next step from the board's own status labels, so most changes
are a matter of editing the `TU_ACTIONS`, `ICF_ACTIONS` and `PHASE_FALLBACK`
tables rather than writing new logic.
