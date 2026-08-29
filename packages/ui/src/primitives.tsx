import type { ButtonHTMLAttributes, ReactNode } from "react";

export function Mark({ compact = false }: { compact?: boolean }) {
  return (
    <span
      className={compact ? "mark mark--compact" : "mark"}
      aria-label="AubOS"
    >
      <span className="mark__orbit" aria-hidden="true" />
      <span className="mark__word">AUB</span>
      {!compact && <span className="mark__os">OS</span>}
    </span>
  );
}

export function StatusDot({ tone = "ok" }: { tone?: "ok" | "warn" | "idle" }) {
  return (
    <span className={`status-dot status-dot--${tone}`} aria-hidden="true" />
  );
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "quiet" | "outline";
};

export function Button({
  variant = "primary",
  className = "",
  ...props
}: ButtonProps) {
  return (
    <button
      className={`button button--${variant} ${className}`.trim()}
      {...props}
    />
  );
}

export function Badge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "blue" | "green" | "orange";
}) {
  return <span className={`badge badge--${tone}`}>{children}</span>;
}

export function EmptyState({
  eyebrow,
  title,
  children,
  action,
}: {
  eyebrow: string;
  title: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <section className="empty-state">
      <div className="empty-state__glyph" aria-hidden="true">
        <span />
      </div>
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h2>{title}</h2>
        <div className="empty-state__copy">{children}</div>
        {action && <div className="empty-state__action">{action}</div>}
      </div>
    </section>
  );
}

export function SectionHeading({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow: string;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <header className="section-heading">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        {description && (
          <p className="section-heading__description">{description}</p>
        )}
      </div>
      {action && <div className="section-heading__action">{action}</div>}
    </header>
  );
}
