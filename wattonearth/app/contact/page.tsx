import { Suspense } from "react";
import { ContactForm } from "@/components/forms/ContactForm";
import { Container, SectionHeading } from "@/components/ui/primitives";
import { pageMetadata } from "@/lib/seo";
import { site } from "@/lib/site";

export const metadata = pageMetadata({
  title: "Contact",
  description: "Tell us about your facility. We reply within two working days.",
  path: "/contact",
});

export default function ContactPage() {
  return (
    <Container className="py-20 sm:py-28">
      <div className="grid gap-16 lg:grid-cols-[1fr_1.4fr]">
        <div>
          <SectionHeading
            as="h1"
            eyebrow="Contact"
            title="Let's look at your numbers."
            lead="Tell us a little about your facility. We'll reply within two working days with next steps — usually a short call and a list of the data we'd need."
          />
          <p className="mt-10 text-sm text-muted">
            Prefer email?{" "}
            <a href={`mailto:${site.email}`} className="text-fg underline underline-offset-4">
              {site.email}
            </a>
          </p>
        </div>
        <Suspense fallback={null}>
          <ContactForm />
        </Suspense>
      </div>
    </Container>
  );
}
