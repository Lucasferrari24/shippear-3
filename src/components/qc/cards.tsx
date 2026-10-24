import { Droplets, PackageCheck } from "lucide-react";
import { cn } from "cn";
import { CAP_COLORS, CAP_LABELS, LEVEL_LABELS, pct } from "@/lib/labels";
import type { CapState, LevelBand, LevelStatus } from "@/lib/types";

export function DomainCard({
  color,
  icon: Icon,
  title,
  children,
  className,
}: {
  color: string;
  icon: typeof Droplets;
  title: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn("flex flex-col gap-3 rounded-3xl border border-border bg-card p-4", className)}
      style={{ backgroundImage: `radial-gradient(120% 80% at 0% 0%, color-mix(in srgb, ${color} 10%, transparent), transparent 60%)` }}
    >
      <header className="flex items-center gap-2">
        <span
          className="flex size-7 items-center justify-center rounded-full"
          style={{ backgroundColor: `color-mix(in srgb, ${color} 18%, transparent)`, color }}
        >
          <Icon className="size-4" strokeWidth={1.75} aria-hidden />
        </span>
        <h3 className="text-sm font-medium text-foreground">{title}</h3>
      </header>
      {children}
    </section>
  );
}

export function CapCard({ cap, gap }: { cap: CapState; gap: number | null }) {
  return (
    <DomainCard color="var(--cap)" icon={PackageCheck} title="Tapa">
      <div className="flex flex-col gap-1">
        <span className="flex items-center gap-2 text-base font-semibold leading-tight text-foreground text-pretty">
          <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: CAP_COLORS[cap] }} aria-hidden />
          {CAP_LABELS[cap]}
        </span>
        <span className="text-xs text-muted-foreground">Separación tapa-pico</span>
        <span className="font-mono text-2xl font-semibold tabular-nums text-cap">
          {gap == null ? "—" : `${Math.round(gap)} px`}
        </span>
      </div>
    </DomainCard>
  );
}

export function LevelGauge({
  fraction,
  band,
  status,
  compact,
}: {
  fraction: number | null;
  band: LevelBand;
  status: LevelStatus;
  compact?: boolean;
}) {
  const h = compact ? 96 : 120;
  const color = status === "ok" ? "var(--ok)" : status === "no_medido" ? "var(--process)" : "var(--nok)";
  return (
    <div className="flex items-end gap-3">
      <div
        className="relative w-10 shrink-0 overflow-hidden rounded-t-xl rounded-b-2xl border border-border bg-surface"
        style={{ height: h }}
        role="img"
        aria-label={`Nivel ${pct(fraction)}, banda ${pct(band.min, 0)} a ${pct(band.max, 0)}`}
      >
        <div
          className="absolute inset-x-0 bg-level/15"
          style={{ top: `${band.min * 100}%`, height: `${(band.max - band.min) * 100}%` }}
        />
        <div className="absolute inset-x-0 border-t border-dashed border-level/80" style={{ top: `${band.min * 100}%` }} />
        <div className="absolute inset-x-0 border-t border-dashed border-level/80" style={{ top: `${band.max * 100}%` }} />
        {fraction != null && (
          <>
            <div
              className="absolute inset-x-0 bottom-0 bg-level/25"
              style={{ top: `${Math.min(1, Math.max(0, fraction)) * 100}%` }}
            />
            <div
              className="absolute inset-x-0 h-0.5"
              style={{ top: `${Math.min(1, Math.max(0, fraction)) * 100}%`, backgroundColor: color }}
            />
          </>
        )}
      </div>
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="font-mono text-2xl font-semibold tabular-nums text-level">{fraction == null ? "—" : pct(fraction)}</span>
        <span className="text-sm font-medium" style={{ color }}>
          {LEVEL_LABELS[status]}
        </span>
        <span className="font-mono text-xs tabular-nums text-muted-foreground">
          banda {pct(band.min, 0)}–{pct(band.max, 0)}
        </span>
      </div>
    </div>
  );
}

export function LevelCard(props: { fraction: number | null; band: LevelBand; status: LevelStatus }) {
  return (
    <DomainCard color="var(--level)" icon={Droplets} title="Nivel">
      <LevelGauge {...props} compact />
    </DomainCard>
  );
}
