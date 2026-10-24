"use client";

import { useState } from "react";
import useSWR from "swr";
import { toast } from "sonner";
import { Check, Layers, X } from "lucide-react";
import { cn } from "cn";
import { PageHeader } from "@/components/shell/app-shell";
import { ReviewCard } from "@/components/qc/review-card";
import { ALL_LAYERS, Overlay } from "@/components/qc/overlay";
import { Skeleton } from "@/components/qc/motion-bits";
import { getDataset, reviewSample, judge, bandKey } from "@/lib/api";
import { DATASET_CLASSES, MODEL_LABELS, SAMPLE_LABELS } from "@/lib/labels";
import { useStore } from "@/lib/store";
import type { DatasetClass, ReviewSample } from "@/lib/types";

function Editor({ sample, onDone }: { sample: ReviewSample; onDone: () => void }) {
  const { bands } = useStore();
  const [cls, setCls] = useState<DatasetClass | null>(sample.proposedClass);
  const [reviewer, setReviewer] = useState("");
  const [busy, setBusy] = useState(false);
  const verdict = judge(sample.reading, bands[bandKey(sample.reading.bottle_model)]);

  const act = async (action: "approve" | "reject") => {
    setBusy(true);
    try {
      await reviewSample({ id: sample.id, action, labelClass: cls, reviewer });
      toast.success(action === "approve" ? `Aprobada como ${cls}` : "Muestra rechazada");
      onDone();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="overflow-hidden rounded-3xl border border-border">
        <Overlay
          src={sample.src}
          width={sample.width}
          height={sample.height}
          reading={sample.reading}
          verdict={verdict}
          layers={new Set(ALL_LAYERS)}
          alt="Muestra a revisar"
          className="aspect-[3/4] max-h-[52vh] w-full"
        />
      </div>
      <p className="text-pretty text-sm leading-relaxed text-muted-foreground">{sample.reading.evidence}</p>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-xs text-muted-foreground">Clase</legend>
        <div className="flex flex-wrap gap-2">
          {DATASET_CLASSES.map((c) => (
            <button
              key={c}
              type="button"
              aria-pressed={cls === c}
              onClick={() => setCls(c)}
              className={cn(
                "h-9 rounded-full px-3.5 font-mono text-xs transition-colors",
                cls === c ? "bg-dataset text-background" : "bg-elevated text-foreground hover:bg-elevated/70",
              )}
            >
              {c}
            </button>
          ))}
        </div>
      </fieldset>
      <label className="flex flex-col gap-1.5">
        <span className="text-xs text-muted-foreground">Revisor</span>
        <input
          value={reviewer}
          onChange={(e) => setReviewer(e.target.value)}
          placeholder="Tu nombre"
          className="h-11 rounded-2xl border border-input bg-surface px-3 text-base text-foreground placeholder:text-muted-foreground"
        />
      </label>
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => act("reject")}
          className="flex h-12 items-center justify-center gap-2 rounded-full bg-elevated text-sm font-semibold text-foreground disabled:opacity-50"
        >
          <X className="size-4" aria-hidden />
          Rechazar
        </button>
        <button
          type="button"
          disabled={busy || !cls}
          onClick={() => act("approve")}
          className="flex h-12 items-center justify-center gap-2 rounded-full bg-dataset text-sm font-semibold text-background disabled:opacity-50"
        >
          <Check className="size-4" aria-hidden />
          Aprobar
        </button>
      </div>
    </div>
  );
}

export default function DatasetPage() {
  const { data, isLoading, mutate } = useSWR("dataset", getDataset);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = data?.pending.find((s) => s.id === selectedId) ?? data?.pending[0] ?? null;

  return (
    <>
      <PageHeader
        title="Dataset"
        subtitle="Cola de revisión priorizada: primero los desacuerdos entre maestro y modelo local."
        color="var(--dataset)"
        icon={Layers}
      />

      {data && (
        <section className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4" aria-label="Estado del dataset">
          {(Object.keys(data.summary.counts) as (keyof typeof data.summary.counts)[]).map((k) => (
            <div key={k} className="flex flex-col gap-1 rounded-3xl border border-border bg-card p-4">
              <span className="text-xs capitalize text-muted-foreground">{SAMPLE_LABELS[k]}</span>
              <span className="font-mono text-2xl font-semibold tabular-nums text-foreground">{data.summary.counts[k]}</span>
            </div>
          ))}
        </section>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_420px]">
        <section className="flex flex-col gap-2" aria-label="Pendientes">
          {isLoading && Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-28 rounded-3xl" />)}
          {data?.pending.length === 0 && (
            <p className="rounded-3xl border border-border bg-card p-8 text-center text-sm text-muted-foreground">
              No hay muestras pendientes.
            </p>
          )}
          {data?.pending.map((s) => (
            <ReviewCard key={s.id} sample={s} active={s.id === selected?.id} onSelect={() => setSelectedId(s.id)} />
          ))}
        </section>
        <aside className="lg:sticky lg:top-20 lg:self-start">
          {selected ? (
            <Editor
              key={selected.id}
              sample={selected}
              onDone={() => {
                setSelectedId(null);
                void mutate();
              }}
            />
          ) : (
            !isLoading && null
          )}
        </aside>
      </div>

      {data && (
        <section className="mt-8 flex flex-col gap-3" aria-label="Cobertura">
          <h2 className="text-lg font-semibold tracking-tight text-foreground">Cobertura aprobada por clase</h2>
          <div className="overflow-x-auto rounded-3xl border border-border bg-card">
            <table className="w-full min-w-[560px] text-sm">
              <thead>
                <tr className="text-left text-xs text-muted-foreground">
                  <th className="px-4 py-3 font-normal">Modelo</th>
                  {DATASET_CLASSES.map((c) => (
                    <th key={c} className="px-4 py-3 font-mono font-normal">
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(["clasico", "stevia"] as const).map((m) => (
                  <tr key={m} className="border-t border-border">
                    <th scope="row" className="px-4 py-3 text-left font-medium text-foreground">
                      {MODEL_LABELS[m]}
                    </th>
                    {DATASET_CLASSES.map((c) => {
                      const n = data.summary.coverage[m][c];
                      return (
                        <td key={c} className={cn("px-4 py-3 font-mono tabular-nums", n < 5 ? "text-review" : "text-foreground")}>
                          {n}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-muted-foreground">En amarillo, clases con menos de 5 muestras.</p>
        </section>
      )}
    </>
  );
}
