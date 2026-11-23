import { useEffect, useRef, useState, type ReactNode } from "react";
import { CircleHelp, Eye, EyeOff, Loader2 } from "lucide-react";

export function Pill({
  tone,
  children,
}: {
  tone: "ok" | "err" | "warn" | "dim" | "accent";
  children: ReactNode;
}) {
  const tones: Record<string, string> = {
    ok: "bg-ok/10 text-ok border-ok/30",
    err: "bg-err/10 text-err border-err/30",
    warn: "bg-warn/10 text-warn border-warn/30",
    dim: "bg-dim/10 text-dim border-dim/25",
    accent: "bg-accent/10 text-accent border-accent/30",
  };
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] leading-4 font-medium ${tones[tone]}`}
    >
      {children}
    </span>
  );
}

export function Btn({
  children,
  onClick,
  variant = "primary",
  disabled,
  loading,
  title,
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: "primary" | "ghost" | "danger";
  disabled?: boolean;
  loading?: boolean;
  title?: string;
}) {
  const styles: Record<string, string> = {
    primary: "bg-accent text-accent-fg hover:brightness-110",
    ghost: "bg-panel2 text-fg border border-line hover:border-dim/50",
    danger: "bg-err/15 text-err border border-err/40 hover:bg-err/25",
  };
  return (
    <button
      title={title}
      disabled={disabled || loading}
      onClick={onClick}
      className={`inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md px-3 py-1.5 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-40 ${styles[variant]}`}
    >
      {loading && <Loader2 size={13} className="animate-spin" />}
      {children}
    </button>
  );
}

export function Card({
  title,
  actions,
  children,
  className = "",
}: {
  title?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`rounded-xl border border-line bg-panel ${className}`}>
      {(title || actions) && (
        <div className="relative z-10 flex items-center justify-between border-b border-line px-4 py-2.5">
          <div className="text-[13px] font-semibold">{title}</div>
          <div className="flex items-center gap-2">{actions}</div>
        </div>
      )}
      <div className="p-4">{children}</div>
    </div>
  );
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <div className="mb-1 text-[11px] font-medium text-dim">{label}</div>
      {children}
      {hint && <div className="mt-1 text-[11px] leading-4 text-dim/80">{hint}</div>}
    </label>
  );
}

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`w-full rounded-md border border-line bg-panel2 px-2.5 py-1.5 text-xs text-fg outline-none transition placeholder:text-dim/50 focus:border-accent/60 ${props.className ?? ""}`}
    />
  );
}

export function SecretInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <Input {...props} type={show ? "text" : "password"} className="pr-8" />
      <button
        type="button"
        onClick={() => setShow(!show)}
        className="absolute top-1/2 right-2 -translate-y-1/2 text-dim hover:text-fg"
        tabIndex={-1}
      >
        {show ? <EyeOff size={13} /> : <Eye size={13} />}
      </button>
    </div>
  );
}

export function Switch({
  checked,
  onChange,
  label,
  hint,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label?: string;
  hint?: string;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-2.5 py-1">
      <button
        type="button"
        onClick={() => onChange(!checked)}
        className={`relative h-[18px] w-8 shrink-0 rounded-full transition ${checked ? "bg-accent" : "bg-line"}`}
      >
        <span
          className={`absolute top-[2px] h-[14px] w-[14px] rounded-full bg-white transition-all ${checked ? "left-[16px]" : "left-[2px]"}`}
        />
      </button>
      {label && (
        <span className="text-xs">
          {label}
          {hint && <span className="ml-2 text-[11px] text-dim">{hint}</span>}
        </span>
      )}
    </label>
  );
}

/** 标题旁的小问号。点击后在原位弹出说明，再点或点外面关闭。 */
export function HelpTip({ label = "说明", children }: { label?: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <span ref={ref} className="relative inline-flex">
      <button
        type="button"
        aria-label={label}
        aria-expanded={open}
        title={label}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        className={`inline-flex h-5 w-5 items-center justify-center rounded-full transition hover:bg-accent/15 hover:text-accent ${open ? "text-accent" : "text-dim"}`}
      >
        <CircleHelp size={14} />
      </button>
      {open && (
        <div
          role="dialog"
          className="absolute top-full left-0 z-30 mt-1.5 w-80 rounded-lg border border-accent/40 bg-panel2 p-3 text-left text-[11px] leading-5 font-normal text-fg shadow-2xl"
        >
          {children}
        </div>
      )}
    </span>
  );
}

export function Empty({ text }: { text: string }) {
  return <div className="py-8 text-center text-xs text-dim">{text}</div>;
}

export function ErrorText({ children }: { children: ReactNode }) {
  if (!children) return null;
  return <div className="mt-1 text-[11px] text-err">{children}</div>;
}
