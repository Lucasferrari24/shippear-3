"use client";

import useSWR from "swr";
import { Cpu } from "lucide-react";
import { PageHeader } from "@/components/shell/app-shell";
import { Ring, Skeleton } from "@/components/qc/motion-bits";
import { getModelHealth } from "@/lib/api";

const OUTCOMES = [
  { key: "agree", label: "Coinciden", color: "var(--ok)" },
  { key: "disagree", label: "Desacuerdo", color: "var(--review)" },
  { key: "teacher_only", label: "Solo maestro", color: "var(--process)" },
] as const;

export default function ModeloPage() {
  const { data } = useSWR("model-health", getModelHealth);

  return (
    <>
      <PageHeader
        title="Salud del modelo"
        subtitle="Cuánto coincide el modelo local con el maestro, versión por versión."
        color="var(--dataset)"
        icon={Cpu}
      />
      {!data ? (
        <Skeleton className="h-64 rounded-3xl" />
      ) : (
        <div className="flex flex-col gap-4">
          <section className="flex flex-col gap-2 rounded-3xl border border-border bg-card p-5">
            <div className="flex items-center justify-between gap-3">
              <h2 className="font-semibold text-foreground">{data.local.name}</h2>
              <span className="inline-flex h-7 items-center gap-1.5 rounded-full bg-elevated px-2.5 text-xs text-muted-foreground">
                <span className="size-1.5 rounded-full bg-process" aria-hidden />
                {data.local.integrated ? "Integrado" : "No integrado"}
              </span>
            </div>
            <p className="text-sm leading-relaxed text-muted-foreground">
              Hoy todas las inspecciones las resuelve el maestro. Cuando el modelo local esté integrado, sus lecturas se comparan contra el maestro y los desacuerdos van primero a la cola de revisión.
            </p>
          </section>

          <section className="grid grid-cols-3 gap-3" aria-label="Comparaciones">
            {OUTCOMES.map((o) => (
              <div key={o.key} className="flex flex-col gap-1 rounded-3xl border border-border bg-card p-4">
                <span className="text-xs text-muted-foreground">{o.label}</span>
                <span className="font-mono text-2xl font-semibold tabular-nums" style={{ color: o.color }}>
                  {data.outcomes[o.key]}
                </span>
              </div>
            ))}
          </section>

          <section className="grid gap-3 md:grid-cols-2" aria-label="Versiones">
            {data.agreement.map((v) => (
              <article key={v.version} className="flex flex-col gap-4 rounded-3xl border border-border bg-card p-5">
                <header className="flex items-center justify-between">
                  <h3 className="font-mono text-sm text-foreground">{v.version}</h3>
                  <span className="font-mono text-xs tabular-nums text-muted-foreground">{v.compared} comparadas</span>
                </header>
                <div className="flex flex-wrap gap-5">
                  {[
                    { label: "Veredicto", value: v.verdict_match, color: "var(--ok)" },
                    { label: "Tapa", value: v.cap_match, color: "var(--cap)" },
                    { label: "IoU botella", value: v.bottle_iou, color: "var(--line-fg)" },
                    { label: "IoU tapa", value: v.cap_iou, color: "var(--dataset)" },
                  ].map((m) => (
                    <div key={m.label} className="flex flex-col items-center gap-1.5">
                      <Ring value={m.value} size={56} stroke={5} color={m.color} label={`${m.label} ${Math.round(m.value * 100)}%`}>
                        <span className="font-mono text-xs font-semibold tabular-nums text-foreground">{Math.round(m.value * 100)}</span>
                      </Ring>
                      <span className="text-xs text-muted-foreground">{m.label}</span>
                    </div>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">
                  Error medio de nivel{" "}
                  <span className="font-mono tabular-nums text-level">{(v.level_delta * 100).toFixed(1)} pp</span>
                </p>
              </article>
            ))}
          </section>
        </div>
      )}
    </>
  );
}
