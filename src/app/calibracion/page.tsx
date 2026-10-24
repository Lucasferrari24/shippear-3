"use client";

import { Ruler } from "lucide-react";
import { PageHeader } from "@/components/shell/app-shell";
import { BandEditor } from "@/components/qc/band-editor";
import { useStore } from "@/lib/store";

export default function CalibracionPage() {
  const { items, bands, setBand, resetBand } = useStore();
  const pointsFor = (model: "clasico" | "stevia") =>
    items
      .filter((i) => i.result?.reading.bottle_model === model && i.result.verdict.levelFraction != null)
      .map((i) => ({ key: i.key, fraction: i.result!.verdict.levelFraction! }));

  return (
    <>
      <PageHeader
        title="Calibración de banda"
        subtitle="Banda aceptable de nivel por modelo, medida como fracción de la altura desde arriba (menor = más lleno). Los cambios recalculan el veredicto del lote al instante."
        color="var(--level)"
        icon={Ruler}
      />
      <div className="grid gap-4 lg:grid-cols-2">
        {(["clasico", "stevia"] as const).map((m) => (
          <BandEditor
            key={m}
            model={m}
            band={bands[m]}
            points={pointsFor(m)}
            onChange={(b) => setBand(m, b)}
            onReset={() => resetBand(m)}
          />
        ))}
      </div>
      <p className="mt-6 text-pretty text-sm leading-relaxed text-muted-foreground">
        Tip: en Inspeccionar, abrí una botella que sepas que está bien llena y tocá{" "}
        <span className="text-level">Usar como referencia OK</span> para centrar la banda en esa medición.
      </p>
    </>
  );
}
