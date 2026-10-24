// Vistas de lectura con la forma exacta que usa la interfaz (ver src/lib/types.ts de la UI):
// tablero de línea, salud del modelo y cola del dataset. Solo leen la base.

import { getDb } from "@/lib/db";

const num = (v: unknown) => (v == null ? 0 : Number(v));

const CAPS = ["ok", "mal_colocada", "abierta", "ausente"] as const;
const LEVELS = ["ok", "bajo", "alto", "no_medido"] as const;
const DB_DEFECTS = [
  "CAP_MISALIGNED", "CAP_OPEN", "CAP_MISSING", "LEVEL_LOW", "LEVEL_HIGH", "LEVEL_NOT_FOUND", "BOTTLE_NOT_FOUND",
] as const;
const CATEGORIES = ["OK", "ERROR_TAPA", "ERROR_NIVEL", "ERROR_COMBINADO", "INDETERMINADO"] as const;
const SAMPLE_STATUSES = ["pending", "approved", "rejected", "exported"] as const;
const OUTCOMES = ["agree", "disagree", "teacher_only"] as const;
const DATASET_CLASSES = ["ok", "mal_colocada", "abierta", "sin_tapa", "nivel_bajo", "nivel_alto"] as const;

/** Categoría y código de una combinación tapa × nivel con botella detectada (misma lógica que judge). */
function cellState(cap: string, level: string): { category: string; code: string } {
  const capErr = cap !== "ok";
  const levelErr = level === "bajo" || level === "alto";
  if (capErr && levelErr) return { category: "ERROR_COMBINADO", code: `COMB:${cap}+${level}` };
  if (capErr) return { category: "ERROR_TAPA", code: `TAPA:${cap}` };
  if (levelErr) return { category: "ERROR_NIVEL", code: `NIVEL:${level}` };
  if (level === "no_medido") return { category: "INDETERMINADO", code: "INDET:nivel_no_medido" };
  return { category: "OK", code: "OK" };
}

/** Líneas con inspecciones guardadas (al menos la línea por defecto). */
export function getLines(): string[] {
  const rows = getDb().prepare("SELECT DISTINCT line_id FROM inspections WHERE line_id IS NOT NULL ORDER BY 1").all();
  const lines = rows.map((r) => String(r.line_id));
  return lines.length ? lines : ["line-1"];
}

/** Últimos `days` días (hasta hoy, UTC) en formato YYYY-MM-DD, del más viejo al más nuevo. */
function lastDays(days: number): string[] {
  const out: string[] = [];
  const now = Date.now();
  for (let i = days - 1; i >= 0; i--) out.push(new Date(now - i * 86_400_000).toISOString().slice(0, 10));
  return out;
}

/** Tablero de una línea: producción diaria, defectos y categorías por día y matriz tapa × nivel. */
export function getLineDashboard(line: string, days: number) {
  const db = getDb();
  const axis = lastDays(Math.min(90, Math.max(1, Math.floor(days) || 14)));
  const from = axis[0];

  const daily = new Map(
    db
      .prepare(
        `SELECT date(captured_at) AS day, COUNT(*) AS total,
           SUM(category = 'OK') AS ok,
           SUM(category IN ('ERROR_TAPA', 'ERROR_NIVEL', 'ERROR_COMBINADO')) AS nok,
           AVG(processing_ms) AS avg_ms
         FROM inspections WHERE line_id = ? AND date(captured_at) >= ? GROUP BY 1`,
      )
      .all(line, from)
      .map((r) => [String(r.day), r]),
  );

  const perDay = (sql: string) => {
    const out = new Map<string, Record<string, number>>();
    for (const r of db.prepare(sql).all(line, from)) {
      const day = String(r.day);
      out.set(day, { ...out.get(day), [String(r.k)]: num(r.n) });
    }
    return out;
  };
  const defects = perDay(
    `SELECT date(i.captured_at) AS day, d.code AS k, COUNT(*) AS n
     FROM defects d JOIN inspections i ON i.id = d.inspection_id
     WHERE i.line_id = ? AND date(i.captured_at) >= ? GROUP BY 1, 2`,
  );
  const categories = perDay(
    `SELECT date(captured_at) AS day, COALESCE(category, 'INDETERMINADO') AS k, COUNT(*) AS n
     FROM inspections WHERE line_id = ? AND date(captured_at) >= ? GROUP BY 1, 2`,
  );

  const counts = new Map<string, number>();
  for (const r of db
    .prepare(
      `SELECT cap_status AS cap, level_status AS level, COUNT(*) AS n FROM inspections
       WHERE line_id = ? AND date(captured_at) >= ? AND cap_status IS NOT NULL GROUP BY 1, 2`,
    )
    .all(line, from)) {
    counts.set(`${r.cap}|${r.level}`, num(r.n));
  }

  return {
    daily: axis.map((day) => {
      const r = daily.get(day);
      const total = num(r?.total);
      const ok = num(r?.ok);
      const nok = num(r?.nok);
      return { day, total, ok, nok, other: total - ok - nok, avg_ms: Math.round(num(r?.avg_ms)) };
    }),
    defects: axis.map((day) => ({ day, ...Object.fromEntries(DB_DEFECTS.map((c) => [c, defects.get(day)?.[c] ?? 0])) })),
    categories: axis.map((day) => ({ day, ...Object.fromEntries(CATEGORIES.map((c) => [c, categories.get(day)?.[c] ?? 0])) })),
    matrix: CAPS.flatMap((cap) =>
      LEVELS.map((level) => ({ cap, level, count: counts.get(`${cap}|${level}`) ?? 0, ...cellState(cap, level) })),
    ),
  };
}

/** Coincidencia del modelo local con el maestro, por versión, y conteo de comparaciones. */
export function getModelAgreement() {
  const db = getDb();
  const agreement = db
    .prepare(
      `SELECT COALESCE(mv.name, 'sin versión') AS version, a.compared, a.verdict_agreement, a.cap_agreement,
         a.mean_bottle_iou, a.mean_cap_iou, a.mean_level_delta
       FROM v_model_agreement a LEFT JOIN model_versions mv ON mv.id = a.model_version_id
       ORDER BY mv.created_at`,
    )
    .all()
    .map((r) => ({
      version: String(r.version),
      compared: num(r.compared),
      verdict_match: num(r.verdict_agreement),
      cap_match: num(r.cap_agreement),
      bottle_iou: num(r.mean_bottle_iou),
      cap_iou: num(r.mean_cap_iou),
      level_delta: num(r.mean_level_delta),
    }));
  const byOutcome = new Map(
    db
      .prepare("SELECT outcome, COUNT(*) AS n FROM feedback_comparisons GROUP BY outcome")
      .all()
      .map((r) => [String(r.outcome), num(r.n)]),
  );
  const outcomes = Object.fromEntries(OUTCOMES.map((o) => [o, byOutcome.get(o) ?? 0])) as Record<
    (typeof OUTCOMES)[number],
    number
  >;
  return { agreement, outcomes };
}

/** Cola de revisión (pendientes, con la lectura del maestro) y resumen del dataset. */
export function getDatasetView() {
  const db = getDb();
  const pending = db
    .prepare(
      `SELECT s.id, s.status, s.label_class, s.label_source, s.review_reason, s.priority, s.reviewed_by, s.created_at,
         a.id AS image_id, a.width, a.height, t.reading_json
       FROM dataset_samples s
       JOIN image_assets a ON a.id = s.image_asset_id
       LEFT JOIN teacher_reviews t ON t.inspection_id = s.inspection_id
       WHERE s.status = 'pending' ORDER BY s.priority DESC, s.created_at DESC LIMIT 50`,
    )
    .all()
    .flatMap((r) => {
      if (!r.reading_json) return [];
      const { _width, _height, ...reading } = JSON.parse(String(r.reading_json));
      const labelClass = r.label_class == null ? null : String(r.label_class);
      return [
        {
          id: String(r.id),
          status: String(r.status),
          labelClass,
          reason: r.review_reason == null ? null : String(r.review_reason),
          // En la base, prioridad 1 = desacuerdo con el modelo local; la interfaz ordena de 1 (primero) a 3.
          priority: num(r.priority) > 0 ? 1 : 2,
          createdAt: String(r.created_at),
          src: `/api/images/${r.image_id}`,
          width: num(r.width ?? _width),
          height: num(r.height ?? _height),
          reading,
          proposedClass: labelClass,
          humanLabel: r.label_source === "human",
          reviewer: r.reviewed_by == null ? null : String(r.reviewed_by),
        },
      ];
    });

  const byStatus = new Map(
    db
      .prepare("SELECT status, COUNT(*) AS n FROM dataset_samples GROUP BY status")
      .all()
      .map((r) => [String(r.status), num(r.n)]),
  );
  const coverage = {
    clasico: Object.fromEntries(DATASET_CLASSES.map((c) => [c, 0])),
    stevia: Object.fromEntries(DATASET_CLASSES.map((c) => [c, 0])),
  };
  for (const r of db
    .prepare(
      `SELECT bottle_model, label_class, COUNT(*) AS n FROM dataset_samples
       WHERE status IN ('approved', 'exported') AND label_class IS NOT NULL GROUP BY 1, 2`,
    )
    .all()) {
    const m = String(r.bottle_model);
    if (m === "clasico" || m === "stevia") coverage[m][String(r.label_class)] = num(r.n);
  }

  return {
    pending,
    summary: {
      counts: Object.fromEntries(SAMPLE_STATUSES.map((s) => [s, byStatus.get(s) ?? 0])),
      coverage,
      comparisons: getModelAgreement().outcomes,
    },
  };
}
