"use client";

import { useId, useState, type FormEvent } from "react";
import { subscribe } from "@/lib/newsletter";

type State = { status: "idle" | "submitting" | "done" } | { status: "error"; message: string };

export function NewsletterForm({
  context = "site",
  compact = false,
}: {
  /** Where the signup happened — sent with the submission. */
  context?: string;
  compact?: boolean;
}) {
  const id = useId();
  const [state, setState] = useState<State>({ status: "idle" });

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const email = String(new FormData(form).get("email") ?? "").trim();
    if (!email) return;
    setState({ status: "submitting" });
    const res = await subscribe(email, { context });
    if (res.ok) {
      setState({ status: "done" });
      form.reset();
    } else {
      setState({ status: "error", message: res.error });
    }
  }

  if (state.status === "done") {
    return (
      <p role="status" className="text-sm text-fg">
        Thank you — you&apos;re on the list. Expect one short email a week, at most.
      </p>
    );
  }

  return (
    <form onSubmit={onSubmit} className="w-full" noValidate={false}>
      <label htmlFor={`${id}-email`} className={compact ? "sr-only" : "mb-2 block text-sm font-medium"}>
        Weekly India energy & carbon briefing
      </label>
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          id={`${id}-email`}
          name="email"
          type="email"
          required
          autoComplete="email"
          placeholder="you@company.in"
          className="min-w-0 flex-1 rounded-full border border-line bg-bg px-5 py-3 text-base placeholder:text-muted/70 focus:border-fg focus:outline-none"
        />
        <button
          type="submit"
          disabled={state.status === "submitting"}
          className="rounded-full bg-fg px-6 py-3 text-sm font-medium text-bg transition-colors hover:bg-accent hover:text-accent-fg disabled:opacity-60"
        >
          {state.status === "submitting" ? "Subscribing…" : "Subscribe"}
        </button>
      </div>
      <p className="mt-2 text-xs text-muted" aria-live="polite">
        {state.status === "error" ? (
          <span className="text-poor">{state.message}</span>
        ) : (
          "CCTS, CBAM, BRSR and energy-price updates that matter to Indian facilities. Unsubscribe any time."
        )}
      </p>
    </form>
  );
}
