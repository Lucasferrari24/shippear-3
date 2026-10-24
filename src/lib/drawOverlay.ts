// Dibuja las cotas de una inspección (envase, pico, tapa, menisco y banda) sobre un canvas 2D.
// Lo usa la cámara en tiempo real (la vista de foto tiene el suyo en components/qc/overlay.tsx).

import type { Box, Verdict, VisionReading } from "@/lib/types";

const CAP_COLORS = {
  ok: "#22c55e",
  mal_colocada: "#f59e0b",
  abierta: "#f97316",
  ausente: "#ef4444",
} as const;

/** Las coordenadas de `reading` están en píxeles de una imagen de width × height, igual que el canvas. */
export function drawOverlay(ctx: CanvasRenderingContext2D, reading: VisionReading, verdict: Verdict, width: number, height: number) {
  const s = Math.max(width, height) / 600;
  const b = reading.bottle_box;

  const tag = (text: string, x: number, y: number, color: string) => {
    ctx.save();
    ctx.font = `600 ${12 * s}px ui-monospace, monospace`;
    const w = ctx.measureText(text).width + 8 * s;
    const tx = Math.min(x, width - w - 2);
    ctx.fillStyle = "rgba(11,15,20,0.85)";
    ctx.fillRect(tx, y, w, 18 * s);
    ctx.fillStyle = color;
    ctx.fillText(text, tx + 4 * s, y + 13 * s);
    ctx.restore();
  };

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

  if (!verdict.bottle.detected) return;

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
    const inBand = verdict.bottle.level === "ok";
    const pct = verdict.levelFraction != null ? ` ${(verdict.levelFraction * 100).toFixed(1)}%` : "";
    hline(reading.liquid_surface_y, inBand ? "#22c55e" : "#ef4444", `nivel${pct}`);
  }
}
