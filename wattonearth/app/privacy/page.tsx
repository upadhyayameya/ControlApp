import { Container, SectionHeading } from "@/components/ui/primitives";
import { pageMetadata } from "@/lib/seo";
import { site } from "@/lib/site";

export const metadata = pageMetadata({
  title: "Privacy",
  description: "How Watt on Earth handles the information you share through this website.",
  path: "/privacy",
});

// NOTE: Plain-language notice for Stage 1. Have it reviewed against the
// Digital Personal Data Protection Act, 2023 and its rules before launch.
export default function PrivacyPage() {
  return (
    <Container className="py-20 sm:py-28">
      <SectionHeading as="h1" eyebrow="Privacy" title="Your data, briefly." />
      <div className="prose-woe mt-12 max-w-2xl">
        <h2>Energy &amp; Carbon Check</h2>
        <p>
          The Check runs entirely in your browser. The consumption data you enter or upload is not sent to us or stored
          anywhere — unless you choose to request the full PDF report. In that case we receive your name, email, company
          and phone number, together with the key inputs and results of your Check, so we can follow up.
        </p>
        <h2>Contact and newsletter forms</h2>
        <p>
          Form submissions are delivered to us by our form provider (Formspree). We use them only to reply to you or to
          send the newsletter you asked for. You can unsubscribe or ask us to delete your details at any time by
          emailing <a href={`mailto:${site.email}`}>{site.email}</a>.
        </p>
        <h2>Analytics</h2>
        <p>
          We use Vercel Analytics to count page views. It does not use cookies and does not identify individual visitors.
        </p>
        <h2>We do not</h2>
        <ul>
          <li>sell or share your details with third parties for marketing;</li>
          <li>use advertising trackers.</li>
        </ul>
      </div>
    </Container>
  );
}
