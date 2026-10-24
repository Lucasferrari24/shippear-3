"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChartArea, Cpu, Database, Layers, Ruler, ScanEye, ScanLine } from "lucide-react";
import { cn } from "cn";
import { useStore } from "@/lib/store";

export const SECTIONS = [
  { href: "/", label: "Inspeccionar", short: "Inspección", icon: ScanLine, color: "var(--foreground)" },
  { href: "/calibracion", label: "Calibración", short: "Banda", icon: Ruler, color: "var(--level)" },
  { href: "/recoleccion", label: "Recolección", short: "Recolectar", icon: Database, color: "var(--dataset)" },
  { href: "/dataset", label: "Dataset", short: "Dataset", icon: Layers, color: "var(--dataset)" },
  { href: "/tablero", label: "Tablero", short: "Tablero", icon: ChartArea, color: "var(--line-fg)" },
  { href: "/modelo", label: "Modelo", short: "Modelo", icon: Cpu, color: "var(--dataset)" },
] as const;

function Logo() {
  return (
    <Link href="/" className="flex items-center gap-2.5 rounded-full" aria-label="LaVirshion, inicio">
      <span className="flex size-8 items-center justify-center rounded-[10px] bg-foreground text-background">
        <ScanEye className="size-[18px]" strokeWidth={2} aria-hidden />
      </span>
      <span className="text-[17px] font-semibold tracking-tight text-foreground">LaVirshion</span>
    </Link>
  );
}

function CollectingBadge() {
  const { collect } = useStore();
  if (!collect) return null;
  return (
    <Link
      href="/recoleccion"
      className="inline-flex h-7 items-center gap-1.5 rounded-full bg-dataset/18 px-2.5 text-xs font-medium text-dataset"
    >
      <span className="relative flex size-1.5">
        <span className="absolute inline-flex size-full animate-ping rounded-full bg-dataset opacity-70" />
        <span className="relative inline-flex size-1.5 rounded-full bg-dataset" />
      </span>
      Recolectando
    </Link>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isActive = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="material sticky top-0 z-40 border-b border-border">
        <div className="mx-auto flex h-14 max-w-[1440px] items-center justify-between gap-4 px-4 md:px-6">
          <Logo />
          <nav aria-label="Secciones" className="hidden items-center gap-1 md:flex">
            {SECTIONS.map((s) => {
              const active = isActive(s.href);
              return (
                <Link
                  key={s.href}
                  href={s.href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex h-9 items-center gap-2 rounded-full px-3.5 text-sm font-medium transition-colors",
                    active ? "bg-elevated text-foreground" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  <s.icon className="size-4" strokeWidth={1.75} style={{ color: active ? s.color : undefined }} aria-hidden />
                  {s.label}
                </Link>
              );
            })}
          </nav>
          <div className="flex min-w-24 justify-end">
            <CollectingBadge />
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-[1440px] flex-1 px-4 pb-28 pt-5 md:px-6 md:pb-12 md:pt-8">{children}</main>

      <nav aria-label="Secciones" className="material pb-safe fixed inset-x-0 bottom-0 z-40 border-t border-border md:hidden">
        <ul className="grid grid-cols-6">
          {SECTIONS.map((s) => {
            const active = isActive(s.href);
            return (
              <li key={s.href}>
                <Link
                  href={s.href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex min-h-14 flex-col items-center justify-center gap-1 pt-1.5 text-[10px] font-medium",
                    active ? "text-foreground" : "text-muted-foreground",
                  )}
                >
                  <s.icon
                    className="size-[22px]"
                    strokeWidth={active ? 2 : 1.6}
                    style={{ color: active ? s.color : undefined }}
                    aria-hidden
                  />
                  {s.short}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </div>
  );
}

export function PageHeader({
  title,
  subtitle,
  color,
  icon: Icon,
  children,
}: {
  title: string;
  subtitle?: string;
  color: string;
  icon: typeof ScanLine;
  children?: React.ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-col gap-4 md:mb-8 md:flex-row md:items-end md:justify-between">
      <div className="flex items-start gap-3">
        <span
          className="flex size-11 shrink-0 items-center justify-center rounded-2xl"
          style={{ backgroundColor: `color-mix(in srgb, ${color} 16%, transparent)`, color }}
        >
          <Icon className="size-5" strokeWidth={1.75} aria-hidden />
        </span>
        <div className="flex flex-col gap-1">
          <h1 className="text-balance text-2xl font-semibold tracking-tight text-foreground md:text-3xl">{title}</h1>
          {subtitle && <p className="text-pretty text-sm leading-relaxed text-muted-foreground">{subtitle}</p>}
        </div>
      </div>
      {children}
    </div>
  );
}
