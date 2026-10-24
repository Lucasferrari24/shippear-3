"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Overlay } from "@/components/Overlay";
import { CAP_LABELS, CATEGORY_LABELS, LEVEL_LABELS, type BottleCategory } from "@/lib/bottle";
import type { FeedbackResult } from "@/lib/feedback";
import {
  DEFAULT_BANDS,
  DEFECT_LABELS,
  judge,
  type InspectionResult,
  type LevelBand,
} from "@/lib/inspection";

type Item = {
  key: string;
  name: string;
  src: string;
  width: number;
  height: number;
  status: "pending" | "running" | "done" | "error";
  result?: InspectionResult;
  feedback?: Pick<FeedbackResult, "comparison" | "sample">;
  error?: string;
};

type Summary = { samples: { status: string; n: number }[]; outcomes: { outcome: string; n: number }[] };

const COLLECT_KEY = "centinela.collect";

const SAMPLE_STATUS: Record<string, string> = {
  approved: "aprobada",
  pending: "pendiente de revisión",
  rejected: "rechazada",
  exported: "exportada",
};

type Bands = typeof DEFAULT_BANDS;

const MAX_EDGE = 1280;
const CONCURRENCY = 3;

/** Reescala a MAX_EDGE para que las coordenadas de la IA coincidan con el canvas. */
async function loadImage(file: File): Promise<Pick<Item, "src" | "width" | "height">> {
  const url = URL.createObjectURL(file);
  const img = await new Promise<HTMLImageElement>((res, rej) => {
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = rej;
    i.src = url;
  });
  const k = Math.min(1, MAX_EDGE / Math.max(img.naturalWidth, img.naturalHeight));
  const width = Math.round(img.naturalWidth * k);
  const height = Math.round(img.naturalHeight * k);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  canvas.getContext("2d")!.drawImage(img, 0, 0, width, height);
  URL.revokeObjectURL(url);
  return { src: canvas.toDataURL("image/jpeg", 0.9), width, height };
}

function bandFor(bands: Bands, r: InspectionResult): LevelBand {
  return bands[r.reading.bottle_model === "stevia" ? "stevia" : "clasico"];
}

export default function Home() {
  const [items, setItems] = useState<Item[]>([]);
  const [bands, setBands] = useState<Bands>(DEFAULT_BANDS);
  const [selected, setSelected] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [collect, setCollect] = useState(false);
  const [summary, setSummary] = useState<Summary | null>(null);
  const collectRef = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(COLLECT_KEY) === "1";
      collectRef.current = saved;
      setCollect(saved);
    } catch {}
  }, []);

  const refreshSummary = useCallback(async () => {
    try {
      const res = await fetch("/api/feedback");
      if (res.ok) setSummary(await res.json());
    } catch {}
  }, []);

  const toggleCollect = (on: boolean) => {
    collectRef.current = on;
    setCollect(on);
    try {
      localStorage.setItem(COLLECT_KEY, on ? "1" : "0");
    } catch {}
    if (on) refreshSummary();
  };

  const patch = (key: string, p: Partial<Item>) =>
    setItems((xs) => xs.map((x) => (x.key === key ? { ...x, ...p } : x)));

  const inspect = useCallback(async (item: Item) => {
    patch(item.key, { status: "running" });
    const body = { image: item.src, width: item.width, height: item.height };
    try {
      if (collectRef.current) {
        // Recolección: el maestro verifica la foto y la muestra queda guardada para el dataset.
        // Cuando el modelo local corra en el navegador, su predicción viaja en `local` para compararla.
        const res = await fetch("/api/feedback", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
        const fb = data as FeedbackResult;
        patch(item.key, {
          status: "done",
          result: {
            id: fb.inspectionId,
            createdAt: new Date().toISOString(),
            width: item.width,
            height: item.height,
            reading: fb.teacher.reading,
            verdict: fb.teacher.verdict,
            model: fb.teacher.model,
            latencyMs: fb.teacher.latencyMs,
          },
          feedback: { comparison: fb.comparison, sample: fb.sample },
        });
        refreshSummary();
        return;
      }
      const res = await fetch("/api/inspect", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      patch(item.key, { status: "done", result: data });
    } catch (e) {
      patch(item.key, { status: "error", error: e instanceof Error ? e.message : String(e) });
    }
  }, [refreshSummary]);

  const addFiles = useCallback(
    async (files: FileList | File[]) => {
      const list = Array.from(files).filter((f) => f.type.startsWith("image/"));
      const loaded: Item[] = [];
      for (const f of list) {
        loaded.push({ key: crypto.randomUUID(), name: f.name, status: "pending", ...(await loadImage(f)) });
      }
      setItems((xs) => [...loaded, ...xs]);
      if (loaded[0]) setSelected(loaded[0].key);
      const queue = [...loaded];
      await Promise.all(
        Array.from({ length: CONCURRENCY }, async () => {
          for (let it = queue.shift(); it; it = queue.shift()) await inspect(it);
        }),
      );
    },
    [inspect],
  );

  // El veredicto se recalcula en el cliente: recalibrar la banda no vuelve a llamar a la IA.
  const judged = useMemo(
    () =>
      items.map((it) => ({
        ...it,
        verdict: it.result ? judge(it.result.reading, bandFor(bands, it.result)) : undefined,
      })),
    [items, bands],
  );

  const done = judged.filter((j) => j.verdict);
  const nok = done.filter((j) => j.verdict!.status === "NOK");
  const defectCounts = nok
    .flatMap((j) => j.verdict!.defects)
    .reduce<Record<string, number>>((acc, d) => ({ ...acc, [d]: (acc[d] ?? 0) + 1 }), {});
  const categoryCounts = done.reduce<Partial<Record<BottleCategory, number>>>((acc, j) => {
    const c = j.verdict!.bottle.category;
    return { ...acc, [c]: (acc[c] ?? 0) + 1 };
  }, {});

  const current = judged.find((j) => j.key === selected) ?? judged[0];

  const calibrate = () => {
    if (!current?.result || current.verdict?.levelFraction == null) return;
    const model = current.result.reading.bottle_model === "stevia" ? "stevia" : "clasico";
    const f = current.verdict.levelFraction;
    setBands((b) => ({ ...b, [model]: { min: +(f - 0.04).toFixed(3), max: +(f + 0.04).toFixed(3) } }));
  };

  const exportCsv = () => {
    const rows = [
      [
        "archivo", "modelo", "veredicto", "categoria", "codigo", "estado_tapa", "estado_nivel",
        "defectos", "nivel_pct", "confianza", "evidencia",
      ],
      ...done.map((j) => [
        j.name,
        j.result!.reading.bottle_model,
        j.verdict!.status,
        j.verdict!.bottle.category,
        j.verdict!.bottle.code,
        j.verdict!.bottle.cap,
        j.verdict!.bottle.level,
        j.verdict!.defects.join("|"),
        j.verdict!.levelFraction != null ? (j.verdict!.levelFraction * 100).toFixed(1) : "",
        j.result!.reading.confidence.toFixed(2),
        j.result!.reading.evidence,
      ]),
    ];
    const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    a.download = "centinela-qc.csv";
    a.click();
  };

  return (
    <main className="mx-auto max-w-7xl px-4 py-6">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Centinela QC</h1>
          <p className="text-sm text-slate-400">
            Control de calidad por visión para la línea de envasado de Virginia · tapa y nivel de llenado, foto por foto.
          </p>
        </div>
        <div className="flex gap-2 text-sm">
          <Stat label="Inspeccionadas" value={done.length} />
          <Stat label="OK" value={done.length - nok.length} tone="ok" />
          <Stat label="NOK" value={nok.length} tone="nok" />
        </div>
      </header>

      <div className="mb-4 rounded-xl border border-slate-800 px-4 py-3 text-sm">
        <label className="flex cursor-pointer items-center gap-3">
          <input
            type="checkbox"
            checked={collect}
            onChange={(e) => toggleCollect(e.target.checked)}
            className="h-4 w-4 accent-sky-500"
          />
          <span className="font-medium">Recolectar datos para el dataset</span>
        </label>
        <p className="mt-1 text-xs text-slate-500">
          Cada foto se envía al modelo maestro (Claude, API externa), se compara con el modelo local y se guarda en
          la base para reentrenar. Activalo solo con fotos que la empresa autorizó a compartir.
        </p>
        {collect && summary && (
          <p className="mt-2 text-xs text-slate-300">
            Dataset:{" "}
            {summary.samples.length
              ? summary.samples.map((s) => `${s.n} ${SAMPLE_STATUS[s.status] ?? s.status}`).join(" · ")
              : "sin muestras todavía"}
            {summary.outcomes.length > 0 &&
              " · comparaciones: " + summary.outcomes.map((o) => `${o.n} ${o.outcome}`).join(", ")}
          </p>
        )}
      </div>

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          addFiles(e.dataTransfer.files);
        }}
        onClick={() => inputRef.current?.click()}
        className={`mb-6 cursor-pointer rounded-xl border-2 border-dashed p-6 text-center transition ${
          dragging ? "border-sky-400 bg-sky-400/10" : "border-slate-700 hover:border-slate-500"
        }`}
      >
        <p className="font-medium">Arrastrá fotos de botellas o tocá para elegir / sacar una foto</p>
        <p className="text-xs text-slate-500">Clásico (tapa roja) y Stevia (tapa verde) · varias a la vez</p>
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          capture="environment"
          multiple
          hidden
          onChange={(e) => e.target.files && addFiles(e.target.files)}
        />
      </div>

      {judged.length === 0 ? (
        <HowItWorks />
      ) : (
        <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
          <section>
            {current && (
              <div className="rounded-xl border border-slate-800 p-3">
                {current.result && current.verdict ? (
                  <Overlay src={current.src} result={current.result} verdict={current.verdict} />
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={current.src} alt={current.name} className="w-full rounded-lg opacity-60" />
                )}
              </div>
            )}
            <div className="mt-4 grid grid-cols-4 gap-2 sm:grid-cols-6 md:grid-cols-8">
              {judged.map((j) => (
                <button
                  key={j.key}
                  onClick={() => setSelected(j.key)}
                  className={`relative overflow-hidden rounded-md border-2 ${
                    j.key === current?.key ? "border-sky-400" : "border-transparent"
                  }`}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={j.src} alt={j.name} className="aspect-[3/4] w-full object-cover" />
                  <span
                    className={`absolute inset-x-0 bottom-0 text-[10px] font-bold ${
                      j.verdict?.status === "OK"
                        ? "bg-green-600"
                        : j.verdict?.status === "NOK"
                          ? "bg-red-600"
                          : j.status === "error"
                            ? "bg-slate-600"
                            : "bg-slate-800 animate-pulse"
                    }`}
                  >
                    {j.verdict?.status ?? (j.status === "error" ? "ERROR" : "…")}
                  </span>
                </button>
              ))}
            </div>
          </section>

          <aside className="space-y-4">
            {current && <Detail item={current} onCalibrate={calibrate} onRetry={() => inspect(current)} />}

            <div className="rounded-xl border border-slate-800 p-4">
              <h3 className="mb-3 text-sm font-semibold">Banda de llenado (desde el tope del envase)</h3>
              {(Object.keys(bands) as (keyof Bands)[]).map((m) => (
                <div key={m} className="mb-3 text-sm">
                  <div className="mb-1 capitalize text-slate-400">{m}</div>
                  <div className="flex gap-3">
                    {(["min", "max"] as const).map((k) => (
                      <label key={k} className="flex items-center gap-2">
                        <span className="w-8 text-xs uppercase text-slate-500">{k}</span>
                        <input
                          type="number"
                          step={0.01}
                          min={0}
                          max={1}
                          value={bands[m][k]}
                          onChange={(e) =>
                            setBands((b) => ({ ...b, [m]: { ...b[m], [k]: Number(e.target.value) } }))
                          }
                          className="w-20 rounded bg-slate-900 px-2 py-1"
                        />
                      </label>
                    ))}
                  </div>
                </div>
              ))}
              <p className="text-xs text-slate-500">
                Los veredictos se recalculan al instante. Usá «Calibrar» sobre una botella OK para fijar la banda ±4%.
              </p>
            </div>

            {done.length > 0 && (
              <div className="rounded-xl border border-slate-800 p-4 text-sm">
                <h3 className="mb-2 font-semibold">Clasificación del lote</h3>
                {(Object.keys(CATEGORY_LABELS) as BottleCategory[])
                  .filter((c) => categoryCounts[c])
                  .map((c) => (
                    <div key={c} className="flex justify-between">
                      <span>{CATEGORY_LABELS[c]}</span>
                      <span className="font-mono">{categoryCounts[c]}</span>
                    </div>
                  ))}
              </div>
            )}

            {nok.length > 0 && (
              <div className="rounded-xl border border-slate-800 p-4 text-sm">
                <h3 className="mb-2 font-semibold">Defectos del lote</h3>
                {Object.entries(defectCounts).map(([d, n]) => (
                  <div key={d} className="flex justify-between">
                    <span>{DEFECT_LABELS[d as keyof typeof DEFECT_LABELS]}</span>
                    <span className="font-mono">{n}</span>
                  </div>
                ))}
              </div>
            )}

            {done.length > 0 && (
              <button onClick={exportCsv} className="w-full rounded-lg bg-slate-800 py-2 text-sm hover:bg-slate-700">
                Exportar reporte CSV
              </button>
            )}
          </aside>
        </div>
      )}
    </main>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: "ok" | "nok" }) {
  const color = tone === "ok" ? "text-green-400" : tone === "nok" ? "text-red-400" : "text-slate-200";
  return (
    <div className="rounded-lg border border-slate-800 px-3 py-1.5 text-center">
      <div className={`font-mono text-lg ${color}`}>{value}</div>
      <div className="text-[10px] uppercase tracking-wide text-slate-500">{label}</div>
    </div>
  );
}

function Detail({
  item,
  onCalibrate,
  onRetry,
}: {
  item: Item & { verdict?: ReturnType<typeof judge> };
  onCalibrate: () => void;
  onRetry: () => void;
}) {
  const { result, verdict } = item;
  if (item.status === "error")
    return (
      <div className="rounded-xl border border-red-900 p-4 text-sm">
        <p className="mb-2 text-red-400">{item.error}</p>
        <button onClick={onRetry} className="rounded bg-slate-800 px-3 py-1">
          Reintentar
        </button>
      </div>
    );
  if (!result || !verdict)
    return <div className="rounded-xl border border-slate-800 p-4 text-sm text-slate-400">Inspeccionando…</div>;

  const r = result.reading;
  return (
    <div className="rounded-xl border border-slate-800 p-4 text-sm">
      <div
        className={`mb-3 rounded-lg py-3 text-center text-3xl font-bold ${
          verdict.status === "OK" ? "bg-green-600/20 text-green-400" : "bg-red-600/20 text-red-400"
        }`}
      >
        {verdict.status}
        <div className="mt-1 text-xs font-medium tracking-wide">
          {CATEGORY_LABELS[verdict.bottle.category]} · <span className="font-mono">{verdict.bottle.code}</span>
        </div>
      </div>
      {verdict.defects.length > 0 && (
        <ul className="mb-3 list-inside list-disc text-red-300">
          {verdict.defects.map((d) => (
            <li key={d}>{DEFECT_LABELS[d]}</li>
          ))}
        </ul>
      )}
      <dl className="grid grid-cols-2 gap-y-1 text-slate-300">
        <dt className="text-slate-500">Modelo</dt>
        <dd className="capitalize">{r.bottle_model}</dd>
        <dt className="text-slate-500">Tapa</dt>
        <dd>{CAP_LABELS[verdict.bottle.cap]}</dd>
        <dt className="text-slate-500">Nivel</dt>
        <dd>
          {LEVEL_LABELS[verdict.bottle.level]}
          {verdict.levelFraction != null ? ` · ${(verdict.levelFraction * 100).toFixed(1)}%` : ""}{" "}
          <span className="text-slate-500">
            (banda {(verdict.band.min * 100).toFixed(0)}–{(verdict.band.max * 100).toFixed(0)}%)
          </span>
        </dd>
        <dt className="text-slate-500">Confianza</dt>
        <dd>{(r.confidence * 100).toFixed(0)}%</dd>
        <dt className="text-slate-500">Latencia</dt>
        <dd>{(result.latencyMs / 1000).toFixed(1)} s</dd>
      </dl>
      <p className="mt-3 border-t border-slate-800 pt-3 italic text-slate-400">“{r.evidence}”</p>
      {item.feedback && (
        <p className="mt-3 rounded-lg bg-slate-900 px-3 py-2 text-xs text-slate-300">
          {item.feedback.comparison.outcome === "teacher_only"
            ? "Verificada por el maestro."
            : item.feedback.comparison.outcome === "agree"
              ? "El modelo local coincide con el maestro."
              : "El modelo local NO coincide con el maestro."}{" "}
          Muestra del dataset: <b>{item.feedback.sample.labelClass ?? "sin clase"}</b>,{" "}
          {SAMPLE_STATUS[item.feedback.sample.status] ?? item.feedback.sample.status}
          {item.feedback.sample.reason ? ` (${item.feedback.sample.reason})` : ""}.
        </p>
      )}
      <button
        onClick={onCalibrate}
        disabled={verdict.levelFraction == null}
        className="mt-3 w-full rounded-lg bg-sky-700 py-2 hover:bg-sky-600 disabled:opacity-40"
      >
        Calibrar banda con esta foto (es OK)
      </button>
    </div>
  );
}

function HowItWorks() {
  const steps = [
    ["1 · Foto", "Subí o sacá la foto de una botella al final de la línea."],
    ["2 · La IA mide", "Un modelo de visión ubica envase, pico, tapa y menisco, y clasifica el estado de la tapa."],
    ["3 · Reglas", "Un motor determinístico compara el nivel contra la banda mín/máx calibrada para cada modelo."],
    ["4 · Veredicto", "OK / NOK, defecto y cotas superpuestas sobre la imagen; lote exportable a CSV."],
  ];
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {steps.map(([t, d]) => (
        <div key={t} className="rounded-xl border border-slate-800 p-4">
          <div className="mb-1 font-semibold">{t}</div>
          <p className="text-sm text-slate-400">{d}</p>
        </div>
      ))}
    </div>
  );
}
