import { NextResponse } from "next/server";
import { filtersFrom, getStats } from "@/lib/queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Tablero de pérdidas: botellas por categoría y código, pérdida, evolución diaria, matriz tapa × nivel y etapas. */
export async function GET(req: Request) {
  try {
    return NextResponse.json(getStats(filtersFrom(new URL(req.url))));
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
