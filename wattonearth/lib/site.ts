/** Site-wide configuration. Change contact details here, not in components. */
export const site = {
  name: "Watt on Earth",
  domain: "wattonearth.in",
  url: (process.env.NEXT_PUBLIC_SITE_URL ?? "https://wattonearth.in").replace(/\/$/, ""),
  tagline: "Measure. Reduce. Verify.",
  description:
    "Energy and carbon advisory for Indian commercial buildings, hotels and manufacturers. Remote energy audits, monitoring & verification, and readiness for CCTS, CBAM, BRSR and ECBC.",
  founder: "Ameya",
  /** PLACEHOLDER — replace with the real inbox before launch. */
  email: "hello@wattonearth.in",
  locale: "en_IN",
  nav: [
    { href: "/services", label: "Services" },
    { href: "/check", label: "Energy & Carbon Check" },
    { href: "/tracker", label: "Regulation Tracker" },
    { href: "/news", label: "News" },
    { href: "/about", label: "About" },
  ],
} as const;

export const disclaimer =
  "Watt on Earth provides engineering and advisory services. Content on this site, including the Energy & Carbon Check, is general information and screening-level estimation — not legal advice, not an energy audit and not a verified emissions statement. Always confirm regulatory obligations against the official notification.";

export function absoluteUrl(path = "/"): string {
  return `${site.url}${path.startsWith("/") ? path : `/${path}`}`;
}
