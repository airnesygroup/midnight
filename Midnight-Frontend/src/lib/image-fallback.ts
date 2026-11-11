/**
 * Missing or broken photos are swapped for one of FALLBACK_GRADIENTS fixed gradients
 * (defined as .img-fallback[data-fallback] in styles.css). The gradient is picked from
 * the original image address, so the same missing photo always gets the same gradient.
 */
export const FALLBACK_GRADIENTS = 20;

const BLANK = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";

export function fallbackIndex(src: string): number {
  let h = 2166136261;
  for (let i = 0; i < src.length; i++) {
    h ^= src.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) % FALLBACK_GRADIENTS;
}

function applyFallback(img: HTMLImageElement) {
  if (img.dataset["fallback"] !== undefined) return;
  const original = img.getAttribute("src") ?? "";
  img.dataset["fallback"] = String(fallbackIndex(original));
  img.classList.add("img-fallback");
  img.removeAttribute("srcset");
  img.alt = "";
  img.src = BLANK;
}

const isBroken = (img: HTMLImageElement) => !img.getAttribute("src") || (img.complete && img.naturalWidth === 0);

/** Installs one page-wide listener; returns a cleanup function. */
export function installImageFallback(): () => void {
  const onError = (e: Event) => {
    if (e.target instanceof HTMLImageElement) applyFallback(e.target);
  };
  document.addEventListener("error", onError, true);
  // Photos that failed before the page became interactive.
  document.querySelectorAll("img").forEach((img) => isBroken(img) && applyFallback(img));
  // Photos added later with no address at all never fire an error event.
  const observer = new MutationObserver((records) => {
    for (const r of records) {
      r.addedNodes.forEach((n) => {
        if (n instanceof HTMLImageElement) { if (!n.getAttribute("src")) applyFallback(n); }
        else if (n instanceof HTMLElement) n.querySelectorAll("img:not([src]), img[src='']").forEach((img) => applyFallback(img as HTMLImageElement));
      });
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
  return () => {
    document.removeEventListener("error", onError, true);
    observer.disconnect();
  };
}
