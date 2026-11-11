import { useId, useState } from "react";
import { Check, Eye, EyeOff, X } from "lucide-react";
import { LIMITS, passwordStrength } from "@/lib/community-rules";

type Props = {
  label: string; value: string; onChange: (v: string) => void; error?: string | null | undefined;
  autoComplete: string; showStrength?: boolean; context?: string[]; maxLength?: number;
};

export function PasswordField({ label, value, onChange, error, autoComplete, showStrength, context = [], maxLength }: Props) {
  const id = useId();
  const [visible, setVisible] = useState(false);
  const s = passwordStrength(value, context);
  return (
    <div>
      <label htmlFor={id} className="auth-label">{label}</label>
      {showStrength && maxLength && (
        <div className="mb-2">
          <div className="flex gap-1.5" aria-hidden>
            {[0, 1, 2, 3].map((i) => (
              <span key={i} className={`strength-bar ${value && i < s.score ? `strength-${s.score}` : ""}`} />
            ))}
          </div>
          <p className="mt-1.5 flex justify-between text-xs text-muted-foreground">
            <span>{LIMITS.passwordMin}–{maxLength} characters</span>
            <span className="font-semibold text-foreground" aria-live="polite">{value ? `Strength: ${s.label}` : "Not set"}</span>
          </p>
        </div>
      )}
      <div className="relative">
        <input id={id} type={visible ? "text" : "password"} value={value} autoComplete={autoComplete}
          onChange={(e) => onChange(e.target.value)} aria-invalid={!!error} aria-describedby={error ? `${id}-err` : undefined}
          className="auth-input pr-12" />
        <button type="button" onClick={() => setVisible((v) => !v)} aria-label={visible ? "Hide password" : "Show password"}
          className="absolute top-1/2 right-2 grid h-9 w-9 -translate-y-1/2 place-items-center rounded-full text-muted-foreground nav-hover">
          {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
      </div>
      {maxLength && value.length > maxLength * 0.8 && (
        <p className={`mt-1 text-right text-xs ${value.length > maxLength ? "text-destructive" : "text-muted-foreground"}`}>{value.length}/{maxLength}</p>
      )}
      {error && <p id={`${id}-err`} role="alert" className="auth-error">{error}</p>}
      {showStrength && value.length > 0 && (
        <div className="mt-3">
          <ul className=" grid gap-1 text-xs sm:grid-cols-2">
            {s.checks.map((c) => (
              <li key={c.id} className={`flex items-center gap-1.5 ${c.ok ? "text-success" : "text-muted-foreground"}`}>
                {c.ok ? <Check className="h-3.5 w-3.5" /> : <X className="h-3.5 w-3.5" />}{c.label}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
