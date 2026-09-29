"use client";

import { useTheme } from "next-themes";
import { useSyncExternalStore } from "react";

const noopSubscribe = () => () => {};

export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  // True only on the client, so the icon never mismatches the server render.
  const mounted = useSyncExternalStore(noopSubscribe, () => true, () => false);
  const isDark = mounted && resolvedTheme === "dark";
  const label = mounted ? `Switch to ${isDark ? "light" : "dark"} theme` : "Toggle theme";

  return (
    <button
      type="button"
      onClick={() => setTheme(isDark ? "light" : "dark")}
      aria-label={label}
      title={label}
      className="inline-flex h-9 w-9 items-center justify-center rounded-full text-muted transition-colors hover:bg-bg-subtle hover:text-fg"
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
        {isDark ? (
          <>
            <circle cx="12" cy="12" r="4.2" />
            <path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4" strokeLinecap="round" />
          </>
        ) : (
          <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z" strokeLinejoin="round" />
        )}
      </svg>
    </button>
  );
}
