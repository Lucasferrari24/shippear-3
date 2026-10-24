"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Minus, Plus, RotateCcw } from "lucide-react";
import { cn } from "cn";
import { CAP_COLORS, CAP_LABELS, pct } from "@/lib/labels";
import type { Box, VisionReading, Verdict } from "@/lib/types";

export type Layer = "envase" | "pico" | "tapa" | "banda" | "nivel";
export const ALL_LAYERS: Layer[] = ["envase", "pico", "tapa", "banda", "nivel"];

const LAYER_COLOR: Record<Layer, string> = {
  envase: "#F5F5F7",
  pico: "#A78BFA",
  tapa: "#FF9F0A",
  banda: "#64D2FF",
  nivel: "#30D158",
};

function draw(
  canvas: HTMLCanvasElement,
  width: number,
  height: number,
  reading: VisionReading,
  verdict: Verdict,
  layers: Set<Layer>,
) {
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.clearRect(0, 0, width, height);
  const s = Math.max(width, height) / 640;
  const b = reading.bottle_box;

  const tag = (text: string, x: number, y: number, color: string) => {
    ctx.save();
    ctx.font = `600 ${11 * s}px ui-monospace, "Geist Mono", monospace`;
    const pad = 7 * s;
    const h = 20 * s;
    const w = ctx.measureText(text).width + pad * 2;
    const tx = Math.max(2, Math.min(x, width - w - 2));
    const ty = Math.max(2, Math.min(y, height - h - 2));
    ctx.fillStyle = "rgba(0,0,0,0.72)";
    ctx.beginPath();
    ctx.roundRect(tx, ty, w, h, h / 2);
    ctx.fill();
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(tx + pad * 0.75, ty + h / 2, 2.5 * s, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#F5F5F7";
    ctx.textBaseline = "middle";
    ctx.fillText(text, tx + pad * 1.35, ty + h / 2 + 0.5 * s);
    ctx.restore();
  };

  const rect = (bx: Box, color: string, label: string, dash: number[] = [], side: "right" | "left" = "right") => {
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = 2 * s;
    ctx.setLineDash(dash.map((d) => d * s));
    ctx.beginPath();
    ctx.roundRect(bx.x0, bx.y0, bx.x1 - bx.x0, bx.y1 - bx.y0, 6 * s);
    ctx.stroke();
    ctx.restore();
    if (side === "right") tag(label, bx.x1 + 8 * s, bx.y0, color);
    else {
      ctx.save();
      ctx.font = `600 ${11 * s}px ui-monospace, monospace`;
      const w = ctx.measureText(label).width + 20 * s;
      ctx.restore();
      tag(label, bx.x0 - w - 8 * s, bx.y0, color);
    }
  };

  const hline = (y: number, color: string, label: string, dash: number[] = []) => {
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = 2 * s;
    ctx.setLineDash(dash.map((d) => d * s));
    ctx.beginPath();
    ctx.moveTo(b.x0 - 14 * s, y);
    ctx.lineTo(b.x1 + 14 * s, y);
    ctx.stroke();
    ctx.restore();
    tag(label, b.x1 + 20 * s, y - 10 * s, color);
  };

  if (layers.has("banda")) {
    ctx.save();
    ctx.fillStyle = "rgba(100,210,255,0.12)";
    ctx.fillRect(b.x0, verdict.bandPx.min, b.x1 - b.x0, verdict.bandPx.max - verdict.bandPx.min);
    ctx.restore();
    hline(verdict.bandPx.min, "#64D2FF", `MÁX ${pct(verdict.band.min, 0)}`, [6, 5]);
    hline(verdict.bandPx.max, "#64D2FF", `MÍN ${pct(verdict.band.max, 0)}`, [6, 5]);
  }
  if (layers.has("envase")) rect(b, "rgba(245,245,247,0.75)", "envase", [5, 5], "left");
  if (layers.has("pico") && reading.spout_box) rect(reading.spout_box, "#A78BFA", "pico", [], "left");
  if (layers.has("tapa") && reading.cap_box) {
    const gap = reading.cap_gap_px != null ? ` · gap ${Math.round(reading.cap_gap_px)}px` : "";
    rect(reading.cap_box, CAP_COLORS[reading.cap_state], `tapa ${reading.cap_state}${gap}`);
  }
  if (layers.has("nivel") && reading.liquid_surface_y != null) {
    const inBand = verdict.bottle.level === "ok";
    hline(reading.liquid_surface_y, inBand ? "#30D158" : "#FF453A", `nivel ${pct(verdict.levelFraction)}`);
  }
}

export function Overlay({
  src,
  width,
  height,
  reading,
  verdict,
  layers = new Set(ALL_LAYERS),
  scanning,
  zoomable = true,
  className,
  alt,
}: {
  src: string;
  width: number;
  height: number;
  reading?: VisionReading;
  verdict?: Verdict;
  layers?: Set<Layer>;
  scanning?: boolean;
  zoomable?: boolean;
  className?: string;
  alt: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinchStart = useRef<{ d: number; z: number } | null>(null);

  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    if (reading && verdict) draw(c, width, height, reading, verdict, layers);
    else c.getContext("2d")?.clearRect(0, 0, c.width, c.height);
  }, [width, height, reading, verdict, layers]);

  useEffect(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, [src]);

  const clampZoom = (z: number) => Math.min(4, Math.max(1, z));
  const applyZoom = useCallback((z: number) => {
    const nz = clampZoom(z);
    setZoom(nz);
    if (nz === 1) setPan({ x: 0, y: 0 });
  }, []);

  const onWheel = (e: React.WheelEvent) => {
    if (!zoomable || !(e.ctrlKey || e.metaKey || zoom > 1)) return;
    e.preventDefault();
    applyZoom(zoom * (e.deltaY < 0 ? 1.12 : 0.9));
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (!zoomable) return;
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      pinchStart.current = { d: Math.hypot(a.x - b.x, a.y - b.y), z: zoom };
    }
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const prev = pointers.current.get(e.pointerId);
    if (!prev) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2 && pinchStart.current) {
      const [a, b] = [...pointers.current.values()];
      applyZoom((pinchStart.current.z * Math.hypot(a.x - b.x, a.y - b.y)) / pinchStart.current.d);
    } else if (zoom > 1) {
      setPan((p) => ({ x: p.x + (e.clientX - prev.x), y: p.y + (e.clientY - prev.y) }));
    }
  };
  const onPointerUp = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinchStart.current = null;
  };

  return (
    <div
      className={cn("relative overflow-hidden bg-surface", zoom > 1 ? "cursor-grab active:cursor-grabbing" : "", className)}
      style={{ touchAction: zoom > 1 ? "none" : "pan-y" }}
      onWheel={onWheel}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={() => zoomable && applyZoom(zoom > 1 ? 1 : 2)}
    >
      <div
        className="relative mx-auto h-full"
        style={{
          aspectRatio: `${width} / ${height}`,
          transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
          transition: pointers.current.size ? "none" : "transform 0.25s cubic-bezier(0.22,1,0.36,1)",
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- blob URLs locales del operario */}
        <img
          src={src || "/placeholder.svg"}
          alt={alt}
          draggable={false}
          className={cn("absolute inset-0 size-full select-none object-contain transition-opacity", scanning && "opacity-40")}
        />
        <canvas ref={canvasRef} className="pointer-events-none absolute inset-0 size-full" aria-hidden />
        {scanning && (
          <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
            <div className="h-[12%] w-full animate-scan bg-gradient-to-b from-transparent via-level/40 to-transparent" />
          </div>
        )}
      </div>
      {scanning && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <span className="material rounded-full px-4 py-2 font-mono text-sm text-foreground">Inspeccionando…</span>
        </div>
      )}
      {zoomable && !scanning && (
        <div className="material absolute bottom-3 right-3 flex items-center gap-0.5 rounded-full border border-border p-1">
          <button
            type="button"
            onClick={() => applyZoom(zoom / 1.4)}
            className="flex size-9 items-center justify-center rounded-full text-foreground hover:bg-elevated disabled:opacity-40"
            aria-label="Alejar"
            disabled={zoom <= 1}
          >
            <Minus className="size-4" />
          </button>
          <span className="w-12 text-center font-mono text-xs tabular-nums text-muted-foreground">{zoom.toFixed(1)}×</span>
          <button
            type="button"
            onClick={() => applyZoom(zoom * 1.4)}
            className="flex size-9 items-center justify-center rounded-full text-foreground hover:bg-elevated disabled:opacity-40"
            aria-label="Acercar"
            disabled={zoom >= 4}
          >
            <Plus className="size-4" />
          </button>
          {zoom > 1 && (
            <button
              type="button"
              onClick={() => applyZoom(1)}
              className="flex size-9 items-center justify-center rounded-full text-foreground hover:bg-elevated"
              aria-label="Restablecer zoom"
            >
              <RotateCcw className="size-4" />
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export function LayerToggles({ layers, onChange }: { layers: Set<Layer>; onChange: (l: Set<Layer>) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5" role="group" aria-label="Capas del overlay">
      {ALL_LAYERS.map((l) => {
        const on = layers.has(l);
        return (
          <button
            key={l}
            type="button"
            aria-pressed={on}
            onClick={() => {
              const n = new Set(layers);
              if (on) n.delete(l);
              else n.add(l);
              onChange(n);
            }}
            className={cn(
              "flex h-8 items-center gap-1.5 rounded-full border px-3 font-mono text-xs transition-colors",
              on ? "border-border bg-elevated text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            <span
              className="size-2 rounded-full"
              style={{ backgroundColor: on ? LAYER_COLOR[l] : "transparent", boxShadow: `inset 0 0 0 1.5px ${LAYER_COLOR[l]}` }}
              aria-hidden
            />
            {l}
          </button>
        );
      })}
    </div>
  );
}

export { CAP_LABELS };
