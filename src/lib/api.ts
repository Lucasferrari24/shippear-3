// Capa de datos: llama al backend (Render) en NEXT_PUBLIC_API_URL. Los componentes no saben de HTTP.

import { bandKey, judge, type Bands } from "./judge";
import type {
  Comparison,
  DatasetClass,
  DatasetSummary,
  InspectionResult,
  Item,
  LevelBand,
  LineCategoryRow,
  LineDailyRow,
  LineDefectRow,
  ModelAgreementRow,
  ReviewSample,
  Sample,
  StateMatrixCell,
  VisionReading,
} from "./types";

/** URL del backend, sin barra final. En local: http://localhost:8000. */
export const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000").replace(/\/+$/, "");

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status = 0,
  ) {
    super(message);
  }
}

/** URL absoluta de un recurso del backend (las fotos guardadas vienen como /api/images/<id>). */
export const apiUrl = (path: string) => (/^https?:|^blob:|^data:/.test(path) ? path : `${API_URL}${path}`);

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(apiUrl(path), {
      ...init,
      headers: init?.body ? { "content-type": "application/json", ...init.headers } : init?.headers,
    });
  } catch {
    throw new ApiError(`No se pudo conectar con el backend (${API_URL}).`);
  }
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(body?.error ?? `Error HTTP ${res.status}`, res.status);
  return body as T;
}

const post = <T,>(path: string, body: unknown) => request<T>(path, { method: "POST", body: JSON.stringify(body) });

// --- Estado del backend ---

export type Health = {
  ok: boolean;
  db: boolean;
  local: { available: boolean; version: string | null; sha: string | null; bands?: Partial<Bands>; error?: string };
  teacher: { configured: boolean; model: string };
};

/** GET /health: qué modelos están disponibles en el backend. */
export const getHealth = () => request<Health>("/health");

// --- Inspección ---

/** Qué modelo inspecciona: el YOLO entrenado que carga el backend o Claude (el maestro). */
export type Engine = "local" | "teacher";

export type Detection = { class_name: string; confidence: number; box: { x0: number; y0: number; x1: number; y1: number } };

/** Resultado de una inspección, con las detecciones crudas cuando la hizo el modelo local. */
export type EngineResult = InspectionResult & { engine: Engine; detections?: Detection[] };

type Encoded = Pick<Item, "data" | "width" | "height">;

/**
 * POST /api/predict (modelo local) o /api/inspect (maestro). Las coordenadas vuelven en píxeles de `data`.
 * Con `bands` el veredicto se recalcula con la banda vigente en la interfaz; con null queda el del backend.
 */
export async function inspect(item: Encoded, bands: Bands | null, engine: Engine): Promise<EngineResult> {
  if (!item.data) throw new ApiError("La imagen todavía no está lista.");
  const body = { image: item.data, width: item.width, height: item.height };
  const result = await post<InspectionResult & { detections?: Detection[] }>(
    engine === "local" ? "/api/predict" : "/api/inspect",
    body,
  );
  if (!bands) return { ...result, engine };
  return { ...result, engine, verdict: judge(result.reading, bands[bandKey(result.reading.bottle_model)]) };
}

export type FeedbackResult = {
  inspectionId: string;
  comparison: Comparison;
  sample: Sample;
  teacher: { reading: VisionReading; model: string; latencyMs: number };
};

/**
 * POST /api/feedback: el maestro verifica la foto, se compara con el modelo local y queda en la cola del dataset.
 * Si la inspección la hizo el YOLO, se manda su lectura para no correrlo dos veces.
 */
export async function sendFeedback(
  item: Encoded,
  result: EngineResult,
  band: LevelBand,
  /** Lo que agrega la cámara: el estado votado entre los cuadros de la botella y los votos. */
  extra: { source?: "camera" | "upload"; state?: InspectionResult["verdict"]["bottle"]; track?: { frames: number; votes: Record<string, number> } } = {},
) {
  const local =
    result.engine === "local"
      ? { reading: result.reading, detections: result.detections, latencyMs: result.latencyMs, modelVersion: { name: result.model } }
      : undefined;
  const fb = await post<FeedbackResult>("/api/feedback", {
    image: item.data,
    width: item.width,
    height: item.height,
    band,
    source: "upload",
    ...extra,
    local,
  });
  return { comparison: fb.comparison, sample: fb.sample };
}

/** POST /api/inspections: guarda la botella con la decisión de un solo modelo, sin llamar al maestro. */
export function saveInspection(input: {
  image: string;
  width: number;
  height: number;
  engine: Engine;
  reading: VisionReading;
  detections?: Detection[];
  latencyMs?: number;
  modelVersion?: string;
  source?: "camera" | "upload";
  state?: InspectionResult["verdict"]["bottle"];
  track?: { frames: number; votes: Record<string, number> };
}) {
  return post<{ inspectionId: string; state: InspectionResult["verdict"]["bottle"] }>("/api/inspections", input);
}

// --- Dataset ---

export async function getDataset(): Promise<{ pending: ReviewSample[]; summary: DatasetSummary }> {
  const data = await request<{ pending: ReviewSample[]; summary: DatasetSummary }>("/api/dataset");
  const pending = data.pending
    .map((s) => ({ ...s, src: apiUrl(s.src) }))
    .sort((a, b) => a.priority - b.priority || b.createdAt.localeCompare(a.createdAt));
  return { pending, summary: data.summary };
}

export async function reviewSample(input: {
  id: string;
  action: "approve" | "reject";
  labelClass: DatasetClass | null;
  reviewer: string;
}) {
  if (input.action === "approve" && !input.labelClass) throw new ApiError("Para aprobar hace falta la clase.");
  await request(`/api/dataset/${encodeURIComponent(input.id)}`, {
    method: "PATCH",
    body: JSON.stringify({
      status: input.action === "approve" ? "approved" : "rejected",
      labelClass: input.labelClass ?? undefined,
      reviewer: input.reviewer || undefined,
    }),
  });
}

// --- Tablero ---

export const getLines = () => request<string[]>("/api/lines");

export function getLineDashboard(line: string, range: number) {
  return request<{
    daily: LineDailyRow[];
    defects: LineDefectRow[];
    categories: LineCategoryRow[];
    matrix: StateMatrixCell[];
  }>(`/api/dashboard?line=${encodeURIComponent(line)}&days=${range}`);
}

// --- Salud del modelo ---

export function getModelHealth() {
  return request<{
    local: { name: string; integrated: boolean; version: string | null; sha: string | null };
    agreement: ModelAgreementRow[];
    outcomes: Record<Comparison["outcome"], number>;
  }>("/api/model");
}

export { judge, bandKey };
