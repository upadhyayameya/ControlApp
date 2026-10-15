"use client";

import { useEffect, useRef, useState, type ChangeEvent, type ReactNode } from "react";
import { Button, Field, inputClass } from "@/components/ui/primitives";
import { climateZoneLabels, states, suggestZone } from "@/data/climate";
import { SAMPLE_CSV_PATH, TEMPLATE_CSV_PATH } from "@/data/sample";
import { runCheck } from "@/lib/check/calc";
import { parseConsumptionCsv } from "@/lib/check/csv";
import { formatMonth, formatNumber } from "@/lib/format";
import type { CheckInput, CheckResult, ClimateZone } from "@/lib/types";
import { CheckResults } from "@/components/check/CheckResults";
import {
  draftToInput,
  emptyDraft,
  facilityOptions,
  monthsFrom,
  sampleDraft,
  subTypeOptions,
  validateStep,
  type CheckDraft,
} from "@/components/check/draft";

const STEPS = ["Facility", "Location", "Electricity", "Other energy & business"] as const;

export function CheckTool() {
  const [draft, setDraft] = useState<CheckDraft>(emptyDraft);
  const [step, setStep] = useState(0);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [outcome, setOutcome] = useState<{ input: CheckInput; result: CheckResult } | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const firstRender = useRef(true);

  // Move focus to the step heading on navigation (not on first load).
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    headingRef.current?.focus();
  }, [step, outcome]);

  const set = <K extends keyof CheckDraft>(key: K, value: CheckDraft[K]) =>
    setDraft((d) => {
      const next = { ...d, [key]: value, isSample: key === "isSample" ? (value as boolean) : false };
      if ((key === "state" || key === "city") && !next.zoneTouched && next.state) {
        next.climateZone = suggestZone(next.state, next.city);
      }
      return next;
    });

  function next() {
    const e = validateStep(draft, step);
    setErrors(e);
    if (Object.keys(e).length) {
      const first = Object.keys(e)[0];
      requestAnimationFrame(() => document.getElementById(`chk-${first}`)?.focus());
      return;
    }
    if (step < STEPS.length - 1) {
      setStep(step + 1);
      return;
    }
    try {
      const input = draftToInput(draft);
      setOutcome({ input, result: runCheck(input) });
      setRunError(null);
    } catch (err) {
      setRunError(err instanceof Error ? err.message : "Something went wrong.");
    }
  }

  async function loadSample() {
    const res = await fetch(SAMPLE_CSV_PATH);
    const { readings } = parseConsumptionCsv(await res.text());
    const d = sampleDraft(readings);
    setDraft(d);
    setErrors({});
    const input = draftToInput(d);
    setOutcome({ input, result: runCheck(input) });
  }

  if (outcome) {
    return (
      <div>
        <h2 ref={headingRef} tabIndex={-1} className="sr-only">
          Your results
        </h2>
        <CheckResults
          input={outcome.input}
          result={outcome.result}
          isSample={draft.isSample}
          onEdit={() => {
            setOutcome(null);
            setStep(0);
          }}
        />
      </div>
    );
  }

  const err = (k: string) => errors[k];
  const invalid = (k: string) => (errors[k] ? true : undefined);
  const describedBy = (k: string) => (errors[k] ? `chk-${k}-err` : undefined);

  return (
    <div className="grid gap-10 lg:grid-cols-[220px_1fr]">
      {/* Progress */}
      <nav aria-label="Check progress">
        <ol className="flex gap-2 overflow-x-auto lg:flex-col lg:gap-1">
          {STEPS.map((s, i) => (
            <li key={s} className="shrink-0">
              <button
                type="button"
                onClick={() => i < step && setStep(i)}
                disabled={i > step}
                aria-current={i === step ? "step" : undefined}
                className={`flex items-center gap-3 rounded-lg px-3 py-2 text-left text-sm ${
                  i === step ? "bg-bg-subtle font-medium text-fg" : i < step ? "text-fg hover:bg-bg-subtle" : "text-muted"
                }`}
              >
                <span
                  className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-xs ${
                    i <= step ? "border-fg" : "border-line"
                  }`}
                >
                  {i < step ? "✓" : i + 1}
                </span>
                <span className="hidden sm:inline">{s}</span>
              </button>
            </li>
          ))}
        </ol>
        <div className="mt-8 hidden rounded-xl border border-line p-4 text-sm lg:block">
          <p className="font-medium">Just exploring?</p>
          <p className="mt-1 text-muted">See the tool with a fictional 180-key Mumbai hotel.</p>
          <button type="button" onClick={loadSample} className="mt-3 font-medium underline underline-offset-4">
            Load sample data
          </button>
        </div>
      </nav>

      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          next();
        }}
        className="min-w-0"
      >
        <p className="text-sm text-muted">
          Step {step + 1} of {STEPS.length}
        </p>
        <h2 ref={headingRef} tabIndex={-1} className="mt-1 text-2xl font-semibold tracking-tight focus:outline-none">
          {STEPS[step]}
        </h2>

        <div className="mt-8 space-y-6">
          {step === 0 && (
            <>
              <fieldset>
                <legend className="mb-3 text-sm font-medium">
                  Facility type <span className="text-accent" aria-hidden="true">*</span>
                </legend>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3" role="radiogroup" aria-describedby={describedBy("facilityType")}>
                  {facilityOptions.map((f, i) => (
                    <label
                      key={f.value}
                      className={`flex cursor-pointer items-center gap-3 rounded-xl border px-4 py-3 text-sm has-[:focus-visible]:outline has-[:focus-visible]:outline-2 ${
                        draft.facilityType === f.value ? "border-fg bg-bg-subtle" : "border-line hover:border-muted"
                      }`}
                    >
                      <input
                        id={i === 0 ? "chk-facilityType" : undefined}
                        type="radio"
                        name="facilityType"
                        value={f.value}
                        checked={draft.facilityType === f.value}
                        onChange={() => set("facilityType", f.value)}
                        className="accent-[var(--accent)]"
                      />
                      {f.label}
                    </label>
                  ))}
                </div>
                <ErrorText id="chk-facilityType-err" msg={err("facilityType")} />
              </fieldset>

              {draft.facilityType === "manufacturing" && (
                <>
                  <Field label="Sub-sector" htmlFor="chk-manufacturingSubType" required>
                    <select
                      id="chk-manufacturingSubType"
                      value={draft.manufacturingSubType}
                      onChange={(e) => set("manufacturingSubType", e.target.value as CheckDraft["manufacturingSubType"])}
                      className={inputClass}
                      aria-invalid={invalid("manufacturingSubType")}
                      aria-describedby={describedBy("manufacturingSubType")}
                    >
                      <option value="">Select…</option>
                      {subTypeOptions.map((s) => (
                        <option key={s.value} value={s.value}>
                          {s.label}
                        </option>
                      ))}
                    </select>
                    <ErrorText id="chk-manufacturingSubType-err" msg={err("manufacturingSubType")} />
                  </Field>
                  <NumberField
                    id="annualProductionTonnes"
                    label="Annual production"
                    suffix="tonnes/yr"
                    required
                    value={draft.annualProductionTonnes}
                    onChange={(v) => set("annualProductionTonnes", v)}
                    error={err("annualProductionTonnes")}
                    hint="Total saleable output for the same 12 months as your electricity data."
                  />
                </>
              )}

              {draft.facilityType && draft.facilityType !== "manufacturing" && (
                <div>
                  <NumberField
                    id="floorArea"
                    label="Built-up floor area"
                    suffix={draft.areaUnit === "m2" ? "m²" : "ft²"}
                    required
                    value={draft.floorArea}
                    onChange={(v) => set("floorArea", v)}
                    error={err("floorArea")}
                    hint="Conditioned plus non-conditioned built-up area, excluding open parking."
                  />
                  <fieldset className="mt-3 flex items-center gap-2 text-sm">
                    <legend className="sr-only">Area unit</legend>
                    {(["m2", "ft2"] as const).map((u) => (
                      <label
                        key={u}
                        className={`cursor-pointer rounded-full border px-3 py-1 has-[:focus-visible]:outline has-[:focus-visible]:outline-2 ${
                          draft.areaUnit === u ? "border-fg bg-bg-subtle" : "border-line"
                        }`}
                      >
                        <input
                          type="radio"
                          name="areaUnit"
                          value={u}
                          checked={draft.areaUnit === u}
                          onChange={() => set("areaUnit", u)}
                          className="sr-only"
                        />
                        {u === "m2" ? "m²" : "ft²"}
                      </label>
                    ))}
                  </fieldset>
                </div>
              )}

              {draft.facilityType === "hotel" && (
                <NumberField
                  id="rooms"
                  label="Number of rooms (keys)"
                  required
                  value={draft.rooms}
                  onChange={(v) => set("rooms", v)}
                  error={err("rooms")}
                />
              )}
            </>
          )}

          {step === 1 && (
            <>
              <Field label="State / UT" htmlFor="chk-state" required>
                <select
                  id="chk-state"
                  value={draft.state}
                  onChange={(e) => set("state", e.target.value)}
                  className={inputClass}
                  aria-invalid={invalid("state")}
                  aria-describedby={describedBy("state")}
                  autoComplete="address-level1"
                >
                  <option value="">Select…</option>
                  {states.map((s) => (
                    <option key={s}>{s}</option>
                  ))}
                </select>
                <ErrorText id="chk-state-err" msg={err("state")} />
              </Field>
              <Field label="City" htmlFor="chk-city" required>
                <input
                  id="chk-city"
                  value={draft.city}
                  onChange={(e) => set("city", e.target.value)}
                  placeholder="e.g. Chennai"
                  className={inputClass}
                  autoComplete="address-level2"
                  aria-invalid={invalid("city")}
                  aria-describedby={describedBy("city")}
                />
                <ErrorText id="chk-city-err" msg={err("city")} />
              </Field>
              <Field
                label="Climate zone"
                htmlFor="chk-climateZone"
                required
                hint="Suggested from your state and city using the ECBC climate zones. Change it if you know better."
              >
                <select
                  id="chk-climateZone"
                  value={draft.climateZone}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, climateZone: e.target.value as ClimateZone, zoneTouched: true, isSample: false }))
                  }
                  className={inputClass}
                  aria-invalid={invalid("climateZone")}
                  aria-describedby={describedBy("climateZone")}
                >
                  <option value="">Select…</option>
                  {Object.entries(climateZoneLabels).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
                <ErrorText id="chk-climateZone-err" msg={err("climateZone")} />
              </Field>
            </>
          )}

          {step === 2 && <ElectricityStep draft={draft} setDraft={setDraft} errors={errors} />}

          {step === 3 && (
            <>
              <p className="text-sm text-muted">Annual totals for the same 12 months. Leave blank if not applicable.</p>
              <div className="grid gap-6 sm:grid-cols-2">
                <NumberField id="dieselLitres" label="Diesel (HSD)" suffix="litres/yr" value={draft.dieselLitres} onChange={(v) => set("dieselLitres", v)} error={err("dieselLitres")} hint="Assumed to run DG sets." />
                <NumberField id="lpgKg" label="LPG" suffix="kg/yr" value={draft.lpgKg} onChange={(v) => set("lpgKg", v)} error={err("lpgKg")} hint="A 19 kg commercial cylinder = 19 kg." />
                <NumberField id="pngScm" label="PNG / natural gas" suffix="SCM/yr" value={draft.pngScm} onChange={(v) => set("pngScm", v)} error={err("pngScm")} />
                <NumberField id="solarKwh" label="Solar / on-site generation" suffix="kWh/yr" value={draft.solarKwh} onChange={(v) => set("solarKwh", v)} error={err("solarKwh")} hint="Self-consumed generation, not exported units." />
              </div>
              <YesNo id="exportsToEU" legend="Do you export to the European Union?" value={draft.exportsToEU} onChange={(v) => set("exportsToEU", v)} error={err("exportsToEU")} />
              <YesNo id="listed" legend="Are you a listed company, or a supplier to one?" value={draft.listed} onChange={(v) => set("listed", v)} error={err("listed")} />
            </>
          )}
        </div>

        {runError && (
          <p role="alert" className="mt-6 text-sm text-poor">
            {runError}
          </p>
        )}
        {Object.keys(errors).length > 0 && (
          <p role="alert" className="mt-6 text-sm text-poor">
            Please fix the {Object.keys(errors).length === 1 ? "highlighted field" : `${Object.keys(errors).length} highlighted fields`}.
          </p>
        )}

        <div className="mt-10 flex flex-wrap items-center gap-3 border-t border-line pt-6">
          {step > 0 && (
            <Button type="button" variant="secondary" onClick={() => { setErrors({}); setStep(step - 1); }}>
              Back
            </Button>
          )}
          <Button type="submit">{step === STEPS.length - 1 ? "See my results" : "Continue"}</Button>
          <button type="button" onClick={loadSample} className="ml-auto text-sm underline underline-offset-4 lg:hidden">
            Load sample data
          </button>
        </div>
        <p className="mt-4 text-xs text-muted">
          Nothing you enter here leaves your browser unless you request the PDF report. The sample data is fictional.
        </p>
      </form>
    </div>
  );
}

function ErrorText({ id, msg }: { id: string; msg?: string }) {
  if (!msg) return null;
  return (
    <p id={id} className="mt-1.5 text-sm text-poor">
      {msg}
    </p>
  );
}

function NumberField({
  id,
  label,
  suffix,
  value,
  onChange,
  error,
  hint,
  required,
}: {
  id: string;
  label: string;
  suffix?: string;
  value: string;
  onChange: (v: string) => void;
  error?: string;
  hint?: ReactNode;
  required?: boolean;
}) {
  const fid = `chk-${id}`;
  return (
    <Field label={label} htmlFor={fid} required={required} hint={error ? undefined : hint}>
      <div className="relative">
        <input
          id={fid}
          inputMode="decimal"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={`${inputClass} ${suffix ? "pr-24" : ""}`}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${fid}-err` : undefined}
          autoComplete="off"
        />
        {suffix && (
          <span className="pointer-events-none absolute inset-y-0 right-4 flex items-center text-sm text-muted">{suffix}</span>
        )}
      </div>
      <ErrorText id={`${fid}-err`} msg={error} />
    </Field>
  );
}

function YesNo({
  id,
  legend,
  value,
  onChange,
  error,
}: {
  id: string;
  legend: string;
  value: "" | "yes" | "no";
  onChange: (v: "yes" | "no") => void;
  error?: string;
}) {
  return (
    <fieldset aria-describedby={error ? `chk-${id}-err` : undefined}>
      <legend className="mb-2 text-sm font-medium">
        {legend} <span className="text-accent" aria-hidden="true">*</span>
      </legend>
      <div className="flex gap-2">
        {(["yes", "no"] as const).map((v, i) => (
          <label
            key={v}
            className={`flex cursor-pointer items-center gap-2 rounded-full border px-5 py-2 text-sm has-[:focus-visible]:outline has-[:focus-visible]:outline-2 ${
              value === v ? "border-fg bg-bg-subtle" : "border-line"
            }`}
          >
            <input
              id={i === 0 ? `chk-${id}` : undefined}
              type="radio"
              name={id}
              value={v}
              checked={value === v}
              onChange={() => onChange(v)}
              className="accent-[var(--accent)]"
            />
            {v === "yes" ? "Yes" : "No"}
          </label>
        ))}
      </div>
      <ErrorText id={`chk-${id}-err`} msg={error} />
    </fieldset>
  );
}

function ElectricityStep({
  draft,
  setDraft,
  errors,
}: {
  draft: CheckDraft;
  setDraft: (fn: (d: CheckDraft) => CheckDraft) => void;
  errors: Record<string, string>;
}) {
  const [csvMsg, setCsvMsg] = useState<{ kind: "ok" | "error"; lines: string[] } | null>(null);
  const months = monthsFrom(draft.startMonth);
  const total = draft.kwh.reduce((s, v) => s + (Number(v.replace(/,/g, "")) || 0), 0);

  async function onFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (file.size > 200_000) {
      setCsvMsg({ kind: "error", lines: ["That file is too large for a 12-month CSV."] });
      return;
    }
    const { readings, errors: errs, warnings } = parseConsumptionCsv(await file.text());
    if (errs.length) {
      setCsvMsg({ kind: "error", lines: errs.slice(0, 5) });
      return;
    }
    setDraft((d) => ({
      ...d,
      isSample: false,
      startMonth: readings[0].month,
      kwh: readings.map((r) => String(r.kwh)),
      amount: readings.map((r) => (r.amountInr === null ? "" : String(r.amountInr))),
    }));
    setCsvMsg({ kind: "ok", lines: [`Loaded ${readings.length} months from ${file.name}.`, ...warnings] });
  }

  const setCell = (key: "kwh" | "amount", i: number, v: string) =>
    setDraft((d) => {
      const arr = [...d[key]];
      arr[i] = v;
      return { ...d, [key]: arr, isSample: false };
    });

  return (
    <>
      <div className="rounded-xl border border-dashed border-line p-5">
        <p className="text-sm font-medium">Upload a CSV</p>
        <p className="mt-1 text-sm text-muted">
          Columns: <code className="font-mono">month, kwh, amount_inr</code>.{" "}
          <a href={TEMPLATE_CSV_PATH} download className="underline underline-offset-4">
            Download the template
          </a>{" "}
          or the{" "}
          <a href={SAMPLE_CSV_PATH} download className="underline underline-offset-4">
            sample file
          </a>
          .
        </p>
        <label className="mt-4 inline-flex cursor-pointer items-center rounded-full border border-line px-4 py-2 text-sm font-medium hover:border-fg has-[:focus-visible]:outline has-[:focus-visible]:outline-2">
          Choose CSV file
          <input type="file" accept=".csv,text/csv" onChange={onFile} className="sr-only" />
        </label>
        {csvMsg && (
          <ul role={csvMsg.kind === "error" ? "alert" : "status"} className={`mt-3 space-y-1 text-sm ${csvMsg.kind === "error" ? "text-poor" : "text-fg"}`}>
            {csvMsg.lines.map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
        )}
      </div>

      <div className="flex flex-wrap items-end gap-4">
        <Field label="First month" htmlFor="chk-startMonth" hint="12 consecutive months from here.">
          <input
            id="chk-startMonth"
            type="month"
            value={draft.startMonth}
            onChange={(e) => e.target.value && setDraft((d) => ({ ...d, startMonth: e.target.value, isSample: false }))}
            className={inputClass}
          />
        </Field>
        <p className="pb-8 text-sm text-muted">
          Total: <span className="font-medium text-fg">{formatNumber(total)} kWh</span>
        </p>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[420px] text-sm">
          <caption className="sr-only">Monthly grid electricity and bill amounts</caption>
          <thead>
            <tr className="text-left text-muted">
              <th scope="col" className="pb-2 font-medium">Month</th>
              <th scope="col" className="pb-2 font-medium">Grid electricity (kWh) *</th>
              <th scope="col" className="pb-2 font-medium">Bill amount (₹)</th>
            </tr>
          </thead>
          <tbody>
            {months.map((m, i) => (
              <tr key={m}>
                <th scope="row" className="py-1 pr-3 text-left font-normal">{formatMonth(m)}</th>
                <td className="py-1 pr-3">
                  <input
                    id={`chk-kwh-${i}`}
                    aria-label={`${formatMonth(m)} kWh`}
                    inputMode="decimal"
                    value={draft.kwh[i]}
                    onChange={(e) => setCell("kwh", i, e.target.value)}
                    aria-invalid={errors[`kwh-${i}`] ? true : undefined}
                    className={`${inputClass} py-2`}
                  />
                </td>
                <td className="py-1">
                  <input
                    id={`chk-amount-${i}`}
                    aria-label={`${formatMonth(m)} bill amount in rupees`}
                    inputMode="decimal"
                    value={draft.amount[i]}
                    onChange={(e) => setCell("amount", i, e.target.value)}
                    aria-invalid={errors[`amount-${i}`] ? true : undefined}
                    className={`${inputClass} py-2`}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
