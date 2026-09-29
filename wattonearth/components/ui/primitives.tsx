import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";

export function Container({ className = "", children }: { className?: string; children: ReactNode }) {
  return <div className={`mx-auto w-full max-w-6xl px-5 sm:px-8 ${className}`}>{children}</div>;
}

export function Eyebrow({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <p className={`text-xs font-medium uppercase tracking-[0.2em] text-accent ${className}`}>{children}</p>
  );
}

export function SectionHeading({
  eyebrow,
  title,
  lead,
  as: Tag = "h2",
  className = "",
}: {
  eyebrow?: string;
  title: ReactNode;
  lead?: ReactNode;
  as?: "h1" | "h2";
  className?: string;
}) {
  return (
    <div className={`max-w-3xl ${className}`}>
      {eyebrow && <Eyebrow className="mb-4">{eyebrow}</Eyebrow>}
      <Tag
        className={
          Tag === "h1"
            ? "text-4xl font-semibold leading-[1.05] tracking-tight sm:text-6xl"
            : "text-3xl font-semibold leading-tight tracking-tight sm:text-4xl"
        }
      >
        {title}
      </Tag>
      {lead && <p className="mt-5 text-lg leading-relaxed text-muted sm:text-xl">{lead}</p>}
    </div>
  );
}

const buttonBase =
  "inline-flex items-center justify-center gap-2 rounded-full px-6 py-3 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60";
const buttonVariants = {
  primary: "bg-fg text-bg hover:bg-accent hover:text-accent-fg",
  accent: "bg-accent text-accent-fg hover:opacity-90",
  secondary: "border border-line text-fg hover:border-fg",
  ghost: "text-fg underline-offset-4 hover:underline px-0 py-0",
} as const;
export type ButtonVariant = keyof typeof buttonVariants;

export function buttonClass(variant: ButtonVariant = "primary", extra = "") {
  return `${buttonBase} ${buttonVariants[variant]} ${extra}`;
}

export function ButtonLink({
  variant = "primary",
  className = "",
  ...props
}: ComponentProps<typeof Link> & { variant?: ButtonVariant }) {
  return <Link {...props} className={buttonClass(variant, className)} />;
}

export function Button({
  variant = "primary",
  className = "",
  ...props
}: ComponentProps<"button"> & { variant?: ButtonVariant }) {
  return <button {...props} className={buttonClass(variant, className)} />;
}

export function Card({ className = "", children }: { className?: string; children: ReactNode }) {
  return <div className={`rounded-2xl border border-line bg-bg-elevated p-6 sm:p-8 ${className}`}>{children}</div>;
}

export function Badge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "accent" | "good" | "typical" | "poor" | "warn";
}) {
  const tones = {
    neutral: "border-line text-muted",
    accent: "border-accent/40 text-accent",
    good: "border-good/40 text-good",
    typical: "border-typical/40 text-typical",
    poor: "border-poor/40 text-poor",
    warn: "border-warn-fg/30 bg-warn-bg text-warn-fg",
  };
  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${tones[tone]}`}>
      {children}
    </span>
  );
}

/** Label + control wrapper used by all forms. */
export function Field({
  label,
  htmlFor,
  hint,
  required,
  children,
  className = "",
}: {
  label: string;
  htmlFor: string;
  hint?: ReactNode;
  required?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <label htmlFor={htmlFor} className="mb-1.5 block text-sm font-medium">
        {label}
        {required && (
          <span className="text-accent" aria-hidden="true">
            {" "}
            *
          </span>
        )}
      </label>
      {children}
      {hint && <p className="mt-1.5 text-xs text-muted">{hint}</p>}
    </div>
  );
}

export const inputClass =
  "block w-full rounded-xl border border-line bg-bg px-4 py-3 text-base text-fg placeholder:text-muted/70 focus:border-fg focus:outline-none focus-visible:outline-2 aria-[invalid=true]:border-poor";
