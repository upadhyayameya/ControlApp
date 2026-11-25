import type { CSSProperties } from "react";
import { MARK, WORDMARK } from "@/components/brand/paths";

/**
 * Watt on Earth logo: the one-line globe with a lightning bolt, optionally
 * with the "WATT ON EARTH" wordmark. Traced from the supplied artwork
 * (docs/brand/logo-reference.png); vector sources are in /public/brand.
 *
 * The artwork is applied as a CSS mask so it takes the theme's `--logo-ink`
 * colour and adds no path data to the HTML. `animated` reveals the mark on
 * load; the animation is off for `prefers-reduced-motion` (see globals.css).
 */
interface LogoProps {
  animated?: boolean;
  /** Height of the globe mark in px. */
  size?: number;
  withWordmark?: boolean;
  className?: string;
  /** Accessible name; pass `""` when a parent already names the logo. */
  title?: string;
}

const maskStyle = (src: string, width: number, ratio: number): CSSProperties => ({
  width,
  maxWidth: "100%",
  aspectRatio: ratio,
  backgroundColor: "var(--logo-ink)",
  WebkitMask: `url(${src}) center / contain no-repeat`,
  mask: `url(${src}) center / contain no-repeat`,
});

export function Logo({ animated = false, size = 32, withWordmark = false, className, title = "Watt on Earth" }: LogoProps) {
  const markW = Math.round((size * MARK.width) / MARK.height);
  // Wordmark cap height ≈ 45% of the mark, as in the supplied lockup at small sizes.
  const wordH = Math.max(10, Math.round(size * 0.42));
  const wordW = Math.round((wordH * WORDMARK.width) / WORDMARK.height);

  return (
    <span
      className={`inline-flex items-center gap-3 ${className ?? ""}`}
      role={title ? "img" : undefined}
      aria-label={title || undefined}
      aria-hidden={title ? undefined : true}
    >
      <span
        className={`block shrink-0 ${animated ? "logo-reveal" : ""}`}
        style={maskStyle("/brand/mark.svg", markW, MARK.width / MARK.height)}
      />
      {withWordmark && <span className="block shrink-0" style={maskStyle("/brand/wordmark.svg", wordW, WORDMARK.width / WORDMARK.height)} />}
    </span>
  );
}
