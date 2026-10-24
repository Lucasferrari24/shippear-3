import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";
import {
  DEFAULT_BANDS,
  judge,
  type InspectionResult,
  type LevelBand,
  type VisionReading,
} from "@/lib/inspection";

export const runtime = "nodejs";
export const maxDuration = 60;

const MODEL = process.env.CLAUDE_MODEL ?? "claude-sonnet-5-5";

const box = {
  type: "object",
  properties: {
    x0: { type: "number" },
    y0: { type: "number" },
    x1: { type: "number" },
    y1: { type: "number" },
  },
  required: ["x0", "y0", "x1", "y1"],
};

const REPORT_TOOL: Anthropic.Tool = {
  name: "report_inspection",
  description: "Reporta la medición de una botella para control de calidad.",
  input_schema: {
    type: "object",
    properties: {
      bottle_model: { type: "string", enum: ["clasico", "stevia", "desconocido"] },
      bottle_box: { ...box, description: "Caja del envase completo incluyendo tapa/pico, en píxeles." },
      cap_state: { type: "string", enum: ["ok", "mal_colocada", "abierta", "ausente"] },
      cap_box: { anyOf: [box, { type: "null" }], description: "Caja de la tapa, o null si no hay tapa." },
      spout_box: { anyOf: [box, { type: "null" }], description: "Caja del pico/cuello de la botella." },
      cap_gap_px: {
        type: ["number", "null"],
        description: "Separación visible entre tapa y pico (o capuchón levantado) en píxeles; 0 si cierra bien.",
      },
      liquid_surface_y: {
        type: ["number", "null"],
        description: "Coordenada Y (píxeles) del menisco / superficie del líquido. null si no se distingue.",
      },
      confidence: { type: "number", description: "0 a 1." },
      evidence: { type: "string", description: "Una o dos frases en español con lo observado." },
    },
    required: [
      "bottle_model", "bottle_box", "cap_state", "cap_box", "spout_box",
      "cap_gap_px", "liquid_surface_y", "confidence", "evidence",
    ],
  },
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

type Body = { image: string; width: number; height: number; band?: LevelBand };

export async function POST(req: Request) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: "Falta ANTHROPIC_API_KEY en el servidor." }, { status: 500 });
  }

  const { image, width, height, band }: Body = await req.json();
  const match = /^data:(image\/(?:jpeg|png|webp));base64,(.+)$/.exec(image ?? "");
  if (!match) {
    return NextResponse.json({ error: "La imagen debe ser un data URL jpeg/png/webp." }, { status: 400 });
  }

  const client = new Anthropic();
  const started = Date.now();

  const msg = await client.messages.create({
    model: MODEL,
    max_tokens: 1024,
    system: SYSTEM,
    tools: [REPORT_TOOL],
    tool_choice: { type: "tool", name: "report_inspection" },
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
            text: `La imagen mide ${width}x${height} píxeles. Inspeccioná la botella y reportá con report_inspection.`,
          },
        ],
      },
    ],
  });

  const call = msg.content.find((c) => c.type === "tool_use");
  if (!call || call.type !== "tool_use") {
    return NextResponse.json({ error: "El modelo no devolvió una medición." }, { status: 502 });
  }

  const reading = call.input as VisionReading;
  const fallback = DEFAULT_BANDS[reading.bottle_model === "stevia" ? "stevia" : "clasico"];

  const result: InspectionResult = {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    width,
    height,
    reading,
    verdict: judge(reading, band ?? fallback),
    model: MODEL,
    latencyMs: Date.now() - started,
  };

  return NextResponse.json(result);
}
