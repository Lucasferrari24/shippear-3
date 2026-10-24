import { CircleAlert, CircleCheck, CircleX, Loader2, OctagonAlert, Clock } from "lucide-react";
import { cn } from "cn";
import { CATEGORY_COLOR, CATEGORY_LABELS, CATEGORY_SHORT, MODEL_DOT, MODEL_LABELS } from "@/lib/labels";
import type { BottleCategory, BottleModel, Item } from "@/lib/types";

export type BadgeKind = "OK" | "NOK" | "REVIEW" | "ERROR" | "QUEUED" | "RUNNING";

const BADGE: Record<BadgeKind, { label: string; color: string; Icon: typeof CircleCheck }> = {
  OK: { label: "OK", color: "var(--ok)", Icon: CircleCheck },
  NOK: { label: "NOK", color: "var(--nok)", Icon: CircleX },
  REVIEW: { label: "Revisar", color: "var(--review)", Icon: CircleAlert },
  ERROR: { label: "ERROR", color: "var(--process)", Icon: OctagonAlert },
  QUEUED: { label: "En cola", color: "var(--process)", Icon: Clock },
  RUNNING: { label: "Analizando", color: "var(--foreground)", Icon: Loader2 },
};

export function badgeKind(it: Item): BadgeKind {
  if (it.status === "pending") return "QUEUED";
  if (it.status === "running") return "RUNNING";
  if (it.status === "error" || !it.result) return "ERROR";
  const cat = it.result.verdict.bottle.category;
  if (cat === "INDETERMINADO") return "REVIEW";
  return it.result.verdict.status;
}

export function VerdictBadge({ kind, size = "sm", className }: { kind: BadgeKind; size?: "sm" | "md"; className?: string }) {
  const { label, color, Icon } = BADGE[kind];
  const busy = kind === "QUEUED" || kind === "RUNNING";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full font-semibold backdrop-blur-md",
        size === "sm" ? "h-6 px-2 text-[11px]" : "h-8 px-3 text-sm",
        busy && "animate-pulse",
        className,
      )}
      style={{ color, backgroundColor: `color-mix(in srgb, ${color} 18%, rgb(0 0 0 / 0.6))` }}
    >
      <Icon className={cn(size === "sm" ? "size-3.5" : "size-4", kind === "RUNNING" && "animate-spin")} aria-hidden />
      {label}
    </span>
  );
}

export function CategoryChip({
  category,
  short,
  className,
}: {
  category: BottleCategory;
  short?: boolean;
  className?: string;
}) {
  const color = CATEGORY_COLOR[category];
  return (
    <span
      className={cn("inline-flex h-7 items-center gap-1.5 rounded-full px-3 text-xs font-medium", className)}
      style={{ color, backgroundColor: `color-mix(in srgb, ${color} 14%, transparent)` }}
    >
      <span className="size-1.5 rounded-full" style={{ backgroundColor: color }} aria-hidden />
      {short ? CATEGORY_SHORT[category] : CATEGORY_LABELS[category]}
    </span>
  );
}

export function ModelChip({ model, className }: { model: BottleModel; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex h-7 items-center gap-1.5 rounded-full border border-border bg-secondary/60 px-2.5 text-xs font-medium text-foreground",
        className,
      )}
    >
      <span className="size-2 rounded-full" style={{ backgroundColor: MODEL_DOT[model] }} aria-hidden />
      {MODEL_LABELS[model]}
    </span>
  );
}
