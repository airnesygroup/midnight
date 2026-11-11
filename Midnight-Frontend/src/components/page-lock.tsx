import { useEffect, useState } from "react";

let locks = 0;

/**
 * While a menu or pop-up is open, the page behind it cannot scroll or be clicked.
 * Renders an invisible full-screen shield beneath the header (z-40) and locks scrolling.
 * The shield lingers briefly after closing so the closing tap never lands on the page.
 */
export function PageLock({ active, onClose }: { active: boolean; onClose?: () => void }) {
  const [shield, setShield] = useState(active);

  useEffect(() => {
    if (active) {
      setShield(true);
      return;
    }
    const t = setTimeout(() => setShield(false), 350);
    return () => clearTimeout(t);
  }, [active]);

  useEffect(() => {
    if (!active) return;
    locks += 1;
    const root = document.documentElement;
    root.style.overflow = "hidden";
    document.body.style.overflow = "hidden";
    return () => {
      locks -= 1;
      if (locks === 0) {
        root.style.overflow = "";
        document.body.style.overflow = "";
      }
    };
  }, [active]);

  if (!shield) return null;
  return (
    <div
      aria-hidden
      className="page-lock"
      onPointerDown={(e) => { e.preventDefault(); if (active) onClose?.(); }}
      onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}
      onWheel={(e) => e.preventDefault()}
      onTouchMove={(e) => e.preventDefault()}
    />
  );
}
