import { unverifiedAssumptions } from "@/data/assumptions";
import { regulations } from "@/lib/regulations";

/** Development-only reminder that placeholder data is still in use. */
export function DevAssumptionsBanner() {
  if (process.env.NODE_ENV !== "development") return null;
  const assumptions = unverifiedAssumptions().length;
  const tracker = regulations.filter((r) => r.dateStatus === "tbc" || !r.lastVerified).length;
  if (assumptions === 0 && tracker === 0) return null;
  return (
    <div role="note" className="bg-warn-bg px-5 py-2 text-center text-xs text-warn-fg">
      <strong>Dev only:</strong> {assumptions} unverified assumption{assumptions === 1 ? "" : "s"} in{" "}
      <code>data/assumptions.ts</code> and {tracker} unverified tracker entr{tracker === 1 ? "y" : "ies"} in{" "}
      <code>data/regulations.json</code>. Run <code>npm run assumptions</code> for the list.
    </div>
  );
}
