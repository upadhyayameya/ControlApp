import Link from "next/link";
import { Logo } from "@/components/Logo";
import { NewsletterForm } from "@/components/forms/NewsletterForm";
import { services } from "@/data/services";
import { disclaimer, site } from "@/lib/site";

export function Footer() {
  const year = new Date().getFullYear();
  return (
    <footer className="mt-24 border-t border-line">
      <div className="mx-auto grid max-w-6xl gap-12 px-5 py-16 sm:px-8 lg:grid-cols-[1.3fr_1fr_1fr]">
        <div>
          <Logo size={36} withWordmark title="" />
          <p className="mt-4 max-w-sm text-sm leading-relaxed text-muted">
            Energy and carbon advisory for Indian buildings and manufacturers. {site.tagline}
          </p>
          <div className="mt-8 max-w-md">
            <NewsletterForm context="footer" />
          </div>
        </div>

        <nav aria-label="Services">
          <h2 className="text-sm font-medium">Services</h2>
          <ul className="mt-4 space-y-3 text-sm text-muted">
            {services.map((s) => (
              <li key={s.slug}>
                <Link href={`/services/${s.slug}`} className="hover:text-fg">
                  {s.shortName}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        <nav aria-label="Company">
          <h2 className="text-sm font-medium">Company</h2>
          <ul className="mt-4 space-y-3 text-sm text-muted">
            <li><Link href="/check" className="hover:text-fg">Energy &amp; Carbon Check</Link></li>
            <li><Link href="/tracker" className="hover:text-fg">Regulation Tracker</Link></li>
            <li><Link href="/news" className="hover:text-fg">News</Link></li>
            <li><Link href="/about" className="hover:text-fg">About</Link></li>
            <li><Link href="/contact" className="hover:text-fg">Contact</Link></li>
            <li><Link href="/privacy" className="hover:text-fg">Privacy</Link></li>
            <li><a href="/news/rss.xml" className="hover:text-fg">RSS</a></li>
          </ul>
        </nav>
      </div>
      <div className="border-t border-line">
        <div className="mx-auto max-w-6xl px-5 py-8 text-xs leading-relaxed text-muted sm:px-8">
          <p className="max-w-4xl">{disclaimer}</p>
          <p className="mt-4">
            © {year} {site.name} · {site.domain}
          </p>
        </div>
      </div>
    </footer>
  );
}
