// Motor de reglas determinístico. La IA mide; esto decide. Se usa en el servidor y en el cliente
// para que la recalibración de bandas recalcule todo el lote sin volver a llamar a la IA.

import type {
  BottleCategory,
  BottleModel,
  BottleState,
  DefectCode,
  LevelBand,
  LevelStatus,
  VisionReading,
  Verdict,
} from "./types";

export const DEFAULT_BAND: LevelBand = { min: 0.22, max: 0.34 };

export const DEFAULT_BANDS: Record<Exclude<BottleModel, "desconocido">, LevelBand> = {
  clasico: { ...DEFAULT_BAND },
  stevia: { ...DEFAULT_BAND },
};

export type Bands = typeof DEFAULT_BANDS;

/** Botellas desconocidas usan la banda de Clásico. */
export function bandKey(model: BottleModel): keyof Bands {
  return model === "stevia" ? "stevia" : "clasico";
}

export function judge(reading: VisionReading, band: LevelBand): Verdict {
  const defects: DefectCode[] = [];
  const b = reading.bottle_box;
  const h = b.y1 - b.y0;
  const detected = !(h <= 0 || reading.confidence < 0.15);

  if (!detected) defects.push("BOTELLA_NO_DETECTADA");
  if (reading.cap_state === "mal_colocada") defects.push("TAPA_MAL_COLOCADA");
  if (reading.cap_state === "abierta") defects.push("TAPA_ABIERTA");
  if (reading.cap_state === "ausente") defects.push("SIN_TAPA");

  let levelFraction: number | null = null;
  let level: LevelStatus = "no_medido";
  if (reading.liquid_surface_y == null || h <= 0) {
    defects.push("NIVEL_NO_DETECTADO");
  } else {
    levelFraction = (reading.liquid_surface_y - b.y0) / h;
    if (levelFraction > band.max) {
      level = "bajo";
      defects.push("NIVEL_BAJO");
    } else if (levelFraction < band.min) {
      level = "alto";
      defects.push("NIVEL_ALTO");
    } else {
      level = "ok";
    }
  }

  const capError = reading.cap_state !== "ok";
  const levelError = level === "bajo" || level === "alto";

  let category: BottleCategory;
  let code: string;
  if (!detected) {
    category = "INDETERMINADO";
    code = "INDET:botella_no_detectada";
  } else if (capError && levelError) {
    category = "ERROR_COMBINADO";
    code = `COMB:${reading.cap_state}+${level}`;
  } else if (capError) {
    category = "ERROR_TAPA";
    code = `TAPA:${reading.cap_state}`;
  } else if (levelError) {
    category = "ERROR_NIVEL";
    code = `NIVEL:${level}`;
  } else if (level === "no_medido") {
    category = "INDETERMINADO";
    code = "INDET:nivel_no_medido";
  } else {
    category = "OK";
    code = "OK";
  }

  const bottle: BottleState = {
    model: reading.bottle_model,
    detected,
    cap: reading.cap_state,
    level,
    levelFraction,
    category,
    code,
  };

  return {
    // INDETERMINADO nunca pasa como OK.
    status: category === "OK" ? "OK" : "NOK",
    defects,
    levelFraction,
    band,
    bandPx: { min: b.y0 + band.min * h, max: b.y0 + band.max * h },
    bottle,
  };
}

export function calibratedBand(fraction: number): LevelBand {
  const r = (n: number) => Math.round(n * 100) / 100;
  return { min: r(Math.max(0, fraction - 0.04)), max: r(Math.min(1, fraction + 0.04)) };
}
