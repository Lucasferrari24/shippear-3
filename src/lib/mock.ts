// Datos mock que respetan el contrato de ./types. Se reemplazan conectando ./api a las rutas reales.

import { DEFAULT_BANDS, bandKey, judge, type Bands } from "./judge";
import type {
  BottleCategory,
  CapState,
  Comparison,
  DatasetClass,
  DatasetSummary,
  InspectionResult,
  Item,
  LevelStatus,
  LineCategoryRow,
  LineDailyRow,
  LineDefectRow,
  ModelAgreementRow,
  ReviewSample,
  Sample,
  StateMatrixCell,
  VisionReading,
} from "./types";

export const TEACHER_MODEL = "claude-sonnet-4-5";
const W = 896;
const H = 1200;

/** Bandas del lote demo, calibradas sobre botellas OK de referencia. */
export const MOCK_BANDS: Bands = {
  clasico: { min: 0.38, max: 0.46 },
  stevia: { min: 0.42, max: 0.5 },
};

type Base = { reading: VisionReading };

const BASES = {
  clasicoOk: {
    reading: {
      bottle_model: "clasico",
      bottle_box: { x0: 318, y0: 220, x1: 578, y1: 1035 },
      cap_state: "ok",
      cap_box: { x0: 352, y0: 220, x1: 544, y1: 398 },
      spout_box: { x0: 340, y0: 398, x1: 560, y1: 432 },
      cap_gap_px: 0,
      liquid_surface_y: 565,
      confidence: 0.94,
      evidence: "Tapa roja asentada sin separación visible con el pico. Menisco nítido en la parte media del envase.",
    },
  },
  steviaOk: {
    reading: {
      bottle_model: "stevia",
      bottle_box: { x0: 330, y0: 260, x1: 566, y1: 1010 },
      cap_state: "ok",
      cap_box: { x0: 357, y0: 260, x1: 535, y1: 435 },
      spout_box: { x0: 410, y0: 432, x1: 490, y1: 470 },
      cap_gap_px: 0,
      liquid_surface_y: 610,
      confidence: 0.91,
      evidence: "Tapa verde cerrada y a ras del pico. La superficie del líquido se distingue por el cambio de refracción.",
    },
  },
  clasicoAbierta: {
    reading: {
      bottle_model: "clasico",
      bottle_box: { x0: 318, y0: 115, x1: 668, y1: 1080 },
      cap_state: "abierta",
      cap_box: { x0: 340, y0: 115, x1: 668, y1: 492 },
      spout_box: { x0: 412, y0: 250, x1: 478, y1: 330 },
      cap_gap_px: 38,
      liquid_surface_y: 672,
      confidence: 0.88,
      evidence: "El capuchón flip-top está levantado y deja el pico expuesto. Nivel por debajo de lo habitual.",
    },
  },
  steviaSinTapa: {
    reading: {
      bottle_model: "stevia",
      bottle_box: { x0: 322, y0: 280, x1: 572, y1: 1048 },
      cap_state: "ausente",
      cap_box: null,
      spout_box: { x0: 412, y0: 280, x1: 480, y1: 400 },
      cap_gap_px: null,
      liquid_surface_y: 760,
      confidence: 0.86,
      evidence: "No hay tapa: el gotero blanco queda descubierto. El líquido llega a la mitad del envase.",
    },
  },
  steviaMal: {
    reading: {
      bottle_model: "stevia",
      bottle_box: { x0: 296, y0: 175, x1: 572, y1: 1062 },
      cap_state: "mal_colocada",
      cap_box: { x0: 296, y0: 175, x1: 545, y1: 500 },
      spout_box: { x0: 375, y0: 490, x1: 525, y1: 560 },
      cap_gap_px: 18,
      liquid_surface_y: 768,
      confidence: 0.83,
      evidence: "La tapa verde está inclinada y apoyada; se ve una separación de unos 18 px con el pico.",
    },
  },
  clasicoBajo: {
    reading: {
      bottle_model: "clasico",
      bottle_box: { x0: 312, y0: 210, x1: 584, y1: 1050 },
      cap_state: "ok",
      cap_box: { x0: 328, y0: 210, x1: 564, y1: 455 },
      spout_box: { x0: 352, y0: 455, x1: 560, y1: 482 },
      cap_gap_px: 0,
      liquid_surface_y: 722,
      confidence: 0.92,
      evidence: "Tapa roja correcta. El menisco queda claramente por debajo de la mitad del envase.",
    },
  },
  clasicoAlto: {
    reading: {
      bottle_model: "clasico",
      bottle_box: { x0: 312, y0: 205, x1: 588, y1: 1050 },
      cap_state: "ok",
      cap_box: { x0: 358, y0: 205, x1: 540, y1: 372 },
      spout_box: { x0: 372, y0: 372, x1: 528, y1: 394 },
      cap_gap_px: 0,
      liquid_surface_y: 440,
      confidence: 0.9,
      evidence: "Tapa cerrada. El líquido sube hasta el hombro del envase, casi sin cámara de aire.",
    },
  },
  steviaAbierta: {
    reading: {
      bottle_model: "stevia",
      bottle_box: { x0: 322, y0: 195, x1: 576, y1: 1055 },
      cap_state: "abierta",
      cap_box: { x0: 360, y0: 195, x1: 537, y1: 455 },
      spout_box: { x0: 420, y0: 265, x1: 480, y1: 335 },
      cap_gap_px: 44,
      liquid_surface_y: 700,
      confidence: 0.87,
      evidence: "Capuchón verde abierto hacia arriba. Menisco visible por debajo del rango esperado.",
    },
  },
} satisfies Record<string, Base>;

type BaseKey = keyof typeof BASES;
type Variant = {
  name: string;
  base: BaseKey;
  patch?: Partial<VisionReading>;
  status?: Item["status"];
  error?: string;
};

const VARIANTS: Variant[] = [
  { name: "L1-0832-clasico.jpg", base: "clasicoOk" },
  { name: "L1-0833-stevia.jpg", base: "steviaOk" },
  { name: "L1-0834-clasico.jpg", base: "clasicoAbierta" },
  { name: "L1-0835-stevia.jpg", base: "steviaMal" },
  { name: "L1-0836-clasico.jpg", base: "clasicoBajo" },
  { name: "L1-0837-clasico.jpg", base: "clasicoAlto" },
  { name: "L1-0838-stevia.jpg", base: "steviaSinTapa" },
  { name: "L1-0839-stevia.jpg", base: "steviaOk", patch: { liquid_surface_y: 598, confidence: 0.89 } },
  {
    name: "L1-0840-stevia.jpg",
    base: "steviaAbierta",
    patch: { liquid_surface_y: null, evidence: "Capuchón abierto. El reflejo del techo tapa el menisco y no se puede medir el nivel." },
  },
  {
    name: "L1-0841-clasico.jpg",
    base: "clasicoOk",
    patch: { confidence: 0.58, liquid_surface_y: 571, evidence: "Tapa aparentemente cerrada; el contraste es bajo y el borde del menisco es difuso." },
  },
  {
    name: "L1-0842-stevia.jpg",
    base: "steviaOk",
    patch: { liquid_surface_y: null, confidence: 0.64, evidence: "Tapa correcta. No se distingue la superficie del líquido por el brillo del fondo." },
  },
  {
    name: "L1-0843-desconocido.jpg",
    base: "clasicoOk",
    patch: { bottle_model: "desconocido", confidence: 0.72, evidence: "Envase compatible pero sin rasgos claros de Clásico o Stevia." },
  },
  {
    name: "L1-0844-clasico.jpg",
    base: "clasicoAbierta",
    patch: { liquid_surface_y: null, evidence: "Capuchón abierto con el pico a la vista. El nivel queda oculto por la tapa levantada." },
  },
  { name: "L1-0845-stevia.jpg", base: "steviaAbierta" },
  { name: "L1-0846-clasico.jpg", base: "clasicoOk", patch: { liquid_surface_y: 556 } },
  {
    name: "L1-0847-stevia.jpg",
    base: "steviaOk",
    patch: { confidence: 0.12, evidence: "La imagen está muy movida; no se identifica con seguridad una botella." },
  },
  {
    name: "L1-0848-stevia.jpg",
    base: "steviaMal",
    patch: { liquid_surface_y: null, evidence: "Tapa inclinada sobre el pico. No se distingue el menisco." },
  },
  { name: "L1-0849-clasico.jpg", base: "clasicoBajo", patch: { liquid_surface_y: 700 } },
  {
    name: "L1-0850-stevia.jpg",
    base: "steviaSinTapa",
    patch: { liquid_surface_y: null, evidence: "Sin tapa: gotero expuesto. No hay contraste suficiente para leer el nivel." },
  },
  { name: "L1-0851-clasico.jpg", base: "clasicoAlto", patch: { liquid_surface_y: 452 } },
  { name: "L1-0852-stevia.jpg", base: "steviaOk", status: "error", error: "El modelo maestro rechazó la imagen." },
  { name: "L1-0853-clasico.jpg", base: "clasicoOk", status: "error", error: "Falta ANTHROPIC_API_KEY en el servidor." },
  { name: "L1-0854-clasico.jpg", base: "clasicoOk", status: "pending" },
  { name: "L1-0855-stevia.jpg", base: "steviaOk", status: "pending" },
];

const readingFor = (v: Variant): VisionReading => ({ ...BASES[v.base].reading, ...v.patch });
const T0 = Date.parse("2026-10-24T09:12:00-03:00");

export function buildResult(reading: VisionReading, bands: Bands, i: number, width = W, height = H): InspectionResult {
  return {
    id: `insp_${(48213 + i).toString(36)}`,
    createdAt: new Date(T0 + i * 41_000).toISOString(),
    width,
    height,
    reading,
    verdict: judge(reading, bands[bandKey(reading.bottle_model)]),
    model: TEACHER_MODEL,
    latencyMs: 2100 + ((i * 737) % 2400),
  };
}

export function mockFeedback(result: InspectionResult, i: number): { comparison: Comparison; sample: Sample } {
  const { reading, verdict } = result;
  const cat = verdict.bottle.category;
  const labelClass = classFor(reading.cap_state, verdict.bottle.level);
  let reason: string | null = null;
  if (cat === "INDETERMINADO") reason = "el maestro no pudo medir la botella o el nivel";
  else if (reading.confidence < 0.7) reason = `confianza del maestro ${reading.confidence.toFixed(2)}`;
  return {
    comparison: {
      outcome: "teacher_only",
      verdictMatch: null,
      capStateMatch: null,
      defectsMatch: null,
      categoryMatch: null,
      bottleIou: null,
      capIou: null,
      levelDelta: null,
    },
    sample: { id: `smp_${(9100 + i).toString(36)}`, status: reason ? "pending" : "approved", labelClass, reason },
  };
}

export function classFor(cap: CapState, level: LevelStatus): DatasetClass | null {
  if (cap === "mal_colocada") return "mal_colocada";
  if (cap === "abierta") return "abierta";
  if (cap === "ausente") return "sin_tapa";
  if (level === "bajo") return "nivel_bajo";
  if (level === "alto") return "nivel_alto";
  if (level === "ok") return "ok";
  return null;
}

/** Lecturas que el maestro "devolvería" para cada foto conocida del lote demo. */
export function mockReadingByName(name: string): VisionReading | null {
  const v = VARIANTS.find((x) => x.name === name);
  return v ? readingFor(v) : null;
}

// --- PRNG determinístico para que server y cliente generen lo mismo ---
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export function hashString(str: string) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** Lectura plausible para una foto subida por el usuario (modo demo sin maestro). */
export function syntheticReading(name: string, width: number, height: number): VisionReading {
  const r = rng(hashString(name));
  const bw = width * (0.26 + r() * 0.08);
  const bh = height * (0.68 + r() * 0.1);
  const x0 = (width - bw) / 2;
  const y0 = height * (0.12 + r() * 0.06);
  const capH = bh * 0.2;
  const roll = r();
  const cap: CapState = roll < 0.6 ? "ok" : roll < 0.75 ? "mal_colocada" : roll < 0.9 ? "abierta" : "ausente";
  const model = r() < 0.5 ? "clasico" : "stevia";
  const frac = 0.36 + r() * 0.2;
  return {
    bottle_model: model,
    bottle_box: { x0, y0, x1: x0 + bw, y1: y0 + bh },
    cap_state: cap,
    cap_box: cap === "ausente" ? null : { x0: x0 + bw * 0.12, y0, x1: x0 + bw * 0.88, y1: y0 + capH },
    spout_box: { x0: x0 + bw * 0.3, y0: y0 + capH, x1: x0 + bw * 0.7, y1: y0 + capH * 1.2 },
    cap_gap_px: cap === "ok" ? 0 : cap === "ausente" ? null : Math.round(10 + r() * 30),
    liquid_surface_y: y0 + bh * frac,
    confidence: 0.62 + r() * 0.34,
    evidence:
      cap === "ok"
        ? "Tapa asentada sobre el pico. Menisco visible por el cambio de refracción."
        : "Se observa una separación entre la tapa y el pico. Menisco visible en el cuerpo del envase.",
  };
}

// --- Dataset ---
export function mockReviewQueue(): ReviewSample[] {
  return [];
}

export function mockDatasetSummary(): DatasetSummary {
  return {
    counts: { pending: 0, approved: 34, rejected: 5, exported: 22 },
    coverage: {
      clasico: { ok: 9, mal_colocada: 5, abierta: 7, sin_tapa: 3, nivel_bajo: 6, nivel_alto: 2 },
      stevia: { ok: 8, mal_colocada: 4, abierta: 2, sin_tapa: 1, nivel_bajo: 5, nivel_alto: 4 },
    },
    comparisons: { agree: 0, disagree: 0, teacher_only: 40 },
  };
}

// --- Tablero de línea ---
export const LINES = ["Línea 1", "Línea 2"] as const;

function days(n: number) {
  const out: string[] = [];
  const end = Date.parse("2026-10-24T12:00:00Z");
  for (let i = n - 1; i >= 0; i--) out.push(new Date(end - i * 86_400_000).toISOString().slice(0, 10));
  return out;
}

export function mockLineData(line: string) {
  const r = rng(hashString(line));
  const scale = line === "Línea 1" ? 1 : 0.62;
  const daily: LineDailyRow[] = [];
  const defects: LineDefectRow[] = [];
  const categories: LineCategoryRow[] = [];
  for (const day of days(30)) {
    const weekend = [0, 6].includes(new Date(day).getUTCDay());
    const total = Math.round((weekend ? 420 : 1180 + r() * 360) * scale);
    const nokRate = 0.035 + r() * 0.04;
    const nok = Math.round(total * nokRate);
    const other = Math.round(total * (0.006 + r() * 0.01));
    daily.push({ day, total, ok: total - nok - other, nok, other, avg_ms: Math.round(2300 + r() * 900) });
    const split = (n: number, w: number[]) => {
      const s = w.reduce((a, b) => a + b, 0);
      return w.map((x) => Math.round((n * x) / s));
    };
    const [cm, co, cx, ll, lh, ln] = split(nok, [3 + r() * 2, 2 + r() * 2, 0.6 + r(), 2.4 + r() * 2, 1 + r(), 0.8 + r()]);
    defects.push({
      day,
      CAP_MISALIGNED: cm,
      CAP_OPEN: co,
      CAP_MISSING: cx,
      LEVEL_LOW: ll,
      LEVEL_HIGH: lh,
      LEVEL_NOT_FOUND: ln,
      BOTTLE_NOT_FOUND: Math.round(other * 0.4),
    });
    const comb = Math.round(nok * (0.12 + r() * 0.08));
    const capOnly = Math.round((cm + co + cx) * 0.8);
    categories.push({
      day,
      OK: total - nok - other,
      ERROR_TAPA: capOnly,
      ERROR_NIVEL: Math.max(0, nok - capOnly - comb),
      ERROR_COMBINADO: comb,
      INDETERMINADO: other,
    });
  }
  return { daily, defects, categories, matrix: stateMatrix(r, scale) };
}

function stateMatrix(r: () => number, scale: number): StateMatrixCell[] {
  const caps: CapState[] = ["ok", "mal_colocada", "abierta", "ausente"];
  const levels: LevelStatus[] = ["ok", "bajo", "alto", "no_medido"];
  const out: StateMatrixCell[] = [];
  for (const cap of caps) {
    for (const level of levels) {
      const capErr = cap !== "ok";
      const lvlErr = level === "bajo" || level === "alto";
      let category: BottleCategory;
      let code: string;
      let base: number;
      if (capErr && lvlErr) [category, code, base] = ["ERROR_COMBINADO", `COMB:${cap}+${level}`, 18];
      else if (capErr) [category, code, base] = ["ERROR_TAPA", `TAPA:${cap}`, level === "ok" ? 260 : 40];
      else if (lvlErr) [category, code, base] = ["ERROR_NIVEL", `NIVEL:${level}`, level === "bajo" ? 310 : 120];
      else if (level === "no_medido") [category, code, base] = ["INDETERMINADO", "INDET:nivel_no_medido", 90];
      else [category, code, base] = ["OK", "OK", 26800];
      const capW = cap === "ok" ? 1 : cap === "mal_colocada" ? 1.4 : cap === "abierta" ? 1 : 0.4;
      out.push({ cap, level, category, code, count: Math.round(base * capW * scale * (0.8 + r() * 0.4)) });
    }
  }
  return out;
}

export const MOCK_AGREEMENT: ModelAgreementRow[] = [
  { version: "yolo-n-0.1", compared: 96, verdict_match: 0.84, cap_match: 0.79, bottle_iou: 0.81, cap_iou: 0.66, level_delta: 0.041 },
  { version: "yolo-n-0.2", compared: 188, verdict_match: 0.91, cap_match: 0.88, bottle_iou: 0.87, cap_iou: 0.74, level_delta: 0.026 },
];

export const MOCK_COMPARISON_OUTCOMES = { agree: 171, disagree: 17, teacher_only: 40 };

export { DEFAULT_BANDS };
