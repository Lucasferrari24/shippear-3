import { NextResponse } from "next/server";
import { feedbackSummary, recordFeedback, type FeedbackInput, type LocalPrediction } from "@/lib/feedback";
import { hasLocalModel, predictLocal } from "@/lib/localModel";
import { askTeacher, TeacherError } from "@/lib/teacher";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Corre el modelo local en el servidor; si falla, la foto se guarda igual, solo con el maestro. */
async function localPrediction(image: string): Promise<LocalPrediction | undefined> {
  if (!hasLocalModel()) return undefined;
  try {
    const p = await predictLocal(image);
    return { reading: p.reading, detections: p.detections, latencyMs: p.latencyMs, modelVersion: { name: p.modelVersion } };
  } catch (e) {
    console.error("Modelo local:", (e as Error).message);
    return undefined;
  }
}

/**
 * Verifica una foto con el maestro y la compara con el modelo local: la predicción que mande el cliente
 * o, si no manda ninguna, la que corre acá con el ONNX entrenado. Todo se guarda en la base.
 */
export async function POST(req: Request) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: "Falta ANTHROPIC_API_KEY en el servidor." }, { status: 500 });
  }
  const body: FeedbackInput = await req.json();
  try {
    const [teacher, local] = await Promise.all([
      askTeacher(body.image, body.width, body.height),
      body.local ? Promise.resolve(body.local) : localPrediction(body.image),
    ]);
    return NextResponse.json(recordFeedback({ ...body, local }, teacher));
  } catch (e) {
    const status = e instanceof TeacherError ? 502 : 500;
    return NextResponse.json({ error: (e as Error).message }, { status });
  }
}

/** Estado de la cola del dataset y coincidencia del modelo local con el maestro. */
export async function GET() {
  try {
    return NextResponse.json(feedbackSummary());
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
