// Consultas de lectura para la interfaz: tablero de pérdidas, historial de botellas y fotos guardadas.
// Solo leen la base; las inspecciones las escribe /api/feedback (src/lib/feedback.ts).

import fs from "node:fs";
import path from "node:path";
import { DATA_DIR, getDb } from "@/lib/db";

export type Filters = {
  from?: string; // fecha YYYY-MM-DD, inclusive
  to?: string; // fecha YYYY-MM-DD, inclusive
  line?: string;
  model?: string; // clasico | stevia | desconocido
  category?: string;
  code?: string;
  engine?: string; // local | teacher
  id?: string; // una inspección puntual (lo usa getInspection)
};

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Filtros desde la query string (?from=&to=&line=&model=&category=&code=&engine=). */
export function filtersFrom(url: URL): Filters {
  const get = (k: string) => url.searchParams.get(k) || undefined;
  return {
    from: get("from"), to: get("to"), line: get("line"), model: get("model"),
    category: get("category"), code: get("code"), engine: get("engine"),
  };
}

/** WHERE común sobre inspections (alias i) a partir de los filtros. */
function where(f: Filters): { sql: string; params: unknown[] } {
  const parts: string[] = [];
  const params: unknown[] = [];
  if (f.from) {
    if (!DATE.test(f.from)) throw new Error("from debe ser YYYY-MM-DD.");
    parts.push("date(i.captured_at) >= ?");
    params.push(f.from);
  }
  if (f.to) {
    if (!DATE.test(f.to)) throw new Error("to debe ser YYYY-MM-DD.");
    parts.push("date(i.captured_at) <= ?");
    params.push(f.to);
  }
  for (const [col, val] of [
    ["i.id", f.id],
    ["i.line_id", f.line],
    ["i.bottle_model", f.model],
    ["i.category", f.category],
    ["i.classification_code", f.code],
    ["i.engine", f.engine],
  ] as const) {
    if (val) {
      parts.push(`${col} = ?`);
      params.push(val);
    }
  }
  return { sql: parts.length ? `WHERE ${parts.join(" AND ")}` : "", params };
}

const num = (v: unknown) => (v == null ? 0 : Number(v));

/** Tablero: botellas por categoría, pérdida, evolución diaria, matriz tapa × nivel y recorrido por etapas. */
export function getStats(f: Filters) {
  const db = getDb();
  const w = where(f);

  const byCategory = db
    .prepare(`SELECT COALESCE(i.category, 'SIN_CLASIFICAR') AS category, COUNT(*) AS n FROM inspections i ${w.sql} GROUP BY 1 ORDER BY 2 DESC`)
    .all(...w.params)
    .map((r) => ({ category: String(r.category), n: num(r.n) }));
  const total = byCategory.reduce((a, r) => a + r.n, 0);
  const ok = byCategory.find((r) => r.category === "OK")?.n ?? 0;
  const review = byCategory.find((r) => r.category === "INDETERMINADO")?.n ?? 0;
  const errors = byCategory
    .filter((r) => r.category.startsWith("ERROR_"))
    .reduce((a, r) => a + r.n, 0);

  const byCode = db
    .prepare(
      `SELECT i.classification_code AS code, i.category, COUNT(*) AS n FROM inspections i ${w.sql}
       ${w.sql ? "AND" : "WHERE"} i.classification_code IS NOT NULL GROUP BY 1, 2 ORDER BY 3 DESC`,
    )
    .all(...w.params)
    .map((r) => ({ code: String(r.code), category: String(r.category), n: num(r.n) }));

  const daily = db
    .prepare(
      `SELECT date(i.captured_at) AS day, i.line_id AS line, COUNT(*) AS total,
         SUM(i.category = 'OK') AS ok,
         SUM(i.category = 'ERROR_TAPA') AS error_tapa,
         SUM(i.category = 'ERROR_NIVEL') AS error_nivel,
         SUM(i.category = 'ERROR_COMBINADO') AS error_combinado,
         SUM(i.category = 'INDETERMINADO') AS indeterminado
       FROM inspections i ${w.sql} GROUP BY 1, 2 ORDER BY 1, 2`,
    )
    .all(...w.params)
    .map((r) => {
      const t = num(r.total);
      const errs = num(r.error_tapa) + num(r.error_nivel) + num(r.error_combinado);
      return {
        day: String(r.day), line: r.line == null ? null : String(r.line), total: t, ok: num(r.ok),
        errorTapa: num(r.error_tapa), errorNivel: num(r.error_nivel), errorCombinado: num(r.error_combinado),
        indeterminado: num(r.indeterminado), lossRate: t ? errs / t : 0,
      };
    });

  const stateMatrix = db
    .prepare(
      `SELECT i.cap_status AS cap, i.level_status AS level, COUNT(*) AS n FROM inspections i ${w.sql}
       ${w.sql ? "AND" : "WHERE"} i.cap_status IS NOT NULL GROUP BY 1, 2`,
    )
    .all(...w.params)
    .map((r) => ({ cap: String(r.cap), level: String(r.level), n: num(r.n) }));

  // Recorrido de las botellas por las etapas del sistema.
  const funnelRow = db
    .prepare(
      `SELECT COUNT(*) AS inspected,
         SUM(i.category IS NOT NULL) AS classified,
         SUM(t.id IS NOT NULL) AS teacher_verified,
         SUM(f.outcome = 'agree') AS model_agrees,
         SUM(f.outcome = 'disagree') AS model_disagrees,
         SUM(s.status IN ('approved', 'exported')) AS dataset_approved,
         SUM(s.status = 'pending') AS dataset_pending,
         SUM(s.status = 'exported') AS dataset_exported
       FROM inspections i
       LEFT JOIN teacher_reviews t ON t.inspection_id = i.id
       LEFT JOIN feedback_comparisons f ON f.inspection_id = i.id
       LEFT JOIN dataset_samples s ON s.inspection_id = i.id
       ${w.sql}`,
    )
    .get(...w.params) ?? {};
  const funnel = Object.fromEntries(Object.entries(funnelRow).map(([k, v]) => [k, num(v)]));

  return {
    filters: f,
    total,
    ok,
    errors,
    review,
    /** Pérdida = botellas con error / total. Las indeterminadas van aparte (a revisar). */
    lossRate: total ? errors / total : 0,
    byCategory,
    byCode,
    daily,
    stateMatrix,
    funnel,
  };
}

/** Historial de botellas, más nuevas primero, con la verificación del maestro y el estado de la muestra. */
export function listInspections(f: Filters, limit = 50, offset = 0) {
  const db = getDb();
  const w = where(f);
  const lim = Math.min(200, Math.max(1, Math.floor(limit)));
  const off = Math.max(0, Math.floor(offset));
  const total = num(db.prepare(`SELECT COUNT(*) AS n FROM inspections i ${w.sql}`).get(...w.params)?.n);
  const items = db
    .prepare(
      `SELECT i.id, i.captured_at, i.line_id, i.bottle_model, i.engine, i.verdict, i.category, i.classification_code,
         i.cap_status, i.level_status, i.level_fraction, i.overall_confidence, i.processing_ms,
         mv.name AS model_version,
         a.id AS image_id, a.width, a.height,
         t.model AS teacher_model, t.category AS teacher_category, t.classification_code AS teacher_code,
         t.confidence AS teacher_confidence,
         f.outcome AS comparison, f.category_match, f.bottle_iou, f.cap_iou, f.level_delta,
         s.id AS sample_id, s.status AS sample_status, s.label_class, s.review_reason
       FROM inspections i
       LEFT JOIN model_versions mv ON mv.id = i.model_version_id
       LEFT JOIN image_assets a ON a.inspection_id = i.id AND a.kind = 'original'
       LEFT JOIN teacher_reviews t ON t.inspection_id = i.id
       LEFT JOIN feedback_comparisons f ON f.inspection_id = i.id
       LEFT JOIN dataset_samples s ON s.inspection_id = i.id
       ${w.sql}
       ORDER BY i.captured_at DESC
       LIMIT ? OFFSET ?`,
    )
    .all(...w.params, lim, off)
    .map((r) => ({
      id: String(r.id),
      capturedAt: String(r.captured_at),
      line: r.line_id ?? null,
      bottleModel: r.bottle_model ?? null,
      engine: r.engine ?? null,
      modelVersion: r.model_version ?? null,
      verdict: r.verdict,
      category: r.category ?? null,
      code: r.classification_code ?? null,
      cap: r.cap_status ?? null,
      level: r.level_status ?? null,
      levelFraction: r.level_fraction ?? null,
      confidence: r.overall_confidence ?? null,
      processingMs: r.processing_ms ?? null,
      image: r.image_id ? { id: String(r.image_id), url: `/api/images/${r.image_id}`, width: r.width, height: r.height } : null,
      teacher: r.teacher_model
        ? { model: r.teacher_model, category: r.teacher_category, code: r.teacher_code, confidence: r.teacher_confidence }
        : null,
      comparison: r.comparison
        ? {
            outcome: r.comparison, categoryMatch: r.category_match == null ? null : r.category_match === 1,
            bottleIou: r.bottle_iou, capIou: r.cap_iou, levelDelta: r.level_delta,
          }
        : null,
      sample: r.sample_id
        ? { id: String(r.sample_id), status: r.sample_status, labelClass: r.label_class, reason: r.review_reason }
        : null,
    }));
  return { total, limit: lim, offset: off, items };
}

/** Detalle completo de una inspección: lo del historial más lecturas y cajas de los dos modelos. */
export function getInspection(id: string) {
  const item = listInspections({ id }, 1, 0).items[0];
  if (!item) return null;
  const db = getDb();
  const detections = db
    .prepare("SELECT source, class_name, confidence, x, y, width, height FROM detections WHERE inspection_id = ? ORDER BY source, confidence DESC")
    .all(id)
    .map((d) => ({
      source: d.source, className: d.class_name, confidence: d.confidence,
      box: { x0: d.x, y0: d.y, x1: num(d.x) + num(d.width), y1: num(d.y) + num(d.height) },
    }));
  const defects = db.prepare("SELECT code, confidence, details_json FROM defects WHERE inspection_id = ?").all(id)
    .map((d) => ({ code: d.code, confidence: d.confidence, details: JSON.parse(String(d.details_json ?? "{}")) }));
  const teacher = db.prepare("SELECT reading_json, latency_ms, created_at FROM teacher_reviews WHERE inspection_id = ?").get(id);
  return {
    ...item,
    detections,
    defects,
    teacherReading: teacher?.reading_json ? JSON.parse(String(teacher.reading_json)) : null,
    teacherLatencyMs: teacher?.latency_ms ?? null,
  };
}

/** Archivo de una foto guardada (image_assets.id). Devuelve null si no existe o está fuera de data/. */
export function getImageFile(id: string): { file: string; mime: string } | null {
  const row = getDb().prepare("SELECT relative_path, mime_type FROM image_assets WHERE id = ?").get(id);
  if (!row) return null;
  const file = path.resolve(DATA_DIR, String(row.relative_path));
  if (!file.startsWith(DATA_DIR + path.sep) || !fs.existsSync(file)) return null;
  return { file, mime: String(row.mime_type) };
}
