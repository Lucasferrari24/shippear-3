// API de LaVirshion / Centinela QC: el backend que corre en Render.
// La interfaz (Next.js en Vercel) la llama con NEXT_PUBLIC_API_URL; acá viven el modelo local (ONNX),
// el maestro (Claude), la base SQLite y las fotos guardadas.

import fs from "node:fs";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { getDb } from "@/lib/db";
import {
  feedbackSummary,
  recordFeedback,
  recordInspection,
  reviewSample,
  type FeedbackInput,
  type InspectionInput,
  type LocalPrediction,
} from "@/lib/feedback";
import { DEFAULT_BANDS, judge, type InspectionResult, type LevelBand } from "@/lib/inspection";
import { ensureLocalModel, hasLocalModel, localModelInfo, ModelUnavailableError, predictLocal } from "@/lib/localModel";
import { filtersFrom, getImageFile, getInspection, getStats, listInspections } from "@/lib/queries";
import { askTeacher, TEACHER_MODEL, TeacherError } from "@/lib/teacher";
import { getDatasetView, getLineDashboard, getLines, getModelAgreement } from "@/lib/views";

type ImageBody = { image: string; width: number; height: number; band?: LevelBand };

const app = new Hono();

/**
 * Orígenes permitidos: CORS_ORIGINS separado por comas. Acepta comodines (https://*.vercel.app)
 * para las previews de Vercel. Sin la variable se permite cualquiera (solo para desarrollo).
 */
const allowed = (process.env.CORS_ORIGINS ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean)
  .map((o) => new RegExp(`^${o.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^.]+")}$`));

app.use("*", logger());
app.use(
  "*",
  cors({
    origin: (origin) => (!allowed.length ? "*" : allowed.some((re) => re.test(origin)) ? origin : null),
    allowMethods: ["GET", "POST", "PATCH", "OPTIONS"],
    allowHeaders: ["content-type"],
    maxAge: 86400,
  }),
);

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
const noTeacher = () => !process.env.ANTHROPIC_API_KEY;

app.get("/", (c) => c.json({ name: "centinela-qc-backend", health: "/health" }));

/** Estado del servicio: lo usa Render para el health check y la interfaz para saber qué modelo usar. */
app.get("/health", async (c) => {
  const local = await localModelInfo();
  let db = true;
  try {
    getDb();
  } catch {
    db = false;
  }
  return c.json({
    ok: db,
    db,
    local,
    teacher: { configured: !noTeacher(), model: TEACHER_MODEL },
  });
});

/** Inspección con el maestro (Claude). */
app.post("/api/inspect", async (c) => {
  if (noTeacher()) return c.json({ error: "Falta ANTHROPIC_API_KEY en el servidor." }, 500);
  const { image, width, height, band }: ImageBody = await c.req.json();
  try {
    const teacher = await askTeacher(image, width, height);
    const { reading } = teacher;
    const fallback = DEFAULT_BANDS[reading.bottle_model === "stevia" ? "stevia" : "clasico"];
    const result: InspectionResult = {
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      width,
      height,
      reading,
      verdict: judge(reading, band ?? fallback),
      model: teacher.model,
      latencyMs: teacher.latencyMs,
    };
    return c.json(result);
  } catch (e) {
    return c.json({ error: message(e) }, e instanceof TeacherError ? 502 : 500);
  }
});

/** Inspección con el modelo local (YOLO entrenado, ONNX). Misma respuesta que /api/inspect, más las detecciones. */
app.post("/api/predict", async (c) => {
  const { image, width, height, band }: ImageBody = await c.req.json();
  try {
    const local = await predictLocal(image);
    const model = local.reading.bottle_model === "stevia" ? "stevia" : "clasico";
    return c.json({
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      width,
      height,
      reading: local.reading,
      verdict: judge(local.reading, band ?? local.bands?.[model] ?? DEFAULT_BANDS[model]),
      model: local.modelVersion,
      latencyMs: local.latencyMs,
      detections: local.detections,
    });
  } catch (e) {
    return c.json({ error: message(e) }, e instanceof ModelUnavailableError ? 503 : 500);
  }
});

/** Corre el modelo local en el servidor; si falla, la foto se guarda igual, solo con el maestro. */
async function localPrediction(image: string): Promise<LocalPrediction | undefined> {
  if (!hasLocalModel()) return undefined;
  try {
    const p = await predictLocal(image);
    return { reading: p.reading, detections: p.detections, latencyMs: p.latencyMs, modelVersion: { name: p.modelVersion } };
  } catch (e) {
    console.error("Modelo local:", message(e));
    return undefined;
  }
}

/**
 * Verifica una foto con el maestro y la compara con el modelo local: la predicción que mande el cliente
 * o, si no manda ninguna, la que corre acá con el ONNX entrenado. Todo se guarda en la base.
 */
app.post("/api/feedback", async (c) => {
  if (noTeacher()) return c.json({ error: "Falta ANTHROPIC_API_KEY en el servidor." }, 500);
  const body: FeedbackInput = await c.req.json();
  try {
    const [teacher, local] = await Promise.all([
      askTeacher(body.image, body.width, body.height),
      body.local ? Promise.resolve(body.local) : localPrediction(body.image),
    ]);
    return c.json(recordFeedback({ ...body, local }, teacher));
  } catch (e) {
    return c.json({ error: message(e) }, e instanceof TeacherError ? 502 : 500);
  }
});

/** Estado de la cola del dataset y coincidencia del modelo local con el maestro (formato crudo). */
app.get("/api/feedback", (c) => {
  try {
    return c.json(feedbackSummary());
  } catch (e) {
    return c.json({ error: message(e) }, 500);
  }
});

/** Cola de revisión y resumen del dataset, con la forma que usa la pantalla Dataset. */
app.get("/api/dataset", (c) => {
  try {
    return c.json(getDatasetView());
  } catch (e) {
    return c.json({ error: message(e) }, 500);
  }
});

/** Revisión humana de una muestra del dataset. */
app.patch("/api/dataset/:id", async (c) => {
  const { status, labelClass, reviewer }: { status: string; labelClass?: string; reviewer?: string } = await c.req.json();
  if (status !== "approved" && status !== "rejected") {
    return c.json({ error: "status debe ser approved o rejected." }, 400);
  }
  try {
    reviewSample(c.req.param("id"), status, labelClass ?? undefined, reviewer || undefined);
    return c.json({ ok: true });
  } catch (e) {
    return c.json({ error: message(e) }, 400);
  }
});

/** Tablero de pérdidas con filtros (?from=&to=&line=&model=&category=&code=&engine=). */
app.get("/api/stats", (c) => {
  try {
    return c.json(getStats(filtersFrom(new URL(c.req.url))));
  } catch (e) {
    return c.json({ error: message(e) }, 400);
  }
});

/** Líneas con inspecciones guardadas. */
app.get("/api/lines", (c) => {
  try {
    return c.json(getLines());
  } catch (e) {
    return c.json({ error: message(e) }, 500);
  }
});

/** Tablero de una línea: ?line=line-1&days=14. */
app.get("/api/dashboard", (c) => {
  try {
    return c.json(getLineDashboard(c.req.query("line") ?? "line-1", Number(c.req.query("days") ?? 14)));
  } catch (e) {
    return c.json({ error: message(e) }, 500);
  }
});

/** Salud del modelo local: versión cargada y coincidencia con el maestro. */
app.get("/api/model", async (c) => {
  try {
    const local = await localModelInfo();
    return c.json({
      local: { name: "YOLO nano · ONNX", integrated: local.available, version: local.version, sha: local.sha },
      ...getModelAgreement(),
    });
  } catch (e) {
    return c.json({ error: message(e) }, 500);
  }
});

/** Historial de botellas guardadas, más nuevas primero. Mismos filtros que /api/stats, más limit y offset. */
app.get("/api/inspections", (c) => {
  const url = new URL(c.req.url);
  try {
    const limit = Number(url.searchParams.get("limit") ?? 50);
    const offset = Number(url.searchParams.get("offset") ?? 0);
    return c.json(listInspections(filtersFrom(url), limit, offset));
  } catch (e) {
    return c.json({ error: message(e) }, 400);
  }
});

/**
 * Guarda una botella con la decisión de un solo modelo, sin llamar al maestro (sin costo de API).
 * La usa la cámara para que el tablero cuente cada botella que pasa.
 */
app.post("/api/inspections", async (c) => {
  const body = (await c.req.json()) as InspectionInput;
  if (body.engine !== "local" && body.engine !== "teacher") {
    return c.json({ error: "engine debe ser local o teacher." }, 400);
  }
  if (!body.image || !body.width || !body.height || !body.reading?.bottle_box) {
    return c.json({ error: "Faltan image, width, height o reading." }, 400);
  }
  try {
    return c.json(recordInspection(body));
  } catch (e) {
    return c.json({ error: message(e) }, 400);
  }
});

/** Detalle de una botella: estado, verificación del maestro, comparación, cajas de los dos modelos y defectos. */
app.get("/api/inspections/:id", (c) => {
  const item = getInspection(c.req.param("id"));
  if (!item) return c.json({ error: "No existe la inspección." }, 404);
  return c.json(item);
});

/** Foto guardada de una inspección (id de image_assets). Las fotos viven en DATA_DIR, que no es público. */
app.get("/api/images/:id", (c) => {
  const img = getImageFile(c.req.param("id"));
  if (!img) return c.json({ error: "No existe la imagen." }, 404);
  return c.body(fs.readFileSync(img.file), 200, {
    "content-type": img.mime,
    "cache-control": "private, max-age=86400, immutable",
  });
});

const port = Number(process.env.PORT ?? 8000);

try {
  await ensureLocalModel();
} catch (e) {
  console.error("No se pudo descargar el modelo entrenado:", message(e));
}
getDb();
const info = await localModelInfo();
console.log(
  `Modelo local: ${info.available ? info.version : `no disponible${info.error ? ` (${info.error})` : ""}`}. ` +
    `Maestro: ${noTeacher() ? "sin ANTHROPIC_API_KEY" : TEACHER_MODEL}.`,
);

serve({ fetch: app.fetch, port, hostname: "0.0.0.0" }, (a) => console.log(`API escuchando en http://localhost:${a.port}`));
