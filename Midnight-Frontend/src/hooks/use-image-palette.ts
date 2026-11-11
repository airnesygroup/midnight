import { useEffect } from "react";

const VARS = ["--blob-pink", "--blob-blue", "--blob-lilac"] as const;

/** Tints the page background blobs with colours sampled from an image; restores defaults on leave. */
export function useImagePalette(src: string) {
  useEffect(() => {
    const root = document.documentElement;
    let cancelled = false;
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      if (cancelled) return;
      try {
        const c = document.createElement("canvas");
        c.width = 3;
        c.height = 3;
        const ctx = c.getContext("2d");
        if (!ctx) return;
        ctx.drawImage(img, 0, 0, 3, 3);
        const d = ctx.getImageData(0, 0, 3, 3).data;
        const px = (x: number, y: number) => {
          const i = (y * 3 + x) * 4;
          return `rgb(${d[i]} ${d[i + 1]} ${d[i + 2]})`;
        };
        // top-right, middle-left, bottom-centre match the blob positions
        [px(2, 0), px(0, 1), px(1, 2)].forEach((col, k) =>
          root.style.setProperty(VARS[k] as string, `color-mix(in oklab, ${col} 22%, oklch(0.98 0.005 0))`),
        );
      } catch {
        /* keep defaults if the image can't be read */
      }
    };
    img.src = src;
    return () => {
      cancelled = true;
      VARS.forEach((v) => root.style.removeProperty(v));
    };
  }, [src]);
}
