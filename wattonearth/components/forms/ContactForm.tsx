"use client";

import { useSearchParams } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Button, Field, inputClass } from "@/components/ui/primitives";
import { services } from "@/data/services";
import { submitLead } from "@/lib/forms";

export const SECTORS = [
  "Hotel / hospitality",
  "Office / commercial",
  "Hospital / healthcare",
  "Mall / retail",
  "Manufacturing",
  "Exporter",
  "Other",
] as const;

type State = { status: "idle" | "submitting" | "done" } | { status: "error"; message: string };

/** Reads ?service= to pre-fill the message. Wrap in <Suspense fallback={<ContactForm />}>. */
export function ContactFormWithParams() {
  const serviceSlug = useSearchParams().get("service");
  return <ContactForm key={serviceSlug ?? ""} serviceSlug={serviceSlug} />;
}

export function ContactForm({ serviceSlug = null }: { serviceSlug?: string | null }) {
  const service = services.find((s) => s.slug === serviceSlug);
  const [state, setState] = useState<State>({ status: "idle" });

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const get = (k: string) => String(fd.get(k) ?? "").trim();
    setState({ status: "submitting" });
    const res = await submitLead({
      source: "contact",
      name: get("name"),
      email: get("email"),
      phone: get("phone") || undefined,
      company: get("company"),
      sector: get("sector"),
      city: get("city"),
      message: get("message"),
      payload: service ? { service: service.name } : undefined,
    });
    setState(res.ok ? { status: "done" } : { status: "error", message: res.error });
  }

  if (state.status === "done") {
    return (
      <div role="status" className="rounded-2xl border border-line p-8">
        <h2 className="text-2xl font-semibold">Thank you — message received.</h2>
        <p className="mt-3 text-muted">We reply to every enquiry within two working days (IST).</p>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="grid gap-5 sm:grid-cols-2">
      <Field label="Name" htmlFor="c-name" required>
        <input id="c-name" name="name" required autoComplete="name" className={inputClass} />
      </Field>
      <Field label="Work email" htmlFor="c-email" required>
        <input id="c-email" name="email" type="email" required autoComplete="email" className={inputClass} />
      </Field>
      <Field label="Company" htmlFor="c-company" required>
        <input id="c-company" name="company" required autoComplete="organization" className={inputClass} />
      </Field>
      <Field label="Phone" htmlFor="c-phone" hint="Optional — include country code if outside India.">
        <input id="c-phone" name="phone" type="tel" autoComplete="tel" placeholder="+91" className={inputClass} />
      </Field>
      <Field label="Sector" htmlFor="c-sector" required>
        <select id="c-sector" name="sector" required defaultValue="" className={inputClass}>
          <option value="" disabled>
            Select…
          </option>
          {SECTORS.map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
      </Field>
      <Field label="City" htmlFor="c-city" required>
        <input id="c-city" name="city" required autoComplete="address-level2" placeholder="e.g. Pune" className={inputClass} />
      </Field>
      <Field label="Message" htmlFor="c-message" required className="sm:col-span-2">
        <textarea
          id="c-message"
          name="message"
          required
          rows={5}
          defaultValue={service ? `I'm interested in the ${service.name}. ` : ""}
          placeholder="Tell us about your facility and what you'd like to achieve."
          className={inputClass}
        />
      </Field>
      <div className="sm:col-span-2">
        <Button type="submit" disabled={state.status === "submitting"}>
          {state.status === "submitting" ? "Sending…" : "Send message"}
        </Button>
        <p className="mt-3 text-xs text-muted" aria-live="polite">
          {state.status === "error" ? (
            <span className="text-poor">{state.message}</span>
          ) : (
            <>
              We use your details only to reply to this enquiry. See our <a href="/privacy" className="underline">privacy notice</a>.
            </>
          )}
        </p>
      </div>
    </form>
  );
}
