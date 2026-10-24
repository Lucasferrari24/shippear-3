import { NextResponse } from "next/server";
import { getInspection } from "@/lib/queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Detalle de una botella: estado, verificación del maestro, comparación, cajas de los dos modelos y defectos. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const item = getInspection(id);
  if (!item) return NextResponse.json({ error: "No existe la inspección." }, { status: 404 });
  return NextResponse.json(item);
}
