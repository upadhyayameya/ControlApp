import { useId } from "react";

/**
 * Watt on Earth mark: a globe drawn as one continuous line — outline, a
 * meridian, and a lightning bolt that doubles as the second meridian.
 *
 * `animated` draws the stroke on load; the animation is disabled for users
 * with `prefers-reduced-motion` (see `.logo-draw` in globals.css).
 */
export const LOGO_PATH =
  "M32 6 A26 26 0 1 0 58 32 A26 26 0 0 0 32 6 A11 26 0 0 0 32 58 L38 30.5 L26 33.5 L32 6";

interface LogoProps {
  animated?: boolean;
  size?: number;
  withWordmark?: boolean;
  className?: string;
  /** Accessible name; pass `""` when the logo sits next to visible text. */
  title?: string;
}

export function Logo({
  animated = false,
  size = 32,
  withWordmark = false,
  className,
  title = "Watt on Earth",
}: LogoProps) {
  const gradientId = `woe-logo-${useId().replace(/:/g, "")}`;
  const decorative = title === "";

  return (
    <span className={`inline-flex items-center gap-2.5 ${className ?? ""}`}>
      <svg
        width={size}
        height={size}
        viewBox="0 0 64 64"
        fill="none"
        role={decorative ? undefined : "img"}
        aria-hidden={decorative ? true : undefined}
        aria-label={decorative ? undefined : title}
        focusable="false"
      >
        <defs>
          <linearGradient id={gradientId} x1="8" y1="6" x2="56" y2="58" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="var(--logo-stroke)" />
            <stop offset="1" stopColor="var(--logo-bolt)" />
          </linearGradient>
        </defs>
        <path
          d={LOGO_PATH}
          pathLength={1}
          stroke={`url(#${gradientId})`}
          strokeWidth={3}
          strokeLinecap="round"
          strokeLinejoin="round"
          className={animated ? "logo-draw" : undefined}
        />
      </svg>
      {withWordmark && (
        <span className="text-[15px] font-semibold tracking-[0.18em] uppercase">Watt on Earth</span>
      )}
    </span>
  );
}
