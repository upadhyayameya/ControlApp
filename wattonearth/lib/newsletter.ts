/**
 * Newsletter provider abstraction. Stage 1 uses Formspree (type: newsletter).
 * To move to Buttondown or Resend, add a provider below and change
 * `activeProvider` — `<NewsletterForm />` only calls `subscribe()`.
 */
import { submitLead, type SubmitResult } from "@/lib/forms";

interface NewsletterProvider {
  name: string;
  subscribe(email: string, meta?: Record<string, string>): Promise<SubmitResult>;
}

const formspreeProvider: NewsletterProvider = {
  name: "formspree",
  subscribe: (email, meta) =>
    submitLead({ source: "newsletter", email, payload: { ...meta } }),
};

// Example for later:
// const buttondownProvider: NewsletterProvider = {
//   name: "buttondown",
//   subscribe: (email) => fetch("/api/newsletter", { method: "POST", body: JSON.stringify({ email }) })...
// };

const activeProvider: NewsletterProvider = formspreeProvider;

export function subscribe(email: string, meta?: Record<string, string>): Promise<SubmitResult> {
  return activeProvider.subscribe(email, meta);
}
