// Modelo de una botella inspeccionada: dos variables de estado (tapa y nivel) y la categoría que sale de ellas.
//
//   tapa con error  OR  nivel con error  →  error
//   tapa con error  AND nivel con error  →  error combinado
//
// La misma lógica está en ml/common.py (bottle_category); si se cambia una, hay que cambiar la otra.

import type { BottleModel, CapState } from "@/lib/inspection";

/** Estado de la tapa. Los errores son: mal_colocada (desnivelada/apoyada), abierta (destapada), ausente. */
export type CapStatus = CapState;

/** Estado del nivel de líquido respecto de la banda mín/máx. */
export type LevelStatus = "ok" | "bajo" | "alto" | "no_medido";

export type BottleCategory =
  | "OK"
  | "ERROR_TAPA"
  | "ERROR_NIVEL"
  | "ERROR_COMBINADO"
  /** No se pudo decidir (botella no detectada, o tapa OK sin nivel medible): va a revisión, nunca pasa como OK. */
  | "INDETERMINADO";

export const CATEGORY_LABELS: Record<BottleCategory, string> = {
  OK: "OK",
  ERROR_TAPA: "Error de tapa",
  ERROR_NIVEL: "Error de nivel",
  ERROR_COMBINADO: "Error combinado (tapa + nivel)",
  INDETERMINADO: "Indeterminado (revisar)",
};

export const CAP_LABELS: Record<CapStatus, string> = {
  ok: "correcta",
  mal_colocada: "desnivelada / mal colocada",
  abierta: "destapada (capuchón abierto)",
  ausente: "ausente",
};

export const LEVEL_LABELS: Record<LevelStatus, string> = {
  ok: "dentro de banda",
  bajo: "bajo",
  alto: "alto",
  no_medido: "no medido",
};

/** Estado plano de una botella, el que viaja en JSON y se guarda en la base. */
export type BottleState = {
  model: BottleModel;
  detected: boolean;
  cap: CapStatus;
  level: LevelStatus;
  levelFraction: number | null;
  category: BottleCategory;
  /** Código de clasificación: OK · TAPA:<estado> · NIVEL:<estado> · COMB:<tapa>+<nivel> · INDET:<motivo>. */
  code: string;
};

export class Bottle {
  constructor(
    readonly model: BottleModel,
    readonly cap: CapStatus,
    readonly level: LevelStatus,
    readonly levelFraction: number | null,
    readonly detected = true,
  ) {}

  get capError(): boolean {
    return this.cap !== "ok";
  }

  get levelError(): boolean {
    return this.level === "bajo" || this.level === "alto";
  }

  get category(): BottleCategory {
    if (!this.detected) return "INDETERMINADO";
    if (this.capError && this.levelError) return "ERROR_COMBINADO";
    if (this.capError) return "ERROR_TAPA";
    if (this.levelError) return "ERROR_NIVEL";
    if (this.level === "no_medido") return "INDETERMINADO";
    return "OK";
  }

  get code(): string {
    switch (this.category) {
      case "OK":
        return "OK";
      case "ERROR_TAPA":
        return `TAPA:${this.cap}`;
      case "ERROR_NIVEL":
        return `NIVEL:${this.level}`;
      case "ERROR_COMBINADO":
        return `COMB:${this.cap}+${this.level}`;
      case "INDETERMINADO":
        return this.detected ? "INDET:nivel_no_medido" : "INDET:botella_no_detectada";
    }
  }

  toState(): BottleState {
    return {
      model: this.model,
      detected: this.detected,
      cap: this.cap,
      level: this.level,
      levelFraction: this.levelFraction,
      category: this.category,
      code: this.code,
    };
  }
}
