import { useEffect, useState } from "react";
import { ArrowDown } from "lucide-react";

/**
 * Floating bottom-centre arrow on story pages: before the discussion it points down and jumps
 * to the start of the discussion; once the discussion is in view it points up and returns to the top.
 */
export function JumpArrow({ targetId = "discussion" }: { targetId?: string }) {
  const [up, setUp] = useState(false);

  useEffect(() => {
    let frame = 0;
    const check = () => {
      frame = 0;
      const el = document.getElementById(targetId);
      if (!el) return setUp(false);
      setUp(el.getBoundingClientRect().top <= window.innerHeight * 0.6);
    };
    const onScroll = () => { if (!frame) frame = requestAnimationFrame(check); };
    check();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [targetId]);

  const go = () => {
    if (up) window.scrollTo({ top: 0, behavior: "smooth" });
    else document.getElementById(targetId)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <button type="button" onClick={go} aria-label={up ? "Back to the top" : "Jump to the discussion"} className="jump-arrow">
      <ArrowDown className={`h-5 w-5 transition-transform duration-500 ${up ? "rotate-180" : ""}`} />
    </button>
  );
}
