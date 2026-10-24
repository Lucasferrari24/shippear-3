import { NextResponse } from "next/server";
import { feedbackSummary, recordFeedback, type FeedbackInput } from "@/lib/feedback";
import { askTeacher, TeacherError } from "@/lib/teacher";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Verifica una foto con el maestro, la compara con la predicción local (si viene) y la guarda en la base. */
export async function POST(req: Request) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: "Falta ANTHROPIC_API_KEY en el servidor." }, { status: 500 });
  }
  const body: FeedbackInput = await req.json();
  try {
    const teacher = await askTeacher(body.image, body.width, body.height);
    return NextResponse.json(recordFeedback(body, teacher));
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
