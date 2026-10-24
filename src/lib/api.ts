// Capa de datos. Hoy responde con mocks; para conectar las rutas reales reemplazá el cuerpo de
// cada función por el fetch correspondiente sin tocar los componentes.

import { bandKey, judge, type Bands } from "./judge";
import {
  LINES,
  MOCK_AGREEMENT,
  MOCK_COMPARISON_OUTCOMES,
  TEACHER_MODEL,
  buildResult,
  classFor,
  mockDatasetSummary,
  mockFeedback,
  mockLineData,
  mockReadingByName,
  mockReviewQueue,
  syntheticReading,
} from "./mock";
import type { DatasetClass, DatasetSummary, InspectionResult, Item, ReviewSample } from "./types";
import { DATASET_CLASSES } from "./labels";

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const failedOnce = new Set<string>();
let counter = 100;

export class ApiError extends Error {}

/** POST /api/inspect */
export async function inspect(item: Pick<Item, "name" | "src" | "width" | "height">, bands: Bands): Promise<InspectionResult> {
  await wait(1400 + Math.random() * 1400);
  if (item.name.includes("error") && !failedOnce.has(item.name)) {
    failedOnce.add(item.name);
    throw new ApiError("La respuesta del maestro quedó cortada.");
  }
  const reading = mockReadingByName(item.name) ?? syntheticReading(item.name, item.width, item.height);
  const result = buildResult(reading, bands, counter++, item.width, item.height);
  result.createdAt = new Date().toISOString();
  result.model = TEACHER_MODEL;
  return result;
}

/** POST /api/feedback — solo con el modo recolección activo y corriendo en local. */
export async function sendFeedback(result: InspectionResult) {
  await wait(500);
  return mockFeedback(result, counter++);
}

// --- Dataset (estado en memoria del mock) ---
let queue: ReviewSample[] | null = null;
let summary: DatasetSummary | null = null;

function ensureDataset() {
  if (!queue) queue = mockReviewQueue();
  if (!summary) summary = mockDatasetSummary();
  return { queue, summary };
}

export async function getDataset() {
  await wait(600);
  const { queue, summary } = ensureDataset();
  const pending = queue
    .filter((s) => s.status === "pending")
    .sort((a, b) => a.priority - b.priority || b.createdAt.localeCompare(a.createdAt))
    .slice(0, 50);
  return { pending, summary: structuredClone(summary) };
}

export async function reviewSample(input: {
  id: string;
  action: "approve" | "reject";
  labelClass: DatasetClass | null;
  reviewer: string;
}) {
  await wait(350);
  const { queue, summary } = ensureDataset();
  const s = queue.find((x) => x.id === input.id);
  if (!s) throw new ApiError("No existe la muestra.");
  if (input.action === "approve") {
    if (!input.labelClass) throw new ApiError("Para aprobar hace falta la clase.");
    if (!DATASET_CLASSES.includes(input.labelClass)) throw new ApiError("Clase inválida");
  }
  s.humanLabel = input.labelClass !== s.proposedClass;
  s.labelClass = input.labelClass;
  s.reviewer = input.reviewer || null;
  s.status = input.action === "approve" ? "approved" : "rejected";
  summary.counts.pending -= 1;
  summary.counts[s.status] += 1;
  if (s.status === "approved" && s.labelClass && s.reading.bottle_model !== "desconocido") {
    summary.coverage[s.reading.bottle_model][s.labelClass as DatasetClass] += 1;
  }
  return s;
}

// --- Tablero ---
export async function getLines() {
  return [...LINES];
}

export async function getLineDashboard(line: string, range: number) {
  await wait(500);
  const data = mockLineData(line);
  const cut = <T,>(rows: T[]) => rows.slice(-range);
  return {
    daily: cut(data.daily),
    defects: cut(data.defects),
    categories: cut(data.categories),
    matrix: data.matrix,
  };
}

// --- Salud del modelo ---
export async function getModelHealth() {
  await wait(450);
  return {
    local: { name: "YOLO nano · ONNX", integrated: false, version: null as string | null, sha: null as string | null },
    agreement: MOCK_AGREEMENT,
    outcomes: MOCK_COMPARISON_OUTCOMES,
  };
}

export { judge, bandKey, classFor };
