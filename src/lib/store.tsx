"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import * as api from "./api";
import { DEFAULT_BANDS, bandKey, calibratedBand, judge, type Bands } from "./judge";
import { MODEL_LABELS } from "./labels";
import type { BottleCategory, BottleModel, Item, LevelBand } from "./types";

export const COLLECT_KEY = "lavirshion.collect";
export const ENGINE_KEY = "lavirshion.engine";
const CONCURRENCY = 2;
/** Lado mayor de la foto que se manda a la API; las coordenadas vuelven en esa escala. */
const MAX_EDGE = 1280;

export type Filter = "all" | BottleCategory | "ERROR" | "QUEUE";

type Store = {
  items: Item[];
  bands: Bands;
  selectedKey: string | null;
  selected: Item | null;
  filter: Filter;
  collect: boolean;
  /** Modelo que inspecciona; "local" solo si el backend tiene el modelo entrenado cargado. */
  engine: api.Engine;
  health: api.Health | null;
  setEngine: (e: api.Engine) => void;
  setFilter: (f: Filter) => void;
  select: (key: string | null) => void;
  addFiles: (files: FileList | File[]) => Promise<void>;
  retry: (key: string) => void;
  setBand: (model: keyof Bands, band: LevelBand) => void;
  resetBand: (model: keyof Bands) => void;
  calibrate: (key: string) => void;
  setCollect: (on: boolean) => void;
  clear: () => void;
};

const Ctx = createContext<Store | null>(null);

/** Lee la foto y la reescala a MAX_EDGE: `data` es lo que va a la API y `width`/`height`, su tamaño. */
function readImage(file: File): Promise<Pick<Item, "src" | "data" | "width" | "height">> {
  return new Promise((resolve, reject) => {
    const src = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, MAX_EDGE / Math.max(img.naturalWidth, img.naturalHeight));
      const width = Math.round(img.naturalWidth * k);
      const height = Math.round(img.naturalHeight * k);
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      canvas.getContext("2d")!.drawImage(img, 0, 0, width, height);
      resolve({ src, data: canvas.toDataURL("image/jpeg", 0.9), width, height });
    };
    img.onerror = () => reject(new Error("No se pudo leer la imagen."));
    img.src = src;
  });
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const [raw, setRaw] = useState<Item[]>([]);
  const [bands, setBands] = useState<Bands>(DEFAULT_BANDS);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [collect, setCollectState] = useState(false);
  const [engine, setEngineState] = useState<api.Engine>("teacher");
  const [health, setHealth] = useState<api.Health | null>(null);
  const engineRef = useRef(engine);
  engineRef.current = engine;
  const inflight = useRef(new Set<string>());
  const bandsRef = useRef(bands);
  bandsRef.current = bands;
  const collectRef = useRef(collect);
  collectRef.current = collect;

  useEffect(() => {
    setCollectState(localStorage.getItem(COLLECT_KEY) === "1");
    // El backend dice qué modelos hay: por defecto inspecciona el YOLO entrenado si está cargado,
    // y las bandas arrancan en las calibradas al entrenarlo.
    api
      .getHealth()
      .then((h) => {
        setHealth(h);
        const saved = localStorage.getItem(ENGINE_KEY) as api.Engine | null;
        const local = h.local.available;
        setEngineState(saved === "teacher" || !local ? "teacher" : "local");
        const b = h.local.bands;
        if (b?.clasico && b?.stevia) {
          setBands({ clasico: { min: b.clasico.min, max: b.clasico.max }, stevia: { min: b.stevia.min, max: b.stevia.max } });
        }
      })
      .catch((e: unknown) => toast.error(e instanceof Error ? e.message : "No se pudo conectar con el backend."));
  }, []);

  const patch = useCallback((key: string, p: Partial<Item>) => {
    setRaw((prev) => prev.map((it) => (it.key === key ? { ...it, ...p } : it)));
  }, []);

  // Corredor de la cola: toma pendientes hasta CONCURRENCY en paralelo.
  useEffect(() => {
    const running = raw.filter((i) => i.status === "running").length;
    const slots = CONCURRENCY - running;
    if (slots <= 0) return;
    const next = raw.filter((i) => i.status === "pending" && !inflight.current.has(i.key)).slice(0, slots);
    for (const it of next) {
      inflight.current.add(it.key);
      patch(it.key, { status: "running", error: undefined });
      api
        .inspect(it, bandsRef.current, engineRef.current)
        .then(async (result) => {
          patch(it.key, { status: "done", result });
          if (collectRef.current) {
            try {
              const band = bandsRef.current[bandKey(result.reading.bottle_model)];
              patch(it.key, { feedback: await api.sendFeedback(it, result, band) });
            } catch (e) {
              toast.error(`Recolección: ${e instanceof Error ? e.message : "no se pudo guardar la muestra"}`);
            }
          }
        })
        .catch((e: unknown) => {
          patch(it.key, { status: "error", error: e instanceof Error ? e.message : "Error HTTP 500" });
        })
        .finally(() => inflight.current.delete(it.key));
    }
  }, [raw, patch]);

  // Veredictos derivados: recalibrar la banda recalcula todo el lote en el cliente.
  const items = useMemo(
    () =>
      raw.map((it) =>
        it.result
          ? { ...it, result: { ...it.result, verdict: judge(it.result.reading, bands[bandKey(it.result.reading.bottle_model)]) } }
          : it,
      ),
    [raw, bands],
  );

  const addFiles = useCallback(async (files: FileList | File[]) => {
    const list = Array.from(files).filter((f) => f.type.startsWith("image/"));
    if (!list.length) {
      toast.error("Subí imágenes jpeg, png o webp.");
      return;
    }
    const loaded = await Promise.all(
      list.map(async (f, i) => {
        try {
          const dims = await readImage(f);
          return { key: `${Date.now()}-${i}-${f.name}`, name: f.name, status: "pending" as const, ...dims };
        } catch {
          return null;
        }
      }),
    );
    const ok = loaded.filter((x): x is NonNullable<typeof x> => x !== null);
    setRaw((prev) => [...ok, ...prev]);
    if (ok[0]) setSelectedKey(ok[0].key);
    setFilter("all");
  }, []);

  const retry = useCallback((key: string) => patch(key, { status: "pending", error: undefined }), [patch]);

  const setBand = useCallback((model: keyof Bands, band: LevelBand) => {
    setBands((b) => ({ ...b, [model]: band }));
  }, []);

  const resetBand = useCallback((model: keyof Bands) => {
    setBands((b) => ({ ...b, [model]: { ...DEFAULT_BANDS[model] } }));
  }, []);

  const calibrate = useCallback(
    (key: string) => {
      const it = items.find((i) => i.key === key);
      const f = it?.result?.verdict.levelFraction;
      if (!it?.result || f == null) return;
      const model = bandKey(it.result.reading.bottle_model);
      const band = calibratedBand(f);
      setBands((b) => ({ ...b, [model]: band }));
      const n = items.filter((i) => i.result && bandKey(i.result.reading.bottle_model) === model).length;
      const p = (x: number) => Math.round(x * 100);
      toast.success(
        `Banda de ${MODEL_LABELS[model as BottleModel]} fijada en ${p(band.min)}–${p(band.max)} %. ${n} veredictos recalculados.`,
      );
    },
    [items],
  );

  const setCollect = useCallback((on: boolean) => {
    setCollectState(on);
    localStorage.setItem(COLLECT_KEY, on ? "1" : "0");
  }, []);

  const setEngine = useCallback(
    (e: api.Engine) => {
      if (e === "local" && !health?.local.available) {
        toast.error("El backend no tiene un modelo entrenado cargado.");
        return;
      }
      setEngineState(e);
      localStorage.setItem(ENGINE_KEY, e);
    },
    [health],
  );

  const clear = useCallback(() => {
    setRaw([]);
    setSelectedKey(null);
  }, []);

  const selected = items.find((i) => i.key === selectedKey) ?? null;

  const value: Store = {
    items,
    bands,
    selectedKey,
    selected,
    filter,
    collect,
    engine,
    health,
    setEngine,
    setFilter,
    select: setSelectedKey,
    addFiles,
    retry,
    setBand,
    resetBand,
    calibrate,
    setCollect,
    clear,
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useStore() {
  const s = useContext(Ctx);
  if (!s) throw new Error("useStore fuera de StoreProvider");
  return s;
}

export function itemBucket(it: Item): Exclude<Filter, "all"> {
  if (it.status === "pending" || it.status === "running") return "QUEUE";
  if (it.status === "error" || !it.result) return "ERROR";
  return it.result.verdict.bottle.category;
}
