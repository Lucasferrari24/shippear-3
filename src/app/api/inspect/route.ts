import { NextResponse } from "next/server";
import { DEFAULT_BANDS, judge, type InspectionResult, type LevelBand } from "@/lib/inspection";
import { askTeacher, TeacherError } from "@/lib/teacher";

export const runtime = "nodejs";
export const maxDuration = 60;

type Body = { image: string; width: number; height: number; band?: LevelBand };

export async function POST(req: Request) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: "Falta ANTHROPIC_API_KEY en el servidor." }, { status: 500 });
  }

  const { image, width, height, band }: Body = await req.json();
  let teacher;
  try {
    teacher = await askTeacher(image, width, height);
  } catch (e) {
    const status = e instanceof TeacherError ? 502 : 500;
    return NextResponse.json({ error: (e as Error).message }, { status });
  }

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

  return NextResponse.json(result);
}
