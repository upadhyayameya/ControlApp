# Research brief (shared by all project-research agents)

Today is 2026-11-16. We are building a public transparency dashboard of government projects in Mumbai (Mumbai City + Mumbai Suburban districts; BMC limits). Use web search. Be accurate and cite sources. Never invent numbers, names or dates: use null.

ALREADY COVERED: every project already in public-works/data/*.js (export the list with the command in SKILL.md and pass it to the researcher).

Prefer projects that are ongoing, delayed, stalled or completed since 2023. Aim for 15–25 records. Quality over quantity: every record needs at least one real source URL you actually opened.

Output: write the records to the file path given in your task as a JavaScript array literal (one object per project), exactly this shape. Then reply with just a one-paragraph summary (count, anything uncertain).

{
  id: "<PREFIX>-01",                 // prefix given in your task
  name: "Full plain-English name",
  shortName: "Short name",
  summary: "1–2 plain sentences: what it is and where it stands now.",
  sector: "Metro rail | Suburban rail | Roads & bridges | Water & sanitation | Flood control | Solid waste | Housing | Health | Education | Ports & waterfront | Heritage & public spaces | Power & energy | Other",
  agency: "BMC | MMRDA | MSRDC | MHADA | SRA | PWD Maharashtra | Central Railway | Western Railway | MRVC | Mumbai Port Authority | ... (short form)",
  status: "Completed | Partially open | In progress | Delayed | Stalled | Not started",
  progress: null or number 0-100,
  cost: { original: number|null, revised: number|null, note: "optional" },   // ₹ crore
  funders: [{ name: "BMC (own funds)", type: "Central Govt | State Govt | Municipal | Multilateral | Private / PPP", amount: number|null, note: "optional" }],
  contractor: "string or null",
  startDate: "YYYY or YYYY-MM or YYYY-MM-DD or null", targetDate: ..., revisedTargetDate: ..., completedDate: ...,
  delayReason: "string or null",
  areas: ["Localities"],
  constituencies: [],               // Maharashtra assembly constituencies it lies in, chosen ONLY from this exact list:
     // Borivali, Dahisar, Magathane, Mulund, Vikhroli, Bhandup West, Jogeshwari East, Dindoshi, Kandivali East, Charkop, Malad West, Goregaon, Versova, Andheri West, Andheri East, Vile Parle, Chandivali, Ghatkopar West, Ghatkopar East, Mankhurd Shivaji Nagar, Anushakti Nagar, Chembur, Kurla, Kalina, Vandre East, Vandre West, Dharavi, Sion Koliwada, Wadala, Mahim, Worli, Shivadi, Byculla, Malabar Hill, Mumbadevi, Colaba
  citywide: false,                  // true only if it genuinely spans the whole city
  points: [[19.0123, 72.8456, "Named point, e.g. station or site"]],   // 1+ approximate lat/lng of the site(s); for linear works give start, end and key points along it in order. Within ~300 m is fine.
  sources: [{ url: "https://...", title: "Publication", date: "YYYY-MM-DD or null", claim: "what it supports" }],
  lastVerified: "2026-11-16"
}
Status must reflect the latest report you found; include that report's date in sources.
