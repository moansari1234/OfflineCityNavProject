import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "@/utils/cn";

export function Button({
  variant = "primary",
  size = "md",
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "ghost" | "danger" | "subtle"; size?: "sm" | "md" }) {
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center gap-1.5 rounded-md font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40",
        size === "sm" ? "h-7 px-2.5 text-xs" : "h-9 px-3.5 text-sm",
        variant === "primary" && "bg-amber-400 text-slate-950 hover:bg-amber-300",
        variant === "subtle" && "bg-slate-700/70 text-slate-100 hover:bg-slate-600/80",
        variant === "ghost" && "text-slate-300 hover:bg-slate-800 hover:text-white",
        variant === "danger" && "bg-red-500/15 text-red-300 hover:bg-red-500/25",
        className
      )}
      {...props}
    />
  );
}

export function Step({
  n,
  title,
  status,
  children,
  right,
}: {
  n: number;
  title: string;
  status: "todo" | "active" | "done";
  children: ReactNode;
  right?: ReactNode;
}) {
  return (
    <section className={cn("border-b border-slate-800/80 px-4 py-4", status === "todo" && "opacity-60")}>
      <header className="mb-3 flex items-center gap-2.5">
        <span
          className={cn(
            "flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold",
            status === "done" && "bg-emerald-500 text-slate-950",
            status === "active" && "bg-amber-400 text-slate-950",
            status === "todo" && "bg-slate-700 text-slate-300"
          )}
        >
          {status === "done" ? "✓" : n}
        </span>
        <h2 className="text-[13px] font-semibold uppercase tracking-wider text-slate-200">{title}</h2>
        {right && <div className="ml-auto">{right}</div>}
      </header>
      {children}
    </section>
  );
}

export function ProgressBar({ value, indeterminate }: { value?: number; indeterminate?: boolean }) {
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-700/60">
      {indeterminate || value === undefined ? (
        <div className="h-full w-1/3 animate-[slide_1.2s_ease-in-out_infinite] rounded-full bg-amber-400" />
      ) : (
        <div className="h-full rounded-full bg-amber-400 transition-[width] duration-200" style={{ width: `${Math.round(value * 100)}%` }} />
      )}
    </div>
  );
}

export function Alert({ kind, children, onClose }: { kind: "error" | "info" | "warn"; children: ReactNode; onClose?: () => void }) {
  return (
    <div
      className={cn(
        "relative rounded-md border px-3 py-2 text-xs leading-relaxed",
        kind === "error" && "border-red-500/40 bg-red-500/10 text-red-200",
        kind === "warn" && "border-amber-500/40 bg-amber-500/10 text-amber-100",
        kind === "info" && "border-sky-500/30 bg-sky-500/10 text-sky-100"
      )}
    >
      {children}
      {onClose && (
        <button onClick={onClose} className="absolute right-1.5 top-1 opacity-70 hover:opacity-100" aria-label="Dismiss">
          ×
        </button>
      )}
    </div>
  );
}

export function Stat({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="rounded-md bg-slate-800/60 px-2.5 py-1.5">
      <div className="text-[10px] uppercase tracking-wider text-slate-400">{label}</div>
      <div className="text-sm font-semibold tabular-nums text-slate-100">{value}</div>
    </div>
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <svg className={cn("h-4 w-4 animate-spin", className)} viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-90" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
    </svg>
  );
}
