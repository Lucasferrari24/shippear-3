// Retroalimentación modelo local ↔ maestro: guarda la foto y las dos lecturas, las compara
// y deja la muestra en la cola del dataset (dataset_samples) para reentrenar.

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DATA_DIR, getDb, tx, type Db } from "@/lib/db";
import {
  DEFAULT_BANDS,
  judge,
  type Box,
  type DefectCode,
  type LevelBand,
  type Verdict,
  type VisionReading,
} from "@/lib/inspection";
import type { BottleState } from "@/lib/bottle";
import type { TeacherResult } from "@/lib/teacher";

/** Clases del detector, en el mismo orden que ml/config.yaml. */
export const DETECTOR_CLASSES = [
  "botella", "tapa_ok", "tapa_mal_colocada", "tapa_abierta", "pico_sin_tapa", "menisco",
] as const;

const CAP_CLASS: Record<VisionReading["cap_state"], (typeof DETECTOR_CLASSES)[number]> = {
  ok: "tapa_ok",
  mal_colocada: "tapa_mal_colocada",
  abierta: "tapa_abierta",
  ausente: "pico_sin_tapa",
};

/** Código de la app → código de la tabla defects. */
const DB_DEFECT: Record<DefectCode, string> = {
  TAPA_MAL_COLOCADA: "CAP_MISALIGNED",
  TAPA_ABIERTA: "CAP_OPEN",
  SIN_TAPA: "CAP_MISSING",
  NIVEL_BAJO: "LEVEL_LOW",
  NIVEL_ALTO: "LEVEL_HIGH",
  NIVEL_NO_DETECTADO: "LEVEL_NOT_FOUND",
  BOTELLA_NO_DETECTADA: "BOTTLE_NOT_FOUND",
};

/** Por debajo de esta confianza del maestro, la muestra espera revisión humana. */
const MIN_TEACHER_CONFIDENCE = Number(process.env.FEEDBACK_MIN_TEACHER_CONF ?? 0.7);

export type Detection = { class_name: string; confidence: number; box: Box };

/** Lo que manda el navegador cuando corrió el modelo local. */
export type LocalPrediction = {
  reading: VisionReading;
  detections?: Detection[];
  latencyMs?: number;
  modelVersion?: { name: string; sha256?: string };
};

export type FeedbackInput = {
  image: string;
  width: number;
  height: number;
  lineId?: string;
  capturedAt?: string;
  band?: LevelBand;
  local?: LocalPrediction;
  /** Origen de la foto: 'camera' para la cámara en vivo, 'upload' (por defecto) para fotos subidas. */
  source?: "camera" | "upload";
  /** Estado votado por el rastreador de la cámara: manda sobre el del cuadro guardado. */
  state?: BottleState;
  /** Datos del rastreo: cuadros vistos y votos por código. */
  track?: { frames: number; votes: Record<string, number> };
};

export type Comparison = {
  outcome: "agree" | "disagree" | "teacher_only";
  verdictMatch: boolean | null;
  capStateMatch: boolean | null;
  defectsMatch: boolean | null;
  categoryMatch: boolean | null;
  bottleIou: number | null;
  capIou: number | null;
  levelDelta: number | null;
};

export type FeedbackResult = {
  inspectionId: string;
  local: { verdict: Verdict } | null;
  teacher: { verdict: Verdict; reading: VisionReading; model: string; latencyMs: number };
  comparison: Comparison;
  sample: { id: string; status: string; labelClass: string | null; reason: string | null };
};

export function iou(a: Box | null | undefined, b: Box | null | undefined): number | null {
  if (!a || !b) return null;
  const w = Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0));
  const h = Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0));
  const inter = w * h;
  const area = (r: Box) => Math.max(0, r.x1 - r.x0) * Math.max(0, r.y1 - r.y0);
  const union = area(a) + area(b) - inter;
  return union > 0 ? inter / union : null;
}

/** Defectos que importan para el dataset: los de tapa y nivel (sin los de "no pude medir"). */
function realDefects(v: Verdict): DefectCode[] {
  return v.defects.filter((d) => d !== "NIVEL_NO_DETECTADO" && d !== "BOTELLA_NO_DETECTADA");
}

export function compare(local: { reading: VisionReading; verdict: Verdict } | null, teacher: { reading: VisionReading; verdict: Verdict }): Comparison {
  if (!local) {
    return {
      outcome: "teacher_only", verdictMatch: null, capStateMatch: null, defectsMatch: null, categoryMatch: null,
      bottleIou: null, capIou: null, levelDelta: null,
    };
  }
  const verdictMatch = local.verdict.status === teacher.verdict.status;
  const capStateMatch = local.reading.cap_state === teacher.reading.cap_state;
  const a = new Set(realDefects(local.verdict));
  const b = new Set(realDefects(teacher.verdict));
  const defectsMatch = a.size === b.size && [...a].every((d) => b.has(d));
  const categoryMatch = local.verdict.bottle.code === teacher.verdict.bottle.code;
  const capBox = (r: VisionReading) => (r.cap_state === "ausente" ? r.spout_box : r.cap_box);
  const lf = local.verdict.levelFraction;
  const tf = teacher.verdict.levelFraction;
  return {
    outcome: verdictMatch && capStateMatch && defectsMatch && categoryMatch ? "agree" : "disagree",
    verdictMatch,
    capStateMatch,
    defectsMatch,
    categoryMatch,
    bottleIou: iou(local.reading.bottle_box, teacher.reading.bottle_box),
    capIou: iou(capBox(local.reading), capBox(teacher.reading)),
    levelDelta: lf != null && tf != null ? lf - tf : null,
  };
}

/** Clase de carpeta del dataset (data/README.md) según el veredicto del maestro. */
export function labelClass(reading: VisionReading, verdict: Verdict): string | null {
  if (verdict.defects.includes("BOTELLA_NO_DETECTADA")) return null;
  if (reading.cap_state === "ausente") return "sin_tapa";
  if (reading.cap_state === "abierta") return "abierta";
  if (reading.cap_state === "mal_colocada") return "mal_colocada";
  if (verdict.defects.includes("NIVEL_NO_DETECTADO")) return null;
  if (verdict.defects.includes("NIVEL_BAJO")) return "nivel_bajo";
  if (verdict.defects.includes("NIVEL_ALTO")) return "nivel_alto";
  return "ok";
}

/** Cajas de una lectura con las clases del detector (igual que ml/autolabel.py). */
export function readingToDetections(r: VisionReading, confidence: number): Detection[] {
  const out: Detection[] = [];
  if (r.bottle_box) out.push({ class_name: "botella", confidence, box: r.bottle_box });
  const cap = r.cap_state === "ausente" ? r.spout_box ?? r.cap_box : r.cap_box ?? r.spout_box;
  if (cap) out.push({ class_name: CAP_CLASS[r.cap_state], confidence, box: cap });
  if (r.liquid_surface_y != null && r.bottle_box) {
    const half = Math.max(3, 0.012 * (r.bottle_box.y1 - r.bottle_box.y0));
    out.push({
      class_name: "menisco",
      confidence,
      box: { x0: r.bottle_box.x0, x1: r.bottle_box.x1, y0: r.liquid_surface_y - half, y1: r.liquid_surface_y + half },
    });
  }
  return out;
}

function bandFor(conn: Db, model: VisionReading["bottle_model"], override?: LevelBand): LevelBand {
  if (override) return override;
  const sku = model === "stevia" ? "stevia" : "clasico";
  const row = conn.prepare("SELECT fill_band_min, fill_band_max FROM product_recipes WHERE sku = ?").get(sku);
  if (row?.fill_band_min != null && row?.fill_band_max != null) {
    return { min: Number(row.fill_band_min), max: Number(row.fill_band_max) };
  }
  return DEFAULT_BANDS[sku];
}

function saveImage(id: string, image: string) {
  const match = /^data:(image\/(jpeg|png|webp));base64,(.+)$/.exec(image);
  if (!match) throw new Error("La imagen debe ser un data URL jpeg/png/webp.");
  const bytes = Buffer.from(match[3], "base64");
  const ext = match[2] === "jpeg" ? "jpg" : match[2];
  const rel = path.posix.join("captures", new Date().toISOString().slice(0, 10), `${id}.${ext}`);
  const abs = path.join(DATA_DIR, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, bytes);
  return { rel, mime: match[1], bytes: bytes.length, sha256: crypto.createHash("sha256").update(bytes).digest("hex") };
}

function upsertModelVersion(conn: Db, mv: LocalPrediction["modelVersion"]): string | null {
  if (!mv) return null;
  const existing = conn.prepare("SELECT id FROM model_versions WHERE name = ?").get(mv.name);
  if (existing) return String(existing.id);
  const id = crypto.randomUUID();
  conn
    .prepare(
      "INSERT INTO model_versions (id, name, format, relative_path, sha256, classes_json, is_active) VALUES (?, ?, 'onnx', 'public/models/centinela.onnx', ?, ?, 1)",
    )
    .run(id, mv.name, mv.sha256 ?? null, JSON.stringify(DETECTOR_CLASSES));
  return id;
}

function insertDetections(conn: Db, inspectionId: string, dets: Detection[], source: "model" | "teacher") {
  const stmt = conn.prepare(
    "INSERT INTO detections (id, inspection_id, yolo_class_id, class_name, confidence, x, y, width, height, coordinate_space, source) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pixel', ?)",
  );
  for (const d of dets) {
    const classId = DETECTOR_CLASSES.indexOf(d.class_name as (typeof DETECTOR_CLASSES)[number]);
    stmt.run(
      crypto.randomUUID(), inspectionId, classId >= 0 ? classId : null, d.class_name,
      Math.min(1, Math.max(0, d.confidence)), d.box.x0, d.box.y0,
      Math.max(0, d.box.x1 - d.box.x0), Math.max(0, d.box.y1 - d.box.y0), source,
    );
  }
}

/** Defectos que corresponden a un estado de botella (los mismos que daría judge()). */
function stateDefects(s: BottleState): DefectCode[] {
  if (!s.detected) return ["BOTELLA_NO_DETECTADA"];
  const out: DefectCode[] = [];
  if (s.cap === "mal_colocada") out.push("TAPA_MAL_COLOCADA");
  if (s.cap === "abierta") out.push("TAPA_ABIERTA");
  if (s.cap === "ausente") out.push("SIN_TAPA");
  if (s.level === "bajo") out.push("NIVEL_BAJO");
  if (s.level === "alto") out.push("NIVEL_ALTO");
  if (s.level === "no_medido") out.push("NIVEL_NO_DETECTADO");
  return out;
}

type SavedImage = ReturnType<typeof saveImage>;

/**
 * Inserta la inspección, su foto, sus defectos y la medición de nivel. Devuelve el id de la foto.
 * Si viene `input.state` (el estado votado por el rastreador de la cámara), manda sobre el del cuadro.
 */
function insertInspection(
  c: Db,
  a: {
    id: string; img: SavedImage; input: FeedbackInput; engine: "local" | "teacher"; modelVersionId: string | null;
    reading: VisionReading; verdict: Verdict; ms: number | null;
  },
): string {
  const now = new Date().toISOString();
  const state = a.input.state ?? a.verdict.bottle;
  const defects = stateDefects(state);
  const model = state.model ?? a.reading.bottle_model;
  const recipe = model === "desconocido" ? null : `recipe-${model}`;
  // INDETERMINADO no pasa como OK ni se cuenta como defecto: queda en REVIEW.
  const dbVerdict = state.category === "INDETERMINADO" ? "REVIEW" : state.category === "OK" ? "OK" : "NOK";
  const confidence = Math.min(1, Math.max(0, a.reading.confidence));
  c.prepare(
    `INSERT INTO inspections (id, captured_at, processed_at, verdict, recipe_id, model_version_id, processing_ms,
       overall_confidence, source, line_id, engine, bottle_model, level_fraction,
       cap_status, level_status, category, classification_code)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    a.id, a.input.capturedAt ?? now, now, dbVerdict, recipe, a.modelVersionId,
    a.ms != null ? Math.round(a.ms) : null, confidence, a.input.source ?? "upload",
    a.input.lineId ?? "line-1", a.engine, model, state.levelFraction,
    state.cap, state.level, state.category, state.code,
  );
  const assetId = crypto.randomUUID();
  c.prepare(
    "INSERT INTO image_assets (id, inspection_id, kind, relative_path, mime_type, sha256, bytes, width, height) VALUES (?, ?, 'original', ?, ?, ?, ?, ?, ?)",
  ).run(assetId, a.id, a.img.rel, a.img.mime, a.img.sha256, a.img.bytes, a.input.width, a.input.height);

  const defect = c.prepare("INSERT INTO defects (id, inspection_id, code, confidence, details_json) VALUES (?, ?, ?, ?, ?)");
  for (const d of defects) {
    const details = { engine: a.engine, app_code: d, ...(a.input.track ? { track: a.input.track } : {}) };
    defect.run(crypto.randomUUID(), a.id, DB_DEFECT[d], confidence, JSON.stringify(details));
  }
  if (state.levelFraction != null) {
    c.prepare(
      "INSERT INTO inspection_measurements (id, inspection_id, metric, value, unit, lower_limit, upper_limit, passed) VALUES (?, ?, 'fill_level', ?, 'fraction', ?, ?, ?)",
    ).run(
      crypto.randomUUID(), a.id, state.levelFraction, a.verdict.band.min, a.verdict.band.max,
      state.level === "bajo" || state.level === "alto" ? 0 : 1,
    );
  }
  return assetId;
}

export type InspectionInput = FeedbackInput & {
  /** Qué modelo produjo la lectura: el YOLO local o Claude. */
  engine: "local" | "teacher";
  /** La lectura y las detecciones del cuadro elegido (para el YOLO, las que devolvió /api/predict). */
  reading: VisionReading;
  detections?: Detection[];
  latencyMs?: number;
  modelVersion?: string;
};

/**
 * Guarda una botella sin pasar por el maestro: la decisión del modelo que la analizó, su foto y su estado.
 * Es lo que usa la cámara para que el tablero cuente todo lo que pasa por la línea, sin costo de API.
 */
export function recordInspection(input: InspectionInput): { inspectionId: string; state: BottleState } {
  const conn = getDb();
  const inspectionId = crypto.randomUUID();
  const img = saveImage(inspectionId, input.image);
  const verdict = judge(input.reading, bandFor(conn, input.reading.bottle_model, input.band));
  tx((c) => {
    const modelVersionId = input.engine === "local" && input.modelVersion
      ? upsertModelVersion(c, { name: input.modelVersion })
      : null;
    insertInspection(c, {
      id: inspectionId, img, input, engine: input.engine, modelVersionId,
      reading: input.reading, verdict, ms: input.latencyMs ?? null,
    });
    insertDetections(
      c, inspectionId, input.detections ?? readingToDetections(input.reading, input.reading.confidence),
      input.engine === "local" ? "model" : "teacher",
    );
  });
  return { inspectionId, state: input.state ?? verdict.bottle };
}

/**
 * Guarda una inspección verificada por el maestro.
 * El veredicto de la inspección es el del modelo local si vino; si no, el del maestro.
 */
export function recordFeedback(input: FeedbackInput, teacher: TeacherResult): FeedbackResult {
  const conn = getDb();
  const inspectionId = crypto.randomUUID();
  const img = saveImage(inspectionId, input.image);

  const teacherVerdict = judge(teacher.reading, bandFor(conn, teacher.reading.bottle_model, input.band));
  const localVerdict = input.local
    ? judge(input.local.reading, bandFor(conn, input.local.reading.bottle_model, input.band))
    : null;
  const comparison = compare(
    input.local && localVerdict ? { reading: input.local.reading, verdict: localVerdict } : null,
    { reading: teacher.reading, verdict: teacherVerdict },
  );

  const primary = input.local && localVerdict
    ? { engine: "local", reading: input.local.reading, verdict: localVerdict, ms: input.local.latencyMs ?? null }
    : { engine: "teacher", reading: teacher.reading, verdict: teacherVerdict, ms: teacher.latencyMs };

  const cls = labelClass(teacher.reading, teacherVerdict);
  const reasons: string[] = [];
  if (cls == null) reasons.push("el maestro no pudo medir la botella o el nivel");
  if (teacher.reading.confidence < MIN_TEACHER_CONFIDENCE) reasons.push(`confianza del maestro ${teacher.reading.confidence.toFixed(2)}`);
  const status = reasons.length ? "pending" : "approved";
  if (comparison.outcome === "disagree") reasons.push("el modelo local no coincide con el maestro");
  const sampleId = crypto.randomUUID();

  tx((c) => {
    const modelVersionId = input.local ? upsertModelVersion(c, input.local.modelVersion) : null;
    const assetId = insertInspection(c, {
      id: inspectionId, img, input, engine: primary.engine as "local" | "teacher", modelVersionId,
      reading: primary.reading, verdict: primary.verdict, ms: primary.ms,
    });
    if (input.local) {
      insertDetections(c, inspectionId, input.local.detections ?? readingToDetections(input.local.reading, input.local.reading.confidence), "model");
    }
    insertDetections(c, inspectionId, readingToDetections(teacher.reading, teacher.reading.confidence), "teacher");

    const reviewId = crypto.randomUUID();
    c.prepare(
      `INSERT INTO teacher_reviews (id, inspection_id, model, status, verdict, cap_state, bottle_model, defect_codes_json,
         level_fraction, confidence, reading_json, latency_ms, level_status, category, classification_code)
       VALUES (?, ?, ?, 'ok', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      reviewId, inspectionId, teacher.model, teacherVerdict.status, teacher.reading.cap_state, teacher.reading.bottle_model,
      JSON.stringify(teacherVerdict.defects), teacherVerdict.levelFraction, Math.min(1, Math.max(0, teacher.reading.confidence)),
      JSON.stringify({ ...teacher.reading, _width: input.width, _height: input.height }), Math.round(teacher.latencyMs),
      teacherVerdict.bottle.level, teacherVerdict.bottle.category, teacherVerdict.bottle.code,
    );
    const b = (v: boolean | null) => (v == null ? null : v ? 1 : 0);
    c.prepare(
      `INSERT INTO feedback_comparisons (id, inspection_id, teacher_review_id, model_version_id, outcome, verdict_match,
         cap_state_match, defects_match, category_match, bottle_iou, cap_iou, level_delta)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      crypto.randomUUID(), inspectionId, reviewId, modelVersionId, comparison.outcome, b(comparison.verdictMatch),
      b(comparison.capStateMatch), b(comparison.defectsMatch), b(comparison.categoryMatch),
      comparison.bottleIou, comparison.capIou, comparison.levelDelta,
    );
    c.prepare(
      `INSERT INTO dataset_samples (id, inspection_id, image_asset_id, bottle_model, label_class, label_source, status, priority, review_reason)
       VALUES (?, ?, ?, ?, ?, 'teacher', ?, ?, ?)`,
    ).run(
      sampleId, inspectionId, assetId, teacher.reading.bottle_model, cls, status,
      comparison.outcome === "disagree" ? 1 : 0, reasons.join("; ") || null,
    );
  });

  return {
    inspectionId,
    local: localVerdict ? { verdict: localVerdict } : null,
    teacher: { verdict: teacherVerdict, reading: teacher.reading, model: teacher.model, latencyMs: teacher.latencyMs },
    comparison,
    sample: { id: sampleId, status, labelClass: cls, reason: reasons.join("; ") || null },
  };
}

/** Resumen para la interfaz: cola del dataset y coincidencia del modelo local con el maestro. */
export function feedbackSummary() {
  const conn = getDb();
  const samples = conn.prepare("SELECT status, COUNT(*) AS n FROM dataset_samples GROUP BY status").all();
  const byClass = conn
    .prepare("SELECT bottle_model, label_class, COUNT(*) AS n FROM dataset_samples WHERE status IN ('approved', 'exported') GROUP BY bottle_model, label_class")
    .all();
  const outcomes = conn.prepare("SELECT outcome, COUNT(*) AS n FROM feedback_comparisons GROUP BY outcome").all();
  const agreement = conn.prepare("SELECT * FROM v_model_agreement").all();
  const pending = conn
    .prepare(
      `SELECT s.id, s.label_class, s.bottle_model, s.review_reason, s.priority, a.relative_path, s.created_at
       FROM dataset_samples s JOIN image_assets a ON a.id = s.image_asset_id
       WHERE s.status = 'pending' ORDER BY s.priority DESC, s.created_at LIMIT 50`,
    )
    .all();
  return { samples, byClass, outcomes, agreement, pending };
}

const LABEL_CLASSES = ["ok", "mal_colocada", "abierta", "sin_tapa", "nivel_bajo", "nivel_alto"];

/** Revisión humana de una muestra: aprobar (con la clase corregida si hace falta) o rechazar. */
export function reviewSample(id: string, status: "approved" | "rejected", labelClass?: string, reviewer?: string) {
  if (labelClass && !LABEL_CLASSES.includes(labelClass)) throw new Error(`Clase inválida: ${labelClass}`);
  const conn = getDb();
  const row = conn.prepare("SELECT label_class FROM dataset_samples WHERE id = ?").get(id);
  if (!row) throw new Error("No existe la muestra.");
  const finalClass = labelClass ?? (row.label_class as string | null);
  if (status === "approved" && !finalClass) throw new Error("Para aprobar hace falta la clase.");
  conn
    .prepare(
      `UPDATE dataset_samples SET status = ?, label_class = ?, label_source = CASE WHEN ? IS NOT NULL THEN 'human' ELSE label_source END,
         reviewed_by = ?, reviewed_at = ? WHERE id = ?`,
    )
    .run(status, finalClass, labelClass ?? null, reviewer ?? null, new Date().toISOString(), id);
}
