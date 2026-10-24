// Tipos y motor de reglas compartidos entre la API y la UI.
// La IA mide (geometría + estado de tapa); las reglas deciden el veredicto.

export type Box = { x0: number; y0: number; x1: number; y1: number };

export type CapState = "ok" | "mal_colocada" | "abierta" | "ausente";

export type BottleModel = "clasico" | "stevia" | "desconocido";

/** Lo que devuelve el modelo de visión (coordenadas en píxeles de la imagen enviada). */
export type VisionReading = {
  bottle_model: BottleModel;
  bottle_box: Box;
  cap_state: CapState;
  cap_box: Box | null;
  spout_box: Box | null;
  cap_gap_px: number | null;
  liquid_surface_y: number | null;
  confidence: number;
  evidence: string;
};

/** Banda de llenado como fracción de la altura de la botella, medida desde arriba. */
export type LevelBand = { min: number; max: number };

export type DefectCode =
  | "TAPA_MAL_COLOCADA"
  | "TAPA_ABIERTA"
  | "SIN_TAPA"
  | "NIVEL_BAJO"
  | "NIVEL_ALTO"
  | "NIVEL_NO_DETECTADO"
  | "BOTELLA_NO_DETECTADA";

export type Verdict = {
  status: "OK" | "NOK";
  defects: DefectCode[];
  levelFraction: number | null;
  band: LevelBand;
  bandPx: { min: number; max: number };
};

export type InspectionResult = {
  id: string;
  createdAt: string;
  width: number;
  height: number;
  reading: VisionReading;
  verdict: Verdict;
  model: string;
  latencyMs: number;
};

// Defaults; se recalibran desde la UI con una foto OK de referencia.
export const DEFAULT_BANDS: Record<Exclude<BottleModel, "desconocido">, LevelBand> = {
  clasico: { min: 0.22, max: 0.34 },
  stevia: { min: 0.22, max: 0.34 },
};

export const DEFECT_LABELS: Record<DefectCode, string> = {
  TAPA_MAL_COLOCADA: "Tapa mal colocada / apoyada",
  TAPA_ABIERTA: "Tapa abierta (capuchón levantado)",
  SIN_TAPA: "Ausencia de tapa",
  NIVEL_BAJO: "Nivel de líquido bajo",
  NIVEL_ALTO: "Nivel de líquido alto",
  NIVEL_NO_DETECTADO: "No se pudo medir el nivel",
  BOTELLA_NO_DETECTADA: "No se detectó una botella",
};

export function judge(reading: VisionReading, band: LevelBand): Verdict {
  const defects: DefectCode[] = [];
  const b = reading.bottle_box;
  const h = b.y1 - b.y0;

  if (h <= 0 || reading.confidence < 0.15) {
    defects.push("BOTELLA_NO_DETECTADA");
  }

  if (reading.cap_state === "mal_colocada") defects.push("TAPA_MAL_COLOCADA");
  if (reading.cap_state === "abierta") defects.push("TAPA_ABIERTA");
  if (reading.cap_state === "ausente") defects.push("SIN_TAPA");

  let levelFraction: number | null = null;
  if (reading.liquid_surface_y == null || h <= 0) {
    defects.push("NIVEL_NO_DETECTADO");
  } else {
    levelFraction = (reading.liquid_surface_y - b.y0) / h;
    // Fracción desde arriba: menor = más lleno.
    if (levelFraction > band.max) defects.push("NIVEL_BAJO");
    if (levelFraction < band.min) defects.push("NIVEL_ALTO");
  }

  return {
    status: defects.length === 0 ? "OK" : "NOK",
    defects,
    levelFraction,
    band,
    bandPx: { min: b.y0 + band.min * h, max: b.y0 + band.max * h },
  };
}
