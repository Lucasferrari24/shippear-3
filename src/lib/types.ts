// Contrato de datos compartido entre la API y la UI. No cambiar nombres ni valores.

export type Box = { x0: number; y0: number; x1: number; y1: number };
export type CapState = "ok" | "mal_colocada" | "abierta" | "ausente";
export type BottleModel = "clasico" | "stevia" | "desconocido";

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

/** Fracción de la altura desde ARRIBA: menor = más lleno. */
export type LevelBand = { min: number; max: number };

export type DefectCode =
  | "TAPA_MAL_COLOCADA"
  | "TAPA_ABIERTA"
  | "SIN_TAPA"
  | "NIVEL_BAJO"
  | "NIVEL_ALTO"
  | "NIVEL_NO_DETECTADO"
  | "BOTELLA_NO_DETECTADA";

export type LevelStatus = "ok" | "bajo" | "alto" | "no_medido";
export type BottleCategory = "OK" | "ERROR_TAPA" | "ERROR_NIVEL" | "ERROR_COMBINADO" | "INDETERMINADO";

export type BottleState = {
  model: BottleModel;
  detected: boolean;
  cap: CapState;
  level: LevelStatus;
  levelFraction: number | null;
  category: BottleCategory;
  code: string;
};

export type Verdict = {
  status: "OK" | "NOK";
  defects: DefectCode[];
  levelFraction: number | null;
  band: LevelBand;
  bandPx: { min: number; max: number };
  bottle: BottleState;
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

export type Comparison = {
  outcome: "agree" | "disagree" | "teacher_only";
  verdictMatch: boolean | null;
  capStateMatch: boolean | null;
  defectsMatch: boolean | null;
  categoryMatch: boolean | null;
  bottleIou: number | null;
  capIou: number | null;
  levelDelta: number | null;
};

export type Sample = {
  id: string;
  status: "pending" | "approved" | "rejected" | "exported";
  labelClass: string | null;
  reason: string | null;
};

export type Item = {
  key: string;
  name: string;
  /** URL para mostrar la foto (blob local o la del backend). */
  src: string;
  /** La foto reescalada como data URL jpeg: es lo que se manda a la API y en lo que vienen las coordenadas. */
  data?: string;
  width: number;
  height: number;
  status: "pending" | "running" | "done" | "error";
  result?: InspectionResult;
  feedback?: { comparison: Comparison; sample: Sample };
  error?: string;
};

export type DatasetClass = "ok" | "mal_colocada" | "abierta" | "sin_tapa" | "nivel_bajo" | "nivel_alto";

/** Muestra de la cola de revisión con los datos que necesita la UI. */
export type ReviewSample = Sample & {
  priority: 1 | 2 | 3;
  createdAt: string;
  src: string;
  width: number;
  height: number;
  reading: VisionReading;
  proposedClass: DatasetClass | null;
  humanLabel: boolean;
  reviewer: string | null;
};

export type DatasetSummary = {
  counts: Record<Sample["status"], number>;
  coverage: Record<"clasico" | "stevia", Record<DatasetClass, number>>;
  comparisons: Record<Comparison["outcome"], number>;
};

export type LineDailyRow = { day: string; total: number; ok: number; nok: number; other: number; avg_ms: number };
export type LineDefectCode =
  | "CAP_MISALIGNED"
  | "CAP_OPEN"
  | "CAP_MISSING"
  | "LEVEL_LOW"
  | "LEVEL_HIGH"
  | "LEVEL_NOT_FOUND"
  | "BOTTLE_NOT_FOUND";
export type LineDefectRow = { day: string } & Record<LineDefectCode, number>;
export type LineCategoryRow = { day: string } & Record<BottleCategory, number>;
export type StateMatrixCell = { cap: CapState; level: LevelStatus; count: number; code: string; category: BottleCategory };

export type ModelAgreementRow = {
  version: string;
  compared: number;
  verdict_match: number;
  cap_match: number;
  bottle_iou: number;
  cap_iou: number;
  level_delta: number;
};
