"use client";

import { motion, useReducedMotion } from "motion/react";
import { ImageOff } from "lucide-react";
import { cn } from "cn";
import { CATEGORY_COLOR, CATEGORY_SHORT, MODEL_DOT } from "@/lib/labels";
import { itemBucket, useStore } from "@/lib/store";
import type { Item } from "@/lib/types";
import { VerdictBadge, badgeKind } from "@/components/qc/chips";

function Tile({ item, active, onSelect, index }: { item: Item; active: boolean; onSelect: () => void; index: number }) {
  const reduce = useReducedMotion();
  const kind = badgeKind(item);
  const cat = item.result?.verdict.bottle.category;
  const busy = item.status === "pending" || item.status === "running";
  return (
    <motion.li
      layout={!reduce}
      initial={reduce ? false : { opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay: Math.min(index, 12) * 0.03, ease: [0.22, 1, 0.36, 1] }}
    >
      <button
        type="button"
        onClick={onSelect}
        aria-pressed={active}
        aria-label={`${item.name}, ${cat ? CATEGORY_SHORT[cat] : kind}`}
        className={cn(
          "group relative block aspect-[3/4] w-full overflow-hidden rounded-3xl bg-surface outline-offset-2 transition-transform active:scale-[0.98]",
          active && "ring-2 ring-foreground",
        )}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={item.src || "/placeholder.svg"}
          alt=""
          loading="lazy"
          className={cn(
            "size-full object-cover transition-[transform,opacity] duration-500 group-hover:scale-[1.03]",
            busy && "opacity-40",
            item.status === "error" && "opacity-30 grayscale",
          )}
        />
        {item.status === "running" && (
          <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
            <div className="h-1/5 w-full animate-scan bg-gradient-to-b from-transparent via-level/40 to-transparent" />
          </div>
        )}
        {item.status === "error" && (
          <ImageOff className="absolute left-1/2 top-1/2 size-7 -translate-x-1/2 -translate-y-1/2 text-muted-foreground" aria-hidden />
        )}
        <div className="absolute inset-x-0 top-0 flex items-start justify-between gap-1 p-2">
          <VerdictBadge kind={kind} />
          {item.result && (
            <span
              className="size-2.5 rounded-full ring-2 ring-black/40"
              style={{ backgroundColor: MODEL_DOT[item.result.reading.bottle_model] }}
              aria-hidden
            />
          )}
        </div>
        <div className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-2 bg-gradient-to-t from-black/85 via-black/40 to-transparent px-3 pb-2.5 pt-8">
          <span className="truncate font-mono text-[11px] text-foreground/80">{item.name.replace(/\.\w+$/, "")}</span>
          {cat && cat !== "OK" && (
            <span className="shrink-0 text-[11px] font-semibold" style={{ color: CATEGORY_COLOR[cat] }}>
              {CATEGORY_SHORT[cat]}
            </span>
          )}
        </div>
      </button>
    </motion.li>
  );
}

export function LoteGrid({ onOpen }: { onOpen: (key: string) => void }) {
  const { items, filter, selectedKey } = useStore();
  const visible = filter === "all" ? items : items.filter((i) => itemBucket(i) === filter);

  if (!items.length) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-3xl border border-border bg-card px-6 py-16 text-center">
        <p className="text-lg font-semibold text-foreground">El lote está vacío</p>
        <p className="max-w-sm text-pretty text-sm leading-relaxed text-muted-foreground">
          Sacá una foto o subí varias para que el maestro las inspeccione.
        </p>
      </div>
    );
  }

  return (
    <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-3 xl:grid-cols-4" aria-label="Lote">
      {visible.map((it, i) => (
        <Tile key={it.key} item={it} index={i} active={it.key === selectedKey} onSelect={() => onOpen(it.key)} />
      ))}
    </ul>
  );
}
