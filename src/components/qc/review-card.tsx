import { GitCompareArrows } from "lucide-react";
import { cn } from "cn";
import type { ReviewSample } from "@/lib/types";
import { ModelChip } from "./chips";

export function ReviewCard({
  sample,
  active,
  onSelect,
}: {
  sample: ReviewSample;
  active?: boolean;
  onSelect: () => void;
}) {
  const date = new Date(sample.createdAt).toLocaleString("es-AR", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={active}
      className={cn(
        "group flex w-full items-stretch gap-3 rounded-3xl border bg-card p-2.5 text-left transition-colors",
        active ? "border-dataset/60 bg-dataset/10" : "border-border hover:bg-elevated/60",
      )}
    >
      <div className="relative aspect-[3/4] w-16 shrink-0 overflow-hidden rounded-2xl bg-surface">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={sample.src || "/placeholder.svg"} alt="" className="size-full object-cover" />
      </div>
      <div className="flex min-w-0 flex-1 flex-col justify-between gap-1.5 py-0.5">
        <div className="flex flex-wrap items-center gap-1.5">
          {sample.priority === 1 && (
            <span className="inline-flex h-6 items-center gap-1 rounded-full bg-dataset/20 px-2 text-[11px] font-semibold text-dataset">
              <GitCompareArrows className="size-3" aria-hidden />
              Desacuerdo
            </span>
          )}
          <ModelChip model={sample.reading.bottle_model} className="h-6 text-[11px]" />
        </div>
        <p className="font-mono text-xs text-foreground">
          clase: <span className="text-dataset">{sample.proposedClass ?? "sin clase"}</span>
        </p>
        <p className="line-clamp-2 text-xs leading-snug text-muted-foreground">{sample.reason}</p>
        <p className="font-mono text-[11px] tabular-nums text-muted-foreground">{date}</p>
      </div>
    </button>
  );
}
