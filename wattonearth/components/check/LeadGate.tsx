"use client";

import { useState, type FormEvent } from "react";
import { Button, ButtonLink, Field, inputClass } from "@/components/ui/primitives";
import { facilityLabel, subTypeLabel } from "@/components/check/draft";
import { submitLead } from "@/lib/forms";
import { formatNumber } from "@/lib/format";
import type { CheckInput, CheckResult } from "@/lib/types";

export interface ReportContact {
  name: string;
  email: string;
  company: string;
  phone: string;
}

/** Key inputs and results, flattened for the Formspree notification email. */
export function leadPayload(input: CheckInput, r: CheckResult, isSample: boolean): Record<string, string> {
  return {
    sample_data: isSample ? "yes" : "no",
    facility: input.facilityType === "manufacturing" ? `Manufacturing — ${subTypeLabel(input.manufacturingSubType)}` : facilityLabel(input.facilityType),
    location: `${input.city}, ${input.state} (${input.climateZone})`,
    size:
      input.facilityType === "manufacturing"
        ? `${formatNumber(input.annualProductionTonnes ?? 0)} t/yr`
        : `${formatNumber(input.floorArea ?? 0)} ${input.areaUnit}`,
    rooms: input.rooms ? String(input.rooms) : "",
    exports_to_eu: input.exportsToEU ? "yes" : "no",
    listed_or_supplier: input.listedOrSupplierToListed ? "yes" : "no",
    annual_grid_kwh: formatNumber(r.annualGridKwh),
    annual_bill_inr: r.annualBillInr !== null ? formatNumber(r.annualBillInr) : "not given",
    metric: `${r.metricKind} ${formatNumber(r.metricValue)} ${r.metricUnit}`,
    band: r.band ?? "no benchmark",
    savings_inr_range: `${formatNumber(r.savings.inrLow)} – ${formatNumber(r.savings.inrHigh)}`,
    scope1_tco2e: r.emissions.scope1.toFixed(1),
    scope2_tco2e: r.emissions.scope2.toFixed(1),
    flagged_months: r.monthFlags.map((f) => f.month).join(", ") || "none",
    exposure: r.exposure.map((e) => `${e.regime}: ${e.level}`).join("; "),
    monthly_kwh: input.months.map((m) => `${m.month}=${m.kwh}`).join(" "),
  };
}

type State =
  | { status: "idle" | "submitting" | "generating" }
  | { status: "done"; contact: ReportContact }
  | { status: "error"; message: string };

async function downloadPdf(input: CheckInput, result: CheckResult, contact: ReportContact, isSample: boolean) {
  const { renderCheckReport } = await import("@/components/check/report/renderReport");
  const blob = await renderCheckReport({ input, result, contact, isSample, generatedAt: new Date() });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  const slug = contact.company.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "report";
  a.download = `watt-on-earth-energy-carbon-check-${slug}.pdf`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function LeadGate({ input, result, isSample }: { input: CheckInput; result: CheckResult; isSample: boolean }) {
  const [state, setState] = useState<State>({ status: "idle" });

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const get = (k: string) => String(fd.get(k) ?? "").trim();
    const contact: ReportContact = { name: get("name"), email: get("email"), company: get("company"), phone: get("phone") };
    setState({ status: "submitting" });
    const res = await submitLead({
      source: "check",
      name: contact.name,
      email: contact.email,
      company: contact.company,
      phone: contact.phone,
      city: input.city,
      payload: leadPayload(input, result, isSample),
    });
    if (!res.ok) {
      setState({ status: "error", message: res.error });
      return;
    }
    setState({ status: "generating" });
    try {
      await downloadPdf(input, result, contact, isSample);
      setState({ status: "done", contact });
    } catch (err) {
      console.error(err);
      setState({ status: "error", message: "We couldn't generate the PDF in this browser. We've received your request and will email the report." });
    }
  }

  if (state.status === "done") {
    return (
      <section aria-labelledby="next-h" className="rounded-3xl bg-fg px-6 py-10 text-bg sm:px-10">
        <p className="text-xs font-medium uppercase tracking-[0.2em] opacity-70">Report downloaded</p>
        <h3 id="next-h" className="mt-3 text-3xl font-semibold tracking-tight">
          Turn this estimate into a plan.
        </h3>
        <p className="mt-3 max-w-2xl opacity-80">
          The Remote Energy Audit replaces screening assumptions with your actual data: end-use breakdown, a ranked list of
          measures with ₹ savings and payback, and a Scope 1 &amp; 2 baseline — at a fixed price, without a costly site visit.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <ButtonLink href="/contact?service=remote-energy-audit" className="!bg-bg !text-fg hover:!opacity-90">
            Book the Remote Energy Audit
          </ButtonLink>
          <button
            type="button"
            onClick={() => downloadPdf(input, result, state.contact, isSample)}
            className="rounded-full border border-bg/40 px-6 py-3 text-sm font-medium hover:border-bg"
          >
            Download the PDF again
          </button>
        </div>
      </section>
    );
  }

  const busy = state.status === "submitting" || state.status === "generating";

  return (
    <section aria-labelledby="gate-h" className="rounded-3xl border border-line bg-bg-subtle p-6 sm:p-10">
      <div className="grid gap-10 lg:grid-cols-[1fr_1.3fr]">
        <div>
          <h3 id="gate-h" className="text-2xl font-semibold tracking-tight">
            Get the full PDF report
          </h3>
          <p className="mt-3 text-muted">
            A branded report you can share with your team: every number above plus the monthly data table, measure
            descriptions, the emissions breakdown and the assumptions and sources behind each figure.
          </p>
        </div>
        <form onSubmit={onSubmit} className="grid gap-4 sm:grid-cols-2">
          <Field label="Name" htmlFor="lg-name" required>
            <input id="lg-name" name="name" required autoComplete="name" className={inputClass} />
          </Field>
          <Field label="Work email" htmlFor="lg-email" required>
            <input id="lg-email" name="email" type="email" required autoComplete="email" className={inputClass} />
          </Field>
          <Field label="Company" htmlFor="lg-company" required>
            <input id="lg-company" name="company" required autoComplete="organization" className={inputClass} />
          </Field>
          <Field label="Phone" htmlFor="lg-phone" required>
            <input
              id="lg-phone"
              name="phone"
              type="tel"
              required
              autoComplete="tel"
              placeholder="+91 98xxx xxxxx"
              pattern="\+?[0-9][0-9 \-]{7,18}"
              className={inputClass}
            />
          </Field>
          <div className="sm:col-span-2">
            <Button type="submit" disabled={busy}>
              {state.status === "submitting" ? "Sending…" : state.status === "generating" ? "Preparing PDF…" : "Unlock the PDF report"}
            </Button>
            <p className="mt-3 text-xs text-muted" aria-live="polite">
              {state.status === "error" ? (
                <span className="text-poor">{state.message}</span>
              ) : (
                <>
                  We&apos;ll send your details with the key inputs and results of this Check so we can follow up. See our{" "}
                  <a href="/privacy" className="underline">privacy notice</a>.
                </>
              )}
            </p>
          </div>
        </form>
      </div>
    </section>
  );
}
