import { NextResponse } from "next/server";
import { recordInspection, type InspectionInput } from "@/lib/feedback";
import { filtersFrom, listInspections } from "@/lib/queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Historial de botellas guardadas, más nuevas primero. Mismos filtros que /api/stats, más limit y offset. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  try {
    const limit = Number(url.searchParams.get("limit") ?? 50);
    const offset = Number(url.searchParams.get("offset") ?? 0);
    return NextResponse.json(listInspections(filtersFrom(url), limit, offset));
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}

/**
 * Guarda una botella con la decisión de un solo modelo, sin llamar al maestro (sin costo de API).
 * La usa la cámara para que el tablero cuente cada botella que pasa.
 */
export async function POST(req: Request) {
  const body = (await req.json()) as InspectionInput;
  if (body.engine !== "local" && body.engine !== "teacher") {
    return NextResponse.json({ error: "engine debe ser local o teacher." }, { status: 400 });
  }
  if (!body.image || !body.width || !body.height || !body.reading?.bottle_box) {
    return NextResponse.json({ error: "Faltan image, width, height o reading." }, { status: 400 });
  }
  try {
    return NextResponse.json(recordInspection(body));
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
