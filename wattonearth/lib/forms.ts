/**
 * Lead submission. Stage 1 posts to Formspree; swap the implementation of
 * `submitLead` (e.g. to a Supabase insert or an API route) without touching
 * the form components.
 */
import type { Lead } from "@/lib/types";

export type SubmitResult =
  | { ok: true; skipped?: boolean }
  | { ok: false; error: string };

const FORMSPREE_ID = process.env.NEXT_PUBLIC_FORMSPREE_ID;

export function isFormConfigured(): boolean {
  return Boolean(FORMSPREE_ID);
}

/** Flattens nested payloads into strings so they read well in Formspree emails. */
function flatten(lead: Lead): Record<string, string> {
  const out: Record<string, string> = { type: lead.source };
  for (const [key, value] of Object.entries(lead)) {
    if (value === undefined || value === null || key === "payload" || key === "source") continue;
    out[key] = String(value);
  }
  if (lead.email) out._replyto = lead.email;
  if (lead.payload) {
    for (const [key, value] of Object.entries(lead.payload)) {
      out[key] = typeof value === "string" ? value : JSON.stringify(value);
    }
  }
  out._subject = `[Watt on Earth] New ${lead.source} lead${lead.company ? ` — ${lead.company}` : ""}`;
  return out;
}

export async function submitLead(lead: Lead): Promise<SubmitResult> {
  if (!FORMSPREE_ID) {
    if (process.env.NODE_ENV !== "production") {
      console.warn("[forms] NEXT_PUBLIC_FORMSPREE_ID is not set — submission skipped (dev only).", flatten(lead));
      return { ok: true, skipped: true };
    }
    return {
      ok: false,
      error: "Our form is temporarily unavailable. Please email us instead.",
    };
  }
  try {
    const res = await fetch(`https://formspree.io/f/${FORMSPREE_ID}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(flatten(lead)),
    });
    if (res.ok) return { ok: true };
    const data: unknown = await res.json().catch(() => null);
    const message =
      data && typeof data === "object" && "errors" in data && Array.isArray(data.errors)
        ? data.errors.map((e: { message?: string }) => e.message).filter(Boolean).join(", ")
        : "";
    return { ok: false, error: message || "Something went wrong. Please try again." };
  } catch {
    return { ok: false, error: "Network error. Please check your connection and try again." };
  }
}
