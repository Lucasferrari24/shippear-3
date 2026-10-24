"use client";

import { Database, Info } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { PageHeader } from "@/components/shell/app-shell";
import { SAMPLE_LABELS } from "@/lib/labels";
import { useStore } from "@/lib/store";

export default function RecoleccionPage() {
  const { collect, setCollect, items } = useStore();
  const withFeedback = items.filter((i) => i.feedback);
  const disagree = withFeedback.filter((i) => i.feedback!.comparison.outcome === "disagree").length;

  return (
    <>
      <PageHeader
        title="Modo recolección"
        subtitle="Cada inspección también se guarda como muestra candidata para entrenar el modelo local."
        color="var(--dataset)"
        icon={Database}
      />
      <div className="flex max-w-3xl flex-col gap-4">
        <label className="flex items-center justify-between gap-4 rounded-3xl border border-border bg-card p-5">
          <span className="flex flex-col gap-1">
            <span className="text-base font-semibold text-foreground">Recolectar muestras</span>
            <span className="text-sm leading-relaxed text-muted-foreground">
              Envía foto, lectura del maestro y veredicto a la cola de revisión.
            </span>
          </span>
          <Switch
            checked={collect}
            onCheckedChange={setCollect}
            className="data-[state=checked]:bg-dataset"
            aria-label="Recolectar muestras"
          />
        </label>

        <p className="flex items-start gap-2.5 rounded-3xl bg-elevated/50 px-4 py-3 text-sm leading-relaxed text-muted-foreground">
          <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
          Solo funciona corriendo en local: las fotos se guardan en disco y en producción no hay almacenamiento persistente.
        </p>

        <section className="grid grid-cols-3 gap-3" aria-label="Este lote">
          {[
            { label: "Enviadas", value: withFeedback.length, color: "var(--dataset)" },
            { label: "Desacuerdos", value: disagree, color: "var(--review)" },
            { label: "En el lote", value: items.length, color: "var(--foreground)" },
          ].map((s) => (
            <div key={s.label} className="flex flex-col gap-1 rounded-3xl border border-border bg-card p-4">
              <span className="text-xs text-muted-foreground">{s.label}</span>
              <span className="font-mono text-2xl font-semibold tabular-nums" style={{ color: s.color }}>
                {s.value}
              </span>
            </div>
          ))}
        </section>

        {withFeedback.length > 0 && (
          <ul className="flex flex-col divide-y divide-border overflow-hidden rounded-3xl border border-border bg-card">
            {withFeedback.map((i) => (
              <li key={i.key} className="flex items-center justify-between gap-3 px-4 py-3">
                <span className="truncate font-mono text-xs text-foreground">{i.name}</span>
                <span className="shrink-0 text-xs text-dataset">{SAMPLE_LABELS[i.feedback!.sample.status]}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}
