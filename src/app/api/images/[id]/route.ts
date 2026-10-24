import fs from "node:fs";
import { getImageFile } from "@/lib/queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Foto guardada de una inspección (id de image_assets). Las fotos viven en data/, que no es público. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const img = getImageFile(id);
  if (!img) return Response.json({ error: "No existe la imagen." }, { status: 404 });
  return new Response(fs.readFileSync(img.file), {
    headers: { "content-type": img.mime, "cache-control": "private, max-age=86400, immutable" },
  });
}
