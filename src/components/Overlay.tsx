"use client";

import { useEffect, useRef } from "react";
import type { Box, InspectionResult, Verdict } from "@/lib/inspection";

const CAP_COLORS = {
  ok: "#22c55e",
  mal_colocada: "#f59e0b",
  abierta: "#f97316",
  ausente: "#ef4444",
} as const;

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

      const s = Math.max(result.width, result.height) / 600;
      const { reading } = result;
      const b = reading.bottle_box;

      const rect = (bx: Box, color: string, label: string, dash: number[] = []) => {
        ctx.save();
        ctx.strokeStyle = color;
        ctx.lineWidth = 2 * s;
        ctx.setLineDash(dash.map((d) => d * s));
        ctx.strokeRect(bx.x0, bx.y0, bx.x1 - bx.x0, bx.y1 - bx.y0);
        ctx.setLineDash([]);
        tag(label, bx.x1 + 4 * s, bx.y0, color);
        ctx.restore();
      };

      const hline = (y: number, color: string, label: string, dash: number[] = []) => {
        ctx.save();
        ctx.strokeStyle = color;
        ctx.lineWidth = 2 * s;
        ctx.setLineDash(dash.map((d) => d * s));
        ctx.beginPath();
        ctx.moveTo(b.x0 - 12 * s, y);
        ctx.lineTo(b.x1 + 12 * s, y);
        ctx.stroke();
        ctx.restore();
        tag(label, b.x1 + 14 * s, y - 9 * s, color);
      };

      const tag = (text: string, x: number, y: number, color: string) => {
        ctx.save();
        ctx.font = `600 ${12 * s}px ui-monospace, monospace`;
        const w = ctx.measureText(text).width + 8 * s;
        const tx = Math.min(x, result.width - w - 2);
        ctx.fillStyle = "rgba(11,15,20,0.85)";
        ctx.fillRect(tx, y, w, 18 * s);
        ctx.fillStyle = color;
        ctx.fillText(text, tx + 4 * s, y + 13 * s);
        ctx.restore();
      };

      // Banda de referencia min/max
      ctx.save();
      ctx.fillStyle = "rgba(56,189,248,0.12)";
      ctx.fillRect(b.x0, verdict.bandPx.min, b.x1 - b.x0, verdict.bandPx.max - verdict.bandPx.min);
      ctx.restore();
      hline(verdict.bandPx.min, "#38bdf8", "MÁX", [6, 4]);
      hline(verdict.bandPx.max, "#38bdf8", "MÍN", [6, 4]);

      rect(b, "rgba(230,237,243,0.6)", "envase", [4, 4]);
      if (reading.spout_box) rect(reading.spout_box, "#a78bfa", "pico");
      if (reading.cap_box) {
        const gap = reading.cap_gap_px ? ` · gap ${Math.round(reading.cap_gap_px)}px` : "";
        rect(reading.cap_box, CAP_COLORS[reading.cap_state], `tapa ${reading.cap_state}${gap}`);
      }

      if (reading.liquid_surface_y != null) {
        const inBand = !verdict.defects.some((d) => d.startsWith("NIVEL"));
        const pct = verdict.levelFraction != null ? ` ${(verdict.levelFraction * 100).toFixed(1)}%` : "";
        hline(reading.liquid_surface_y, inBand ? "#22c55e" : "#ef4444", `nivel${pct}`);
      }
    };
    img.src = src;
  }, [src, result, verdict]);

  return <canvas ref={ref} className="h-auto w-full rounded-lg bg-black" />;
}
