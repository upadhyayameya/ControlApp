# Brief: independent verification of published claims

You are a fact-checker. These claims will be published on a public dashboard about real companies, officials and politicians in Mumbai. Another researcher compiled them; assume nothing is right until you check it.

For EACH claim in your input file:
1. Open every source URL listed (use the fetch/web tools). If a URL fails, search for the same report on another reputable outlet.
2. Check, against what the source actually says:
   - the event happened as summarised (no overstatement: "FIR" vs "chargesheet" vs "conviction"; "alleged" vs "found");
   - the SUBJECT (company/agency) is explicitly named in the source in connection with this event;
   - every person in `people` is named in the source AND the source says what our text says about them (charged/arrested/convicted/named in order);
   - the date, amounts and the `kind` label are right; `status` is not contradicted by a later report you can find quickly (e.g. acquittal, quashing, bail ≠ acquittal).
3. Verdict per claim: "confirmed" | "fix" (give corrected fields only) | "remove" (source does not support it, subject not named, or source unreachable everywhere).
Prefer "remove" over guessing. Do not add new claims.

Output: write a JSON array to the path given: [{ claimId, verdict, fix: { summary?, kind?, status?, date?, people?, sources? } | null, reason: "one sentence citing what the source says" }]. Then reply with counts of confirmed / fixed / removed and the notable corrections.
