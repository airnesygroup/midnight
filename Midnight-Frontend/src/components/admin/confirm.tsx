import * as Dialog from "@radix-ui/react-dialog";
import { AlertTriangle, ShieldAlert, Check } from "lucide-react";
import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";

export type ConfirmOptions = {
  title: string;
  body?: ReactNode;
  confirmLabel?: string;
  tone?: "default" | "danger";
  /** Most serious actions: a second, final pop-up must also be accepted. */
  twoStep?: { title: string; body?: ReactNode; confirmLabel?: string };
};

type Ask = (o: ConfirmOptions) => Promise<boolean>;
const Ctx = createContext<Ask | null>(null);

export function useConfirm(): Ask {
  const ask = useContext(Ctx);
  if (!ask) throw new Error("useConfirm must be used inside ConfirmProvider");
  return ask;
}

/** Centred confirmation pop-ups for the admin. `await confirm({...})` resolves true only when accepted. */
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [opts, setOpts] = useState<ConfirmOptions | null>(null);
  const [step, setStep] = useState<1 | 2>(1);
  const resolver = useRef<((v: boolean) => void) | null>(null);

  const ask = useCallback<Ask>((o) => new Promise((resolve) => {
    resolver.current?.(false);
    resolver.current = resolve;
    setStep(1);
    setOpts(o);
  }), []);

  const finish = (v: boolean) => { resolver.current?.(v); resolver.current = null; setOpts(null); };
  const accept = () => { if (opts?.twoStep && step === 1) setStep(2); else finish(true); };

  const danger = opts?.tone === "danger";
  const view = step === 2 && opts?.twoStep ? opts.twoStep : opts;
  const Icon = step === 2 ? ShieldAlert : danger ? AlertTriangle : Check;

  return (
    <Ctx.Provider value={ask}>
      {children}
      <Dialog.Root open={!!opts} onOpenChange={(o) => { if (!o) finish(false); }}>
        <Dialog.Portal>
          <Dialog.Overlay className="admin-dialog-overlay" />
          <Dialog.Content key={step} className="admin-dialog glass-strong shadow-float" aria-describedby={undefined}>
            <span className="admin-dialog-icon" data-tone={danger ? "danger" : undefined}><Icon /></span>
            {opts?.twoStep && <span className="admin-dialog-step">Step {step} of 2</span>}
            <Dialog.Title className="text-xl font-extrabold tracking-tight">{view?.title}</Dialog.Title>
            {view?.body && <div className="mt-2 text-sm text-muted-foreground">{view.body}</div>}
            <div className="admin-dialog-actions">
              <button type="button" className="admin-btn min-h-11" onClick={() => finish(false)}>Cancel</button>
              <button type="button" autoFocus className="admin-btn min-h-11" data-tone={danger ? "solid-danger" : "primary"} onClick={accept}>
                {view?.confirmLabel ?? (opts?.twoStep && step === 1 ? "Continue" : "Confirm")}
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </Ctx.Provider>
  );
}
