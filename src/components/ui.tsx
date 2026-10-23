// Shared primitives that reproduce the Stitch component styles (buttons, chips, cards, inputs).
import clsx from "clsx";
import { motion, type HTMLMotionProps } from "motion/react";
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";

export function Icon({ name, className, filled }: { name: string; className?: string; filled?: boolean }) {
  return (
    <span aria-hidden className={clsx("material-symbols-outlined", filled && "icon-filled", className)}>
      {name}
    </span>
  );
}

type Variant = "primary" | "primaryContainer" | "surface" | "tonal" | "ghost" | "danger" | "outline";

const variants: Record<Variant, string> = {
  primary: "bg-primary text-on-primary hover:bg-primary-container shadow-sm",
  primaryContainer: "bg-primary-container text-on-primary hover:opacity-95 shadow-sm",
  surface: "bg-surface-container-lowest text-on-surface hover:bg-surface-container-high shadow-sm",
  tonal: "bg-surface-container text-on-surface hover:bg-surface-container-high",
  ghost: "text-secondary hover:bg-surface-container hover:text-on-surface",
  danger: "bg-error text-on-error hover:opacity-90 shadow-sm",
  outline: "border border-outline-variant text-on-surface-variant hover:bg-surface-container-low",
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  icon?: string;
  iconRight?: string;
  loading?: boolean;
  size?: "sm" | "md" | "lg";
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "primary", icon, iconRight, loading, size = "md", className, children, disabled, ...rest },
  ref,
) {
  const sizes = {
    sm: "px-space-sm py-1 font-label-sm text-label-sm gap-1",
    md: "px-space-md py-2 font-label-lg text-label-lg gap-space-xs",
    lg: "px-space-lg py-2.5 font-label-lg text-label-lg gap-space-sm",
  };
  return (
    <button
      ref={ref}
      type="button"
      disabled={disabled || loading}
      className={clsx(
        "inline-flex items-center justify-center whitespace-nowrap rounded-lg transition-all disabled:cursor-not-allowed disabled:opacity-50 active:scale-[0.98]",
        sizes[size],
        variants[variant],
        className,
      )}
      {...rest}
    >
      {loading ? (
        <Icon name="progress_activity" className="animate-spin text-[18px]" />
      ) : (
        icon && <Icon name={icon} className={size === "sm" ? "text-[16px]" : "text-[18px]"} />
      )}
      {children}
      {iconRight && <Icon name={iconRight} className="text-[18px]" />}
    </button>
  );
});

export function IconButton({
  icon,
  label,
  className,
  ...rest
}: { icon: string; label: string } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={clsx(
        "rounded-lg p-1.5 text-on-surface-variant transition-colors hover:bg-surface-container hover:text-on-surface disabled:opacity-40",
        className,
      )}
      {...rest}
    >
      <Icon name={icon} className="text-[18px]" />
    </button>
  );
}

export function Card({ className, children, ...rest }: HTMLMotionProps<"div">) {
  return (
    <motion.div className={clsx("rounded-xl bg-surface-container-lowest shadow-sm", className)} {...rest}>
      {children}
    </motion.div>
  );
}

export function Pill({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <span
      className={clsx(
        "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 font-label-sm text-label-sm font-semibold",
        className,
      )}
    >
      {children}
    </span>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  id,
  className,
  size = "sm",
}: {
  value: T;
  options: { value: T; label: ReactNode }[];
  onChange: (v: T) => void;
  id: string;
  className?: string;
  size?: "sm" | "md";
}) {
  return (
    <div className={clsx("inline-flex items-center rounded-lg bg-surface-container p-0.5", className)} role="tablist">
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(o.value)}
            className={clsx(
              "relative whitespace-nowrap rounded-md transition-colors",
              size === "sm" ? "px-3 py-1 font-label-md text-label-md" : "px-space-md py-1.5 font-label-sm text-label-sm",
              active ? "font-semibold text-primary" : "text-on-surface-variant hover:text-on-surface",
            )}
          >
            {active && (
              <motion.span
                layoutId={`seg-${id}`}
                className="absolute inset-0 rounded-md bg-surface-container-lowest shadow-sm"
                transition={{ type: "spring", stiffness: 500, damping: 38 }}
              />
            )}
            <span className="relative">{o.label}</span>
          </button>
        );
      })}
    </div>
  );
}

export function FilterChip({
  active,
  onClick,
  children,
  className,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
  className?: string;
}) {
  return (
    <motion.button
      layout
      type="button"
      onClick={onClick}
      whileTap={{ scale: 0.96 }}
      className={clsx(
        "flex items-center gap-1 rounded-full px-3 py-1 font-label-sm text-label-sm transition-colors",
        active
          ? "bg-primary-fixed font-semibold text-on-primary-fixed shadow-sm"
          : "bg-surface-container-low font-medium text-on-surface-variant hover:bg-surface-container",
        className,
      )}
    >
      {active && <Icon name="check" className="text-[14px]" />}
      {children}
    </motion.button>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={clsx("animate-pulse rounded-lg bg-surface-container", className)} />;
}

export function ProgressBar({ value, className, barClass = "bg-primary" }: { value: number; className?: string; barClass?: string }) {
  return (
    <div className={clsx("h-1.5 w-full overflow-hidden rounded-full bg-surface-container", className)}>
      <motion.div
        className={clsx("h-1.5 rounded-full", barClass)}
        initial={{ width: 0 }}
        animate={{ width: `${Math.max(0, Math.min(100, value))}%` }}
        transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
      />
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  body,
  action,
}: {
  icon: string;
  title: string;
  body?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex flex-col items-center justify-center gap-space-sm px-space-lg py-space-xl text-center"
    >
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-secondary-container text-primary">
        <Icon name={icon} className="text-[24px]" />
      </div>
      <h3 className="font-title-sm text-title-sm text-on-surface">{title}</h3>
      {body && <p className="max-w-md font-body-sm text-body-sm text-on-surface-variant">{body}</p>}
      {action && <div className="pt-space-xs">{action}</div>}
    </motion.div>
  );
}

export function Field({ label, hint, children, error }: { label: string; hint?: ReactNode; children: ReactNode; error?: string }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="flex items-center justify-between font-label-md text-label-md text-on-surface-variant">
        <span>{label}</span>
        {hint && <span className="font-label-sm text-label-sm text-outline">{hint}</span>}
      </span>
      {children}
      {error && <span className="font-label-sm text-label-sm text-error">{error}</span>}
    </label>
  );
}

export const inputClass =
  "w-full rounded-lg bg-surface-container-low px-space-md py-2 font-body-md text-body-md text-on-surface placeholder:text-outline transition-all hover:bg-surface-container focus:bg-surface-container-lowest focus:outline-none focus:ring-2 focus:ring-primary-container";

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="rounded bg-surface-container-high px-1.5 py-0.5 font-label-sm text-label-sm text-on-surface-variant">
      {children}
    </kbd>
  );
}

export function Avatar({ name, size = "md" }: { name: string | null | undefined; size?: "sm" | "md" | "lg" }) {
  const sizes = { sm: "h-6 w-6 text-[10px]", md: "h-8 w-8 text-xs", lg: "h-12 w-12 text-sm" };
  const clean = (name ?? "?").replace(/^@/, "");
  // Deterministic tonal colour per name, staying inside the palette.
  const palette = [
    "bg-secondary-container text-on-secondary-container",
    "bg-primary-fixed text-on-primary-fixed",
    "bg-tertiary-fixed text-on-tertiary-fixed",
    "bg-surface-container-highest text-on-surface",
  ];
  const tone = palette[[...clean].reduce((a, c) => a + c.charCodeAt(0), 0) % palette.length];
  const letters = clean
    .split(/[ ._@-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join("");
  return (
    <span className={clsx("inline-flex shrink-0 items-center justify-center rounded-full font-semibold", sizes[size], tone)}>
      {letters || "?"}
    </span>
  );
}
