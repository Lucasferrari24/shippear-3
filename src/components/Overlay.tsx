"use client";

import { useEffect, useRef } from "react";
import { drawOverlay } from "@/lib/drawOverlay";
import type { InspectionResult, Verdict } from "@/lib/inspection";

/** Dibuja la foto con las cotas medidas por la IA y la banda de llenado. */
export function Overlay({ src, result, verdict }: { src: string; result: InspectionResult; verdict: Verdict }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const img = new Image();
    img.onload = () => {
      const canvas = ref.current;
      if (!canvas) return;
      canvas.width = result.width;
      canvas.height = result.height;
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(img, 0, 0, result.width, result.height);
      drawOverlay(ctx, result.reading, verdict, result.width, result.height);
    };
    img.src = src;
  }, [src, result, verdict]);

  return <canvas ref={ref} className="h-auto w-full rounded-lg bg-black" />;
}
