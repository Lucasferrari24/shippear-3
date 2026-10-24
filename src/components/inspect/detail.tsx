"use client";

import { useState } from "react";
import { Database, Quote, RefreshCw, TriangleAlert } from "lucide-react";
import { cn } from "cn";
import { DEFECT_DOMAIN, DEFECT_LABELS, SAMPLE_LABELS } from "@/lib/labels";
import { useStore } from "@/lib/store";
import type { Item } from "@/lib/types";
import { CapCard, LevelCard } from "@/components/qc/cards";
import { CategoryChip, ModelChip, VerdictBadge, badgeKind } from "@/components/qc/chips";
import { ALL_LAYERS, LayerToggles, Overlay, type Layer } from "@/components/qc/overlay";
import { Ring } from "@/components/qc/motion-bits";

const DOMAIN_COLOR = { cap: "var(--cap)", level: "var(--level)", process: "var(--process)" } as const;

export function Detail({ item, className }: { item: Item; className?: string }) {
  const { retry } = useStore();
  const [layers, setLayers] = useState<Set<Layer>>(() => new Set(ALL_LAYERS));
  const r = item.result;
  const v = r?.verdict;
  const busy = item.status === "pending" || item.status === "running";

  return (
    <article className={cn("flex flex-col gap-4", className)} aria-label={`Detalle de ${item.name}`}>
      <div className="relative overflow-hidden rounded-3xl border border-border">
        <Overlay
          src={item.src}
          width={item.width}
          height={item.height}
          reading={r?.reading}
          verdict={v}
          layers={layers}
          scanning={busy}
          alt={`Foto de ${item.name}`}
          className="aspect-[3/4] max-h-[62vh] w-full"
        />
        <div className="pointer-events-none absolute left-3 top-3">
          <VerdictBadge kind={badgeKind(item)} size="md" />
        </div>
      </div>

      {r && v && <LayerToggles layers={layers} onChange={setLayers} />}

      <header className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-3">
          <h2 className="truncate font-mono text-sm text-muted-foreground">{item.name}</h2>
          {r && (
            <span className="shrink-0 font-mono text-xs tabular-nums text-muted-foreground">
              {(r.latencyMs / 1000).toFixed(1)} s · {r.model}
            </span>
          )}
        </div>
        {r && v && (
          <div className="flex flex-wrap items-center gap-2">
            <CategoryChip category={v.bottle.category} />
            <ModelChip model={r.reading.bottle_model} />
            <span className="font-mono text-xs text-muted-foreground">{v.bottle.code}</span>
          </div>
        )}
      </header>

      {item.status === "error" && (
        <div className="flex flex-col gap-3 rounded-3xl border border-border bg-card p-4" role="alert">
          <p className="flex items-start gap-2 text-sm text-foreground">
            <TriangleAlert className="mt-0.5 size-4 shrink-0 text-nok" aria-hidden />
            {item.error ?? "Error HTTP 500"}
          </p>
          <button
            type="button"
            onClick={() => retry(item.key)}
            className="flex h-11 items-center justify-center gap-2 rounded-full bg-foreground px-4 text-sm font-semibold text-background"
          >
            <RefreshCw className="size-4" aria-hidden />
            Reintentar
          </button>
        </div>
      )}

      {r && v && (
        <>
          <div className="grid grid-cols-2 gap-3">
            <CapCard cap={r.reading.cap_state} gap={r.reading.cap_gap_px} />
            <LevelCard fraction={v.levelFraction} band={v.band} status={v.bottle.level} />
          </div>

          {v.defects.length > 0 && (
            <ul className="flex flex-col gap-1.5" aria-label="Defectos">
              {v.defects.map((d) => (
                <li key={d} className="flex items-center gap-2.5 rounded-2xl bg-card px-3.5 py-2.5 text-sm text-foreground">
                  <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: DOMAIN_COLOR[DEFECT_DOMAIN[d]] }} aria-hidden />
                  {DEFECT_LABELS[d]}
                </li>
              ))}
            </ul>
          )}

          <figure className="flex gap-3 rounded-3xl border border-border bg-card p-4">
            <Quote className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
            <div className="flex min-w-0 flex-1 flex-col gap-3">
              <blockquote className="text-pretty text-sm leading-relaxed text-foreground">{r.reading.evidence}</blockquote>
              <figcaption className="flex items-center gap-2.5">
                <Ring
                  value={r.reading.confidence}
                  size={28}
                  stroke={3.5}
                  color={r.reading.confidence < 0.7 ? "var(--review)" : "var(--ok)"}
                  label={`Confianza ${Math.round(r.reading.confidence * 100)}%`}
                />
                <span className="text-xs text-muted-foreground">
                  Confianza del maestro{" "}
                  <span className="font-mono tabular-nums text-foreground">{r.reading.confidence.toFixed(2)}</span>
                </span>
              </figcaption>
            </div>
          </figure>

          {item.feedback && (
            <div className="flex items-center gap-3 rounded-3xl bg-dataset/10 px-4 py-3">
              <Database className="size-4 shrink-0 text-dataset" aria-hidden />
              <p className="text-sm text-foreground">
                Muestra <span className="text-dataset">{SAMPLE_LABELS[item.feedback.sample.status]}</span>
                {item.feedback.sample.labelClass && (
                  <>
                    {" · "}
                    <span className="font-mono text-xs">{item.feedback.sample.labelClass}</span>
                  </>
                )}
                {item.feedback.sample.reason && (
                  <span className="block text-xs text-muted-foreground">{item.feedback.sample.reason}</span>
                )}
              </p>
            </div>
          )}
        </>
      )}
    </article>
  );
}

export function DetailEmpty() {
  return (
    <div className="flex aspect-[3/4] max-h-[62vh] flex-col items-center justify-center gap-2 rounded-3xl border border-dashed border-border px-8 text-center">
      <p className="font-medium text-foreground">Elegí una botella</p>
      <p className="text-pretty text-sm leading-relaxed text-muted-foreground">
        Tocá una foto del lote para ver la medición sobre la imagen.
      </p>
    </div>
  );
}
