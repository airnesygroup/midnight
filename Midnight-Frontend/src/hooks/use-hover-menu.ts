import { useEffect, useRef, useState, type PointerEvent } from "react";

/**
 * Hover-to-open menus for mouse users (click still works; touch uses taps).
 * Ignores the trigger's own press toggle and close requests while the pointer
 * is over the trigger or menu, which caused hover menus to flicker shut.
 */
export function useHoverMenu(delay = 200) {
  const [open, setOpen] = useState(false);
  const [byHover, setByHover] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const inside = useRef(false);
  useEffect(() => () => clearTimeout(timer.current), []);

  const enter = (e: PointerEvent) => {
    if (e.pointerType !== "mouse") return;
    inside.current = true;
    clearTimeout(timer.current);
    setByHover(true);
    setOpen(true);
  };
  const leave = (e: PointerEvent) => {
    if (e.pointerType !== "mouse") return;
    inside.current = false;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => { if (!inside.current) setOpen(false); }, delay);
  };
  const onOpenChange = (next: boolean) => {
    if (!next && inside.current) return;
    if (next) setByHover(false);
    setOpen(next);
  };
  const close = () => { inside.current = false; setOpen(false); };
  const hover = { onPointerEnter: enter, onPointerLeave: leave };
  const trigger = {
    ...hover,
    // Mouse presses would toggle the hover-opened menu shut; keep it open instead.
    onPointerDown: (e: PointerEvent) => { if (e.pointerType === "mouse" && open) e.preventDefault(); },
  };
  return { open, byHover, onOpenChange, close, trigger, content: hover };
}
