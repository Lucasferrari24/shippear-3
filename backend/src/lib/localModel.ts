// Modelo local: el detector YOLO ya entrenado (en Colab, ver ml/colab_train.ipynb) y exportado a ONNX.
// El backend no entrena: carga backend/models/centinela.onnx + centinela.json, o los descarga de
// MODEL_URL y MODEL_META_URL al arrancar si no están en disco.
// Corre en el servidor con onnxruntime-node y devuelve una VisionReading, igual que el maestro,
// para que las mismas reglas (judge) y estados de botella decidan el veredicto.
//
// Preprocesado y armado de la lectura replican ml/ (Ultralytics LetterBox y evaluate.detections_to_reading).

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import * as ort from "onnxruntime-node";
import sharp from "sharp";
import { BACKEND_DIR } from "@/lib/db";
import type { Detection } from "@/lib/feedback";
import type { BottleModel, Box, CapState, LevelBand, VisionReading } from "@/lib/inspection";

const MODEL_DIR = path.resolve(BACKEND_DIR, process.env.LOCAL_MODEL_DIR ?? "models");
const ONNX_PATH = path.join(MODEL_DIR, "centinela.onnx");
const META_PATH = path.join(MODEL_DIR, "centinela.json");

type ModelMeta = {
  classes: string[];
  imgsz: number;
  input: string;
  output_layout: string;
  letterbox_pad_value: number;
  conf: number;
  bands?: Partial<Record<"clasico" | "stevia", LevelBand>>;
  weights?: string;
};

type Loaded = { session: ort.InferenceSession; meta: ModelMeta; version: string; mtimeMs: number };

let loaded: Promise<Loaded> | null = null;
let loadedMtime = 0;

export class ModelUnavailableError extends Error {}

/** Carga (o recarga si cambió el archivo) la sesión ONNX y sus metadatos. */
async function getModel(): Promise<Loaded> {
  if (!fs.existsSync(ONNX_PATH) || !fs.existsSync(META_PATH)) {
    throw new ModelUnavailableError(
      "No hay modelo entrenado: falta backend/models/centinela.onnx (o MODEL_URL en el servidor).",
    );
  }
  const mtimeMs = fs.statSync(ONNX_PATH).mtimeMs;
  if (!loaded || mtimeMs !== loadedMtime) {
    loadedMtime = mtimeMs;
    loaded = (async () => {
      const meta = JSON.parse(fs.readFileSync(META_PATH, "utf8")) as ModelMeta;
      if (meta.output_layout !== "end2end_xyxy_score_class") {
        throw new ModelUnavailableError(
          `El ONNX tiene salida "${meta.output_layout}"; reexportar con ml/export.py (nms=True).`,
        );
      }
      const bytes = fs.readFileSync(ONNX_PATH);
      const hash = crypto.createHash("sha256").update(bytes).digest("hex");
      const session = await ort.InferenceSession.create(bytes, { executionProviders: ["cpu"] });
      return { session, meta, version: `centinela-${hash.slice(0, 12)}`, mtimeMs };
    })();
    loaded.catch(() => {
      loaded = null;
    });
  }
  return loaded;
}

/** Imagen decodificada una sola vez a RGB crudo (sin volver a comprimir). */
type RawImage = { data: Buffer; width: number; height: number };

const fromRaw = (img: RawImage) => sharp(img.data, { raw: { width: img.width, height: img.height, channels: 3 } });

/** Letterbox como Ultralytics: escala manteniendo proporción (lineal, como cv2) y rellena con gris 114 centrado. */
async function letterbox(img: RawImage, size: number, pad: number) {
  const { width, height } = img;
  const r = Math.min(size / width, size / height);
  const nw = Math.round(width * r);
  const nh = Math.round(height * r);
  const dw = (size - nw) / 2;
  const dh = (size - nh) / 2;
  const top = Math.round(dh - 0.1);
  const bottom = Math.round(dh + 0.1);
  const left = Math.round(dw - 0.1);
  const right = Math.round(dw + 0.1);
  const resized = nw === width && nh === height ? fromRaw(img) : fromRaw(img).resize(nw, nh, { fit: "fill", kernel: "linear" });
  const { data } = await resized
    .extend({ top, bottom, left, right, background: { r: pad, g: pad, b: pad } })
    .raw()
    .toBuffer({ resolveWithObject: true });

  // HWC uint8 → CHW float32 en [0, 1]
  const plane = size * size;
  const chw = new Float32Array(3 * plane);
  for (let i = 0; i < plane; i++) {
    chw[i] = data[i * 3] / 255;
    chw[plane + i] = data[i * 3 + 1] / 255;
    chw[2 * plane + i] = data[i * 3 + 2] / 255;
  }
  return { tensor: new ort.Tensor("float32", chw, [1, 3, size, size]), r, left, top };
}

/** Clásico tiene tapa roja y Stevia verde: se decide por el tono de los píxeles con color de la caja de la tapa. */
async function bottleModelFromCap(img: RawImage, box: Box): Promise<BottleModel> {
  const x0 = Math.max(0, Math.floor(box.x0));
  const y0 = Math.max(0, Math.floor(box.y0));
  const w = Math.min(img.width, Math.ceil(box.x1)) - x0;
  const h = Math.min(img.height, Math.ceil(box.y1)) - y0;
  if (w < 2 || h < 2) return "desconocido";
  const { data } = await fromRaw(img).extract({ left: x0, top: y0, width: w, height: h }).raw()
    .toBuffer({ resolveWithObject: true });
  let colored = 0;
  let red = 0;
  let green = 0;
  for (let i = 0; i < data.length; i += 3) {
    const r = data[i] / 255;
    const g = data[i + 1] / 255;
    const b = data[i + 2] / 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const s = max === 0 ? 0 : (max - min) / max;
    if (s <= 60 / 255 || max <= 40 / 255) continue;
    const d = max - min;
    let hue = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    hue = (hue * 60 + 360) % 360;
    colored++;
    if (hue < 25 || hue > 335) red++;
    else if (hue > 70 && hue < 170) green++;
  }
  if (colored < 20) return "desconocido";
  const redShare = red / colored;
  const greenShare = green / colored;
  if (Math.max(redShare, greenShare) < 0.3) return "desconocido";
  return redShare > greenShare ? "clasico" : "stevia";
}

const CLASS_CAP_STATE: Record<string, CapState> = {
  tapa_ok: "ok",
  tapa_mal_colocada: "mal_colocada",
  tapa_abierta: "abierta",
  pico_sin_tapa: "ausente",
};

/** Arma la lectura a partir de las detecciones (misma lógica que ml/evaluate.py). */
async function detectionsToReading(dets: Detection[], img: RawImage): Promise<VisionReading> {
  const bottles = dets.filter((d) => d.class_name === "botella").sort((a, b) => b.confidence - a.confidence);
  if (!bottles.length) {
    return {
      bottle_model: "desconocido", bottle_box: { x0: 0, y0: 0, x1: 0, y1: 0 }, cap_state: "ausente", cap_box: null,
      spout_box: null, cap_gap_px: null, liquid_surface_y: null, confidence: 0, evidence: "no se detectó la botella",
    };
  }
  const bottle = bottles[0];
  const bb = bottle.box;
  const bh = bb.y1 - bb.y0;
  const inside = (b: Box, topMargin = 0.15) => {
    const cx = (b.x0 + b.x1) / 2;
    const cy = (b.y0 + b.y1) / 2;
    return bb.x0 <= cx && cx <= bb.x1 && bb.y0 - topMargin * bh <= cy && cy <= bb.y1;
  };
  const caps = dets.filter((d) => d.class_name in CLASS_CAP_STATE && inside(d.box)).sort((a, b) => b.confidence - a.confidence);
  const menis = dets.filter((d) => d.class_name === "menisco" && inside(d.box, 0)).sort((a, b) => b.confidence - a.confidence);

  // Sin tapa ni pico detectados: se trata como ausente para no dejar pasar una botella dudosa.
  const cap = caps[0];
  const capState = cap ? CLASS_CAP_STATE[cap.class_name] : "ausente";
  return {
    bottle_model: cap && capState !== "ausente" ? await bottleModelFromCap(img, cap.box) : "desconocido",
    bottle_box: bb,
    cap_state: capState,
    cap_box: cap && capState !== "ausente" ? cap.box : null,
    spout_box: cap && capState === "ausente" ? cap.box : null,
    cap_gap_px: null,
    liquid_surface_y: menis.length ? (menis[0].box.y0 + menis[0].box.y1) / 2 : null,
    confidence: bottle.confidence,
    evidence: cap ? `${cap.class_name} (${cap.confidence.toFixed(2)})` : "no se detectó tapa ni pico",
  };
}

export type LocalResult = {
  reading: VisionReading;
  detections: Detection[];
  modelVersion: string;
  bands: ModelMeta["bands"];
  latencyMs: number;
};

/** Corre el detector sobre una imagen (data URL jpeg/png/webp). Las cajas vuelven en píxeles de esa imagen. */
export async function predictLocal(image: string): Promise<LocalResult> {
  const match = /^data:image\/(?:jpeg|png|webp);base64,(.+)$/.exec(image ?? "");
  if (!match) throw new Error("La imagen debe ser un data URL jpeg/png/webp.");
  const started = Date.now();
  const { session, meta, version } = await getModel();

  const decoded = await sharp(Buffer.from(match[1], "base64")).rotate().removeAlpha().raw()
    .toBuffer({ resolveWithObject: true });
  const img: RawImage = { data: decoded.data, width: decoded.info.width, height: decoded.info.height };
  const { width, height } = img;
  const { tensor, r, left, top } = await letterbox(img, meta.imgsz, meta.letterbox_pad_value);

  const out = await session.run({ [meta.input]: tensor });
  const t = out[session.outputNames[0]];
  const rows = t.dims[1];
  const vals = t.data as Float32Array;
  const detections: Detection[] = [];
  for (let i = 0; i < rows; i++) {
    const [x1, y1, x2, y2, score, cls] = vals.subarray(i * 6, i * 6 + 6);
    if (score < meta.conf) continue;
    const name = meta.classes[Math.round(cls)];
    if (!name) continue;
    const clampX = (v: number) => Math.min(width, Math.max(0, (v - left) / r));
    const clampY = (v: number) => Math.min(height, Math.max(0, (v - top) / r));
    detections.push({
      class_name: name,
      confidence: score,
      box: { x0: clampX(x1), y0: clampY(y1), x1: clampX(x2), y1: clampY(y2) },
    });
  }

  const reading = await detectionsToReading(detections, img);
  return { reading, detections, modelVersion: version, bands: meta.bands, latencyMs: Date.now() - started };
}

/** true si hay un modelo exportado listo para usar. */
export function hasLocalModel(): boolean {
  return fs.existsSync(ONNX_PATH) && fs.existsSync(META_PATH);
}

/**
 * Descarga el modelo entrenado si no está en disco y hay MODEL_URL (y MODEL_META_URL) configuradas.
 * Se llama una vez al arrancar el servidor; si falla, la API sigue andando solo con el maestro.
 */
export async function ensureLocalModel(): Promise<void> {
  const onnxUrl = process.env.MODEL_URL;
  const metaUrl = process.env.MODEL_META_URL;
  if (hasLocalModel() && !process.env.MODEL_FORCE_DOWNLOAD) return;
  if (!onnxUrl || !metaUrl) return;
  fs.mkdirSync(MODEL_DIR, { recursive: true });
  for (const [url, dst] of [[metaUrl, META_PATH], [onnxUrl, ONNX_PATH]] as const) {
    const res = await fetch(url, { redirect: "follow" });
    if (!res.ok) throw new Error(`No se pudo descargar ${url}: HTTP ${res.status}`);
    // Se escribe a un temporal y se renombra, para no dejar un ONNX a medias si se corta.
    const tmp = `${dst}.part`;
    fs.writeFileSync(tmp, Buffer.from(await res.arrayBuffer()));
    fs.renameSync(tmp, dst);
  }
}

/** Datos del modelo cargado, para /health y la pantalla de salud del modelo. */
export async function localModelInfo(): Promise<{
  available: boolean;
  version: string | null;
  sha: string | null;
  bands?: ModelMeta["bands"];
  error?: string;
}> {
  if (!hasLocalModel()) return { available: false, version: null, sha: null };
  try {
    const { version, meta } = await getModel();
    return { available: true, version, sha: version.replace(/^centinela-/, ""), bands: meta.bands };
  } catch (e) {
    return { available: false, version: null, sha: null, error: (e as Error).message };
  }
}
