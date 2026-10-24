// Modelo maestro: Claude mide la botella y devuelve una VisionReading con salida estructurada.
// Lo usan /api/inspect (inspección con Claude) y /api/feedback (verificación del modelo local).

import Anthropic from "@anthropic-ai/sdk";
import type { VisionReading } from "@/lib/inspection";

export const TEACHER_MODEL = process.env.CLAUDE_MODEL ?? "claude-opus-5-5";

const box = {
  type: "object",
  properties: {
    x0: { type: "number" },
    y0: { type: "number" },
    x1: { type: "number" },
    y1: { type: "number" },
  },
  required: ["x0", "y0", "x1", "y1"],
  additionalProperties: false,
};

const READING_SCHEMA = {
  type: "object",
  properties: {
    bottle_model: { type: "string", enum: ["clasico", "stevia", "desconocido"] },
    bottle_box: { ...box, description: "Caja del envase completo incluyendo tapa/pico, en píxeles." },
    cap_state: { type: "string", enum: ["ok", "mal_colocada", "abierta", "ausente"] },
    cap_box: { anyOf: [box, { type: "null" }], description: "Caja de la tapa, o null si no hay tapa." },
    spout_box: { anyOf: [box, { type: "null" }], description: "Caja del pico/cuello de la botella." },
    cap_gap_px: {
      anyOf: [{ type: "number" }, { type: "null" }],
      description: "Separación visible entre tapa y pico (o capuchón levantado) en píxeles; 0 si cierra bien.",
    },
    liquid_surface_y: {
      anyOf: [{ type: "number" }, { type: "null" }],
      description: "Coordenada Y (píxeles) del menisco / superficie del líquido. null si no se distingue.",
    },
    confidence: { type: "number", description: "0 a 1." },
    evidence: { type: "string", description: "Una o dos frases en español con lo observado." },
  },
  required: [
    "bottle_model", "bottle_box", "cap_state", "cap_box", "spout_box",
    "cap_gap_px", "liquid_surface_y", "confidence", "evidence",
  ],
  additionalProperties: false,
};

const SYSTEM = `Sos el sistema de visión al final de una línea de envasado de edulcorante líquido Virginia.
Cada foto muestra una botella transparente con líquido incoloro. Hay dos modelos: Clásico (tapa roja) y Stevia (tapa verde).
Tu trabajo es MEDIR con precisión, no opinar. Devolvé coordenadas en píxeles sobre la imagen recibida (origen arriba a la izquierda).

Estado de la tapa:
- "ok": tapa a presión asentada, sin separación visible con el pico, capuchón cerrado.
- "mal_colocada": tapa apoyada o inclinada; se ve una separación entre la tapa y el pico.
- "abierta": el capuchón (flip-top) está levantado; se ve una separación sobre la tapa.
- "ausente": el pico queda descubierto, no hay tapa.

Nivel: el líquido es incoloro; buscá el menisco por el cambio de refracción/brillo y la línea horizontal dentro del envase.
Mirá con atención el borde entre tapa y pico antes de decidir: las separaciones suelen ser de pocos píxeles.`;

export class TeacherError extends Error {}

export type TeacherResult = { reading: VisionReading; model: string; latencyMs: number };

/** Pide al maestro la medición de una imagen (data URL jpeg/png/webp). */
export async function askTeacher(image: string, width: number, height: number): Promise<TeacherResult> {
  const match = /^data:(image\/(?:jpeg|png|webp));base64,(.+)$/.exec(image ?? "");
  if (!match) throw new TeacherError("La imagen debe ser un data URL jpeg/png/webp.");

  const client = new Anthropic();
  const started = Date.now();
  const msg = await client.beta.messages.create({
    model: TEACHER_MODEL,
    max_tokens: 16000,
    system: SYSTEM,
    // Si un clasificador de seguridad rechaza la foto, el servidor reintenta con el modelo de respaldo recomendado.
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: {
      effort: "medium",
      format: { type: "json_schema", schema: READING_SCHEMA },
    },
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: { type: "base64", media_type: match[1] as "image/jpeg", data: match[2] },
          },
          {
            type: "text",
            text: `La imagen mide ${width}x${height} píxeles. Inspeccioná la botella y devolvé la medición.`,
          },
        ],
      },
    ],
  });

  if (msg.stop_reason === "refusal") throw new TeacherError("El modelo maestro rechazó la imagen.");
  if (msg.stop_reason === "max_tokens") throw new TeacherError("La respuesta del maestro quedó cortada.");
  const text = msg.content.find((c) => c.type === "text");
  if (!text || text.type !== "text") throw new TeacherError("El maestro no devolvió una medición.");

  return { reading: JSON.parse(text.text) as VisionReading, model: msg.model, latencyMs: Date.now() - started };
}
