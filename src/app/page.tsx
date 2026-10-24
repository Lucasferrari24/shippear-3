"use client";

import { useEffect, useState } from "react";
import { Trash2 } from "lucide-react";
import { cn } from "cn";
import { Drawer, DrawerContent, DrawerTitle } from "@/components/ui/drawer";
import { Detail, DetailEmpty } from "@/components/inspect/detail";
import { LoteGrid } from "@/components/inspect/lote-grid";
import { LoteSummary } from "@/components/inspect/summary";
import { Upload } from "@/components/inspect/upload";
import { useStore } from "@/lib/store";
import type { Engine } from "@/lib/api";

/** Elige quién inspecciona: el YOLO entrenado que carga el backend o Claude. */
function EnginePicker() {
  const { engine, setEngine, health } = useStore();
  const options: { value: Engine; label: string; disabled: boolean }[] = [
    { value: "local", label: "YOLO local", disabled: !health?.local.available },
    { value: "teacher", label: "Claude", disabled: health ? !health.teacher.configured : false },
  ];
  return (
    <div role="group" aria-label="Modelo que inspecciona" className="flex rounded-full bg-elevated/70 p-1">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={engine === o.value}
          disabled={o.disabled}
          title={o.disabled ? (o.value === "local" ? "El backend no tiene un modelo entrenado cargado" : "Falta ANTHROPIC_API_KEY en el backend") : undefined}
          onClick={() => setEngine(o.value)}
          className={cn(
            "h-8 rounded-full px-3.5 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40",
            engine === o.value ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function useIsDesktop() {
  const [desktop, setDesktop] = useState(true);
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    const on = () => setDesktop(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return desktop;
}

export default function InspectPage() {
  const { selected, select, items, clear } = useStore();
  const desktop = useIsDesktop();
  const [drawer, setDrawer] = useState(false);

  const open = (key: string) => {
    select(key);
    if (!desktop) setDrawer(true);
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <div className="flex items-end justify-between gap-3">
          <h1 className="text-balance text-3xl font-semibold tracking-tight text-foreground md:text-4xl">Inspeccionar lote</h1>
          <div className="flex items-center gap-2">
          <EnginePicker />
          {items.length > 0 && (
            <button
              type="button"
              onClick={clear}
              className="flex h-9 items-center gap-1.5 rounded-full px-3 text-sm text-muted-foreground hover:bg-elevated hover:text-foreground"
            >
              <Trash2 className="size-4" aria-hidden />
              Vaciar
            </button>
          )}
          </div>
        </div>
        <p className="text-pretty text-sm leading-relaxed text-muted-foreground">
          Virginia Clásico y Stevia · tapa y nivel por foto, con veredicto calculado sobre la banda vigente.
        </p>
      </div>

      <Upload />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_420px] xl:grid-cols-[minmax(0,1fr)_460px]">
        <div className="flex min-w-0 flex-col gap-4">
          <LoteSummary />
          <LoteGrid onOpen={open} />
        </div>
        <aside className="hidden lg:block">
          <div className="sticky top-20 max-h-[calc(100dvh-6rem)] overflow-y-auto pb-4 [scrollbar-width:thin]">
            {selected ? <Detail key={selected.key} item={selected} /> : <DetailEmpty />}
          </div>
        </aside>
      </div>

      {!desktop && (
        <Drawer open={drawer && !!selected} onOpenChange={setDrawer}>
          <DrawerContent className="max-h-[94dvh] rounded-t-[28px] border-border bg-background">
            <DrawerTitle className="sr-only">{selected?.name ?? "Detalle"}</DrawerTitle>
            <div className="overflow-y-auto px-4 pb-8 pt-2">
              {selected && <Detail key={selected.key} item={selected} />}
            </div>
          </DrawerContent>
        </Drawer>
      )}
    </div>
  );
}
