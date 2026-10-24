"use client";

import { cn } from "cn";
import { CATEGORY_COLOR, CATEGORY_SHORT } from "@/lib/labels";
import { itemBucket, useStore, type Filter } from "@/lib/store";
import type { BottleCategory } from "@/lib/types";
import { NumberTicker, Ring } from "@/components/qc/motion-bits";

const CATS: BottleCategory[] = ["OK", "ERROR_TAPA", "ERROR_NIVEL", "ERROR_COMBINADO", "INDETERMINADO"];

export function LoteSummary() {
  const { items, filter, setFilter } = useStore();
  const counts = new Map<Exclude<Filter, "all">, number>();
  for (const it of items) {
    const b = itemBucket(it);
    counts.set(b, (counts.get(b) ?? 0) + 1);
  }
  const done = items.filter((i) => i.status === "done").length;
  const ok = counts.get("OK") ?? 0;
  const yieldRate = done ? ok / done : 0;
  const queue = counts.get("QUEUE") ?? 0;
  const errors = counts.get("ERROR") ?? 0;

  const chips: { key: Filter; label: string; color: string; count: number }[] = [
    { key: "all", label: "Todo", color: "var(--foreground)", count: items.length },
    ...CATS.map((c) => ({ key: c as Filter, label: CATEGORY_SHORT[c], color: CATEGORY_COLOR[c], count: counts.get(c) ?? 0 })),
    { key: "ERROR", label: "Error", color: "var(--process)", count: errors },
    { key: "QUEUE", label: "En cola", color: "var(--process)", count: queue },
  ];

  return (
    <section aria-label="Resumen del lote" className="flex flex-col gap-4">
      <div className="flex items-center gap-4 rounded-3xl border border-border bg-card p-4">
        <Ring value={yieldRate} size={64} stroke={6} color="var(--ok)" label={`Rendimiento ${Math.round(yieldRate * 100)}%`}>
          <span className="font-mono text-sm font-semibold tabular-nums text-foreground">{Math.round(yieldRate * 100)}%</span>
        </Ring>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="text-xs text-muted-foreground">Botellas analizadas</span>
          <span className="flex items-baseline gap-1.5">
            <NumberTicker value={done} className="text-3xl font-semibold text-foreground" />
            <span className="font-mono text-sm tabular-nums text-muted-foreground">/ {items.length}</span>
          </span>
        </div>
        <div className="hidden gap-6 sm:flex">
          {(["OK", "ERROR_TAPA", "ERROR_NIVEL", "ERROR_COMBINADO"] as const).map((c) => (
            <div key={c} className="flex flex-col gap-0.5">
              <span className="text-xs text-muted-foreground">{CATEGORY_SHORT[c]}</span>
              <NumberTicker value={counts.get(c) ?? 0} className="text-xl font-semibold" />
              <span className="h-0.5 w-6 rounded-full" style={{ backgroundColor: CATEGORY_COLOR[c] }} aria-hidden />
            </div>
          ))}
        </div>
      </div>

      <div className="-mx-4 overflow-x-auto px-4 [scrollbar-width:none] md:mx-0 md:px-0">
        <div className="flex w-max gap-2" role="group" aria-label="Filtrar lote">
          {chips.map((c) => {
            const active = filter === c.key;
            return (
              <button
                key={c.key}
                type="button"
                aria-pressed={active}
                onClick={() => setFilter(c.key)}
                disabled={c.key !== "all" && c.count === 0}
                className={cn(
                  "flex h-9 items-center gap-2 rounded-full px-3.5 text-sm font-medium transition-colors disabled:opacity-35",
                  active ? "bg-foreground text-background" : "bg-elevated/70 text-foreground hover:bg-elevated",
                )}
              >
                {c.key !== "all" && (
                  <span className="size-2 rounded-full" style={{ backgroundColor: c.color }} aria-hidden />
                )}
                {c.label}
                <span className={cn("font-mono text-xs tabular-nums", active ? "text-background/70" : "text-muted-foreground")}>
                  {c.count}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
}
