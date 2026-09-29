/**
 * Lists every placeholder that still needs checking before launch:
 * unverified assumptions, unverified tracker entries and unverified feeds.
 *   npm run assumptions
 */
import { unverifiedAssumptions } from "@/data/assumptions";
import { regulations } from "@/lib/regulations";
import sources from "@/data/news-sources.json";

const a = unverifiedAssumptions();
console.log(`\nUnverified assumptions (data/assumptions.ts): ${a.length}`);
for (const r of a) console.log(`  - ${r.key}: ${r.value} ${r.unit}\n      ${r.source}\n      ${r.sourceUrl}`);

const t = regulations.filter((m) => m.dateStatus !== "confirmed" || !m.lastVerified);
console.log(`\nTracker entries not confirmed/verified (data/regulations.json): ${t.length}`);
for (const m of t) console.log(`  - [${m.regime}] ${m.id}: ${m.date} (${m.dateStatus}), lastVerified=${m.lastVerified ?? "never"}`);

const f = sources.sources.filter((s) => !s.verified);
console.log(`\nNews feeds not yet verified (data/news-sources.json): ${f.length}`);
for (const s of f) console.log(`  - ${s.name}: ${s.url}`);
console.log("");
