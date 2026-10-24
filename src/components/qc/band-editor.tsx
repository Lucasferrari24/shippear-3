"use client";

import { RotateCcw, TriangleAlert } from "lucide-react";
import { Slider } from "@/components/ui/slider";
import { DEFAULT_BAND } from "@/lib/judge";
import { MODEL_DOT, MODEL_LABELS, pct } from "@/lib/labels";
import type { LevelBand } from "@/lib/types";

type Point = { key: string; fraction: number };

const r2 = (n: number) => Math.round(n * 100) / 100;

export function BandEditor({
  model,
  band,
  points,
  onChange,
  onReset,
}: {
  model: "clasico" | "stevia";
  band: LevelBand;
  points: Point[];
  onChange: (b: LevelBand) => void;
  onReset: () => void;
}) {
  const invalid = band.min >= band.max;
  const inside = points.filter((p) => p.fraction >= band.min && p.fraction <= band.max).length;
  const H = 280;

  return (
    <section className="flex flex-col gap-5 rounded-3xl border border-border bg-card p-5 md:p-6">
      <header className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="size-2.5 rounded-full" style={{ backgroundColor: MODEL_DOT[model] }} aria-hidden />
          <h2 className="text-lg font-semibold tracking-tight text-foreground">{MODEL_LABELS[model]}</h2>
        </div>
        <span className="font-mono text-xs tabular-nums text-muted-foreground">
          {inside}/{points.length} dentro
        </span>
      </header>

      <div className="flex items-stretch gap-6">
        <div className="relative flex shrink-0 items-stretch gap-4" style={{ height: H }}>
          <div className="relative w-24" aria-hidden>
            <div className="absolute left-1/2 top-0 h-[8%] w-10 -translate-x-1/2 rounded-t-lg bg-elevated" />
            <div className="absolute inset-x-0 bottom-0 top-[8%] overflow-hidden rounded-[22px] border border-border bg-surface">
              <div
                className="absolute inset-x-0 bg-level/15"
                style={{ top: `${((band.min - 0.08) / 0.92) * 100}%`, height: `${((band.max - band.min) / 0.92) * 100}%` }}
              />
            </div>
            {points.map((p) => {
              const ok = p.fraction >= band.min && p.fraction <= band.max;
              return (
                <span
                  key={p.key}
                  className="absolute size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-surface"
                  style={{
                    top: `${Math.min(1, Math.max(0, p.fraction)) * 100}%`,
                    left: `${30 + ((p.key.length * 37 + p.key.charCodeAt(p.key.length - 1) * 13) % 40)}%`,
                    backgroundColor: ok ? "var(--ok)" : "var(--nok)",
                  }}
                />
              );
            })}
            <div className="absolute inset-x-0 border-t border-dashed border-level" style={{ top: `${band.min * 100}%` }} />
            <div className="absolute inset-x-0 border-t border-dashed border-level" style={{ top: `${band.max * 100}%` }} />
          </div>
          <Slider
            orientation="vertical"
            inverted
            min={0}
            max={1}
            step={0.01}
            value={[band.min, band.max]}
            minStepsBetweenThumbs={1}
            onValueChange={([a, b]) => onChange({ min: r2(a), max: r2(b) })}
            className="[&_[data-slot=slider-range]]:bg-level [&_[data-slot=slider-thumb]]:size-5 [&_[data-slot=slider-thumb]]:border-level"
            aria-label={`Banda de ${MODEL_LABELS[model]}`}
          />
        </div>

        <div className="flex min-w-0 flex-1 flex-col justify-between gap-4">
          <div className="flex flex-col gap-3">
            {(["min", "max"] as const).map((k) => (
              <label key={k} className="flex flex-col gap-1.5">
                <span className="text-xs text-muted-foreground">
                  {k === "min" ? "Mínimo (más lleno)" : "Máximo (menos lleno)"}
                </span>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min={0}
                    max={1}
                    step={0.01}
                    value={band[k]}
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      if (!Number.isNaN(v)) onChange({ ...band, [k]: r2(Math.min(1, Math.max(0, v))) });
                    }}
                    className="h-11 w-full min-w-0 rounded-2xl border border-input bg-surface px-3 font-mono text-base tabular-nums text-foreground focus-visible:border-level"
                  />
                  <span className="w-14 shrink-0 text-right font-mono text-sm tabular-nums text-level">{pct(band[k], 0)}</span>
                </div>
              </label>
            ))}
          </div>

          {invalid && (
            <p className="flex items-center gap-2 rounded-2xl bg-review/10 px-3 py-2 text-sm text-review" role="alert">
              <TriangleAlert className="size-4 shrink-0" aria-hidden />
              El mínimo tiene que ser menor que el máximo.
            </p>
          )}

          <button
            type="button"
            onClick={onReset}
            className="flex h-11 items-center justify-center gap-2 rounded-full border border-border bg-elevated px-4 text-sm font-medium text-foreground hover:bg-elevated/70"
          >
            <RotateCcw className="size-4" aria-hidden />
            Restablecer ({Math.round(DEFAULT_BAND.min * 100)}–{Math.round(DEFAULT_BAND.max * 100)} %)
          </button>
        </div>
      </div>
    </section>
  );
}
