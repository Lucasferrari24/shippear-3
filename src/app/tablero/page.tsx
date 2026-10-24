"use client";

import { useState } from "react";
import useSWR from "swr";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { ChartArea } from "lucide-react";
import { cn } from "cn";
import { PageHeader } from "@/components/shell/app-shell";
import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { StateMatrix } from "@/components/qc/state-matrix";
import { Skeleton } from "@/components/qc/motion-bits";
import { getLineDashboard, getLines } from "@/lib/api";

const RANGES = [7, 14, 30] as const;

const categoryConfig = {
  OK: { label: "OK", color: "var(--ok)" },
  ERROR_TAPA: { label: "Tapa", color: "var(--cap)" },
  ERROR_NIVEL: { label: "Nivel", color: "var(--level)" },
  ERROR_COMBINADO: { label: "Combinado", color: "var(--nok)" },
  INDETERMINADO: { label: "Revisar", color: "var(--review)" },
} satisfies ChartConfig;

const defectConfig = {
  CAP_MISALIGNED: { label: "Tapa mal colocada", color: "var(--cap)" },
  CAP_OPEN: { label: "Tapa abierta", color: "var(--cap-open)" },
  CAP_MISSING: { label: "Sin tapa", color: "var(--nok)" },
  LEVEL_LOW: { label: "Nivel bajo", color: "var(--level)" },
  LEVEL_HIGH: { label: "Nivel alto", color: "var(--line-fg)" },
  LEVEL_NOT_FOUND: { label: "Nivel no medido", color: "var(--review)" },
} satisfies ChartConfig;

const shortDay = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit" });

function Segmented<T extends string | number>({
  options,
  value,
  onChange,
  label,
  format = String,
}: {
  options: readonly T[];
  value: T;
  onChange: (v: T) => void;
  label: string;
  format?: (v: T) => string;
}) {
  return (
    <div role="group" aria-label={label} className="flex rounded-full bg-elevated/70 p-1">
      {options.map((o) => (
        <button
          key={String(o)}
          type="button"
          aria-pressed={o === value}
          onClick={() => onChange(o)}
          className={cn(
            "h-8 rounded-full px-3.5 text-sm font-medium transition-colors",
            o === value ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {format(o)}
        </button>
      ))}
    </div>
  );
}

export default function TableroPage() {
  const { data: lines } = useSWR("lines", getLines);
  const [line, setLine] = useState("Línea 1");
  const [range, setRange] = useState<(typeof RANGES)[number]>(14);
  const { data, isLoading } = useSWR(["line", line, range], () => getLineDashboard(line, range));

  const totals = data?.daily.reduce(
    (a, r) => ({ total: a.total + r.total, ok: a.ok + r.ok, nok: a.nok + r.nok, ms: a.ms + r.avg_ms }),
    { total: 0, ok: 0, nok: 0, ms: 0 },
  );

  return (
    <>
      <PageHeader title="Tablero de línea" subtitle="Producción, defectos y combinaciones tapa por nivel." color="var(--line-fg)" icon={ChartArea}>
        <div className="flex flex-wrap gap-2">
          <Segmented options={lines ?? ["Línea 1"]} value={line} onChange={setLine} label="Línea" />
          <Segmented options={RANGES} value={range} onChange={setRange} label="Rango" format={(d) => `${d} d`} />
        </div>
      </PageHeader>

      {isLoading || !data || !totals ? (
        <div className="grid gap-4">
          <Skeleton className="h-24 rounded-3xl" />
          <Skeleton className="h-72 rounded-3xl" />
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <section className="grid grid-cols-2 gap-3 md:grid-cols-4" aria-label="Indicadores">
            {[
              { label: "Botellas", value: totals.total.toLocaleString("es-AR"), color: "var(--foreground)" },
              { label: "Rendimiento", value: `${((totals.ok / totals.total) * 100).toFixed(1)}%`, color: "var(--ok)" },
              { label: "Rechazos", value: totals.nok.toLocaleString("es-AR"), color: "var(--nok)" },
              { label: "Latencia media", value: `${(totals.ms / data.daily.length / 1000).toFixed(1)} s`, color: "var(--line-fg)" },
            ].map((k) => (
              <div key={k.label} className="flex flex-col gap-1 rounded-3xl border border-border bg-card p-4">
                <span className="text-xs text-muted-foreground">{k.label}</span>
                <span className="font-mono text-2xl font-semibold tabular-nums" style={{ color: k.color }}>
                  {k.value}
                </span>
              </div>
            ))}
          </section>

          <div className="grid gap-4 xl:grid-cols-2">
            <section className="flex flex-col gap-3 rounded-3xl border border-border bg-card p-4 md:p-5">
              <h2 className="font-semibold text-foreground">Rechazos por categoría</h2>
              <ChartContainer config={categoryConfig} className="aspect-auto h-64 w-full">
                <BarChart data={data.categories}>
                  <CartesianGrid vertical={false} />
                  <XAxis dataKey="day" tickFormatter={shortDay} tickLine={false} axisLine={false} minTickGap={16} />
                  <YAxis tickLine={false} axisLine={false} width={36} />
                  <ChartTooltip content={<ChartTooltipContent labelFormatter={(d) => shortDay(String(d))} />} />
                  <ChartLegend content={<ChartLegendContent />} />
                  {(["ERROR_TAPA", "ERROR_NIVEL", "ERROR_COMBINADO", "INDETERMINADO"] as const).map((k, i, arr) => (
                    <Bar key={k} dataKey={k} stackId="a" fill={`var(--color-${k})`} radius={i === arr.length - 1 ? [6, 6, 0, 0] : 0} />
                  ))}
                </BarChart>
              </ChartContainer>
            </section>

            <section className="flex flex-col gap-3 rounded-3xl border border-border bg-card p-4 md:p-5">
              <h2 className="font-semibold text-foreground">Defectos por tipo</h2>
              <ChartContainer config={defectConfig} className="aspect-auto h-64 w-full">
                <BarChart data={data.defects}>
                  <CartesianGrid vertical={false} />
                  <XAxis dataKey="day" tickFormatter={shortDay} tickLine={false} axisLine={false} minTickGap={16} />
                  <YAxis tickLine={false} axisLine={false} width={36} />
                  <ChartTooltip content={<ChartTooltipContent labelFormatter={(d) => shortDay(String(d))} />} />
                  {(Object.keys(defectConfig) as (keyof typeof defectConfig)[]).map((k, i, arr) => (
                    <Bar key={k} dataKey={k} stackId="d" fill={`var(--color-${k})`} radius={i === arr.length - 1 ? [6, 6, 0, 0] : 0} />
                  ))}
                </BarChart>
              </ChartContainer>
            </section>
          </div>

          <section className="flex flex-col gap-3 rounded-3xl border border-border bg-card p-4 md:p-5">
            <h2 className="font-semibold text-foreground">Mapa tapa por nivel</h2>
            <StateMatrix cells={data.matrix} />
          </section>
        </div>
      )}
    </>
  );
}
