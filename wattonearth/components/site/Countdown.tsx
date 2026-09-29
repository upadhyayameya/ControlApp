"use client";

import { useSyncExternalStore } from "react";

// Minute-resolution clock shared by all countdowns. Server snapshot is null so
// the SSR output is deterministic; digits appear after hydration.
function subscribeMinute(cb: () => void) {
  const id = window.setInterval(cb, 15_000);
  return () => window.clearInterval(id);
}
const minuteNow = () => Math.floor(Date.now() / 60_000) * 60_000;
const serverNow = () => null;

function parts(targetMs: number, nowMs: number) {
  const diff = Math.max(0, targetMs - nowMs);
  const days = Math.floor(diff / 86_400_000);
  const hours = Math.floor((diff % 86_400_000) / 3_600_000);
  const minutes = Math.floor((diff % 3_600_000) / 60_000);
  return { days, hours, minutes };
}

/** Counts down to midnight IST on `date` (YYYY-MM-DD), updating every minute. */
export function Countdown({ date }: { date: string }) {
  const target = new Date(`${date}T00:00:00+05:30`).getTime();
  const now = useSyncExternalStore(subscribeMinute, minuteNow, serverNow);
  const { days, hours, minutes } = parts(target, now ?? target);
  const units = [
    { value: days, label: days === 1 ? "day" : "days" },
    { value: hours, label: hours === 1 ? "hour" : "hours" },
    { value: minutes, label: minutes === 1 ? "minute" : "minutes" },
  ];

  return (
    <div className="flex gap-6 sm:gap-10" role="timer" aria-live="off">
      {units.map((u) => (
        <div key={u.label}>
          <div className="font-mono text-4xl font-medium tabular-nums tracking-tight sm:text-6xl">
            {now === null ? "––" : String(u.value).padStart(2, "0")}
          </div>
          <div className="mt-1 text-xs uppercase tracking-[0.2em] text-muted">{u.label}</div>
        </div>
      ))}
    </div>
  );
}
