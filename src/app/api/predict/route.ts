import { NextResponse } from "next/server";
import { DEFAULT_BANDS, judge, type InspectionResult, type LevelBand } from "@/lib/inspection";
import { ModelUnavailableError, predictLocal } from "@/lib/localModel";

export const runtime = "nodejs";
export const maxDuration = 30;

type Body = { image: string; width: number; height: number; band?: LevelBand };

/**
 * Inspección con el modelo local (YOLO entrenado, ONNX). Misma respuesta que /api/inspect,
 * más las detecciones crudas del detector.
 */
export async function POST(req: Request) {
  const { image, width, height, band }: Body = await req.json();
  try {
    const local = await predictLocal(image);
    const model = local.reading.bottle_model === "stevia" ? "stevia" : "clasico";
    const result: InspectionResult & { detections: typeof local.detections } = {
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      width,
      height,
      reading: local.reading,
      verdict: judge(local.reading, band ?? local.bands?.[model] ?? DEFAULT_BANDS[model]),
      model: local.modelVersion,
      latencyMs: local.latencyMs,
      detections: local.detections,
    };
    return NextResponse.json(result);
  } catch (e) {
    const status = e instanceof ModelUnavailableError ? 503 : 500;
    return NextResponse.json({ error: (e as Error).message }, { status });
  }
}
