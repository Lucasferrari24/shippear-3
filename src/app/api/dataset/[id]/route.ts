import { NextResponse } from "next/server";
import { reviewSample } from "@/lib/feedback";

export const runtime = "nodejs";

type Body = { status: "approved" | "rejected"; labelClass?: string; reviewer?: string };

/** Revisión humana de una muestra del dataset. */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { status, labelClass, reviewer }: Body = await req.json();
  if (status !== "approved" && status !== "rejected") {
    return NextResponse.json({ error: "status debe ser approved o rejected." }, { status: 400 });
  }
  try {
    reviewSample(id, status, labelClass, reviewer);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
