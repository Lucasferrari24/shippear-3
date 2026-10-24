import type { BottleCategory, BottleModel, CapState, DatasetClass, DefectCode, LevelStatus, Sample } from "./types";

export const CATEGORY_LABELS: Record<BottleCategory, string> = {
  OK: "OK",
  ERROR_TAPA: "Error de tapa",
  ERROR_NIVEL: "Error de nivel",
  ERROR_COMBINADO: "Error combinado (tapa + nivel)",
  INDETERMINADO: "Indeterminado (revisar)",
};

export const CATEGORY_SHORT: Record<BottleCategory, string> = {
  OK: "OK",
  ERROR_TAPA: "Tapa",
  ERROR_NIVEL: "Nivel",
  ERROR_COMBINADO: "Combinado",
  INDETERMINADO: "Revisar",
};

export const CATEGORY_COLOR: Record<BottleCategory, string> = {
  OK: "var(--ok)",
  ERROR_TAPA: "var(--cap)",
  ERROR_NIVEL: "var(--level)",
  ERROR_COMBINADO: "var(--nok)",
  INDETERMINADO: "var(--review)",
};

export const CAP_LABELS: Record<CapState, string> = {
  ok: "correcta",
  mal_colocada: "desnivelada / mal colocada",
  abierta: "destapada (capuchón abierto)",
  ausente: "ausente",
};

export const CAP_COLORS: Record<CapState, string> = {
  ok: "#30D158",
  mal_colocada: "#FF9F0A",
  abierta: "#FF6B2C",
  ausente: "#FF453A",
};

export const LEVEL_LABELS: Record<LevelStatus, string> = {
  ok: "dentro de banda",
  bajo: "bajo",
  alto: "alto",
  no_medido: "no medido",
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

export const DEFECT_DOMAIN: Record<DefectCode, "cap" | "level" | "process"> = {
  TAPA_MAL_COLOCADA: "cap",
  TAPA_ABIERTA: "cap",
  SIN_TAPA: "cap",
  NIVEL_BAJO: "level",
  NIVEL_ALTO: "level",
  NIVEL_NO_DETECTADO: "level",
  BOTELLA_NO_DETECTADA: "process",
};

export const SAMPLE_LABELS: Record<Sample["status"], string> = {
  approved: "aprobada",
  pending: "pendiente de revisión",
  rejected: "rechazada",
  exported: "exportada",
};

export const DATASET_CLASSES: DatasetClass[] = ["ok", "mal_colocada", "abierta", "sin_tapa", "nivel_bajo", "nivel_alto"];

export const MODEL_LABELS: Record<BottleModel, string> = {
  clasico: "Clásico",
  stevia: "Stevia",
  desconocido: "Desconocido",
};

export const MODEL_DOT: Record<BottleModel, string> = {
  clasico: "#FF453A",
  stevia: "#30D158",
  desconocido: "#8E8E93",
};

export function pct(fraction: number | null | undefined, digits = 1) {
  if (fraction == null) return "—";
  return `${(fraction * 100).toLocaleString("es-AR", { minimumFractionDigits: digits, maximumFractionDigits: digits })}%`;
}
