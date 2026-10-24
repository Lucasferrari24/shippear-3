// Convierte la secuencia de cuadros de la cámara en botellas contadas una sola vez.
//
// Supone una botella por vez frente a la cámara (como al final de la línea):
//   - mientras hay botella, acumula el código de cada cuadro;
//   - cuando deja de verse durante `gapFrames` cuadros, la cierra con el código más votado;
//   - si se vio menos de `minFrames` cuadros, la descarta como ruido.

import type { Detection } from "@/lib/api";
import type { BottleState, InspectionResult } from "@/lib/types";

/** Un cuadro analizado: la imagen enviada y lo que devolvió el modelo. */
export type Frame = {
  image: string;
  width: number;
  height: number;
  confidence: number;
  result?: InspectionResult & { detections?: Detection[] };
};

export type TrackedBottle = {
  id: number;
  state: BottleState;
  /** Cuadros en los que se vio la botella y votos por código. */
  frames: number;
  votes: Record<string, number>;
  /** Cuadro con mayor confianza, para guardar o verificar con el maestro. */
  bestFrame: Frame | null;
  startedAt: number;
  endedAt: number;
};

export type TrackerOptions = { minFrames: number; gapFrames: number };

export class BottleTracker {
  private seq = 0;
  private current: Omit<TrackedBottle, "state" | "endedAt"> & { states: Record<string, BottleState> } | null = null;
  private missing = 0;

  constructor(private opts: TrackerOptions = { minFrames: 3, gapFrames: 4 }) {}

  /** Botella que se está viendo ahora (sin cerrar), con su código provisorio. */
  get live(): { frames: number; code: string } | null {
    if (!this.current) return null;
    return { frames: this.current.frames, code: topCode(this.current.votes) };
  }

  /**
   * Registra un cuadro. `state` null o no detectado = no hay botella en el cuadro.
   * Devuelve la botella cerrada cuando termina de pasar.
   */
  push(state: BottleState | null, frame?: Frame): TrackedBottle | null {
    const present = !!state?.detected;
    if (present && state) {
      this.missing = 0;
      if (!this.current) {
        this.current = { id: ++this.seq, frames: 0, votes: {}, states: {}, bestFrame: null, startedAt: Date.now() };
      }
      const c = this.current;
      c.frames++;
      c.votes[state.code] = (c.votes[state.code] ?? 0) + 1;
      c.states[state.code] = state;
      if (frame && (!c.bestFrame || frame.confidence > c.bestFrame.confidence)) c.bestFrame = frame;
      return null;
    }
    if (!this.current) return null;
    this.missing++;
    if (this.missing < this.opts.gapFrames) return null;
    return this.close();
  }

  /** Cierra la botella en curso (por ejemplo, al detener la cámara). */
  flush(): TrackedBottle | null {
    return this.current ? this.close() : null;
  }

  private close(): TrackedBottle | null {
    const c = this.current!;
    this.current = null;
    this.missing = 0;
    if (c.frames < this.opts.minFrames) return null;
    const code = topCode(c.votes);
    return {
      id: c.id, state: c.states[code], frames: c.frames, votes: c.votes,
      bestFrame: c.bestFrame, startedAt: c.startedAt, endedAt: Date.now(),
    };
  }
}

/** Código más votado; en empate gana el error (para no dejar pasar una botella dudosa como OK). */
function topCode(votes: Record<string, number>): string {
  return Object.entries(votes).sort((a, b) => b[1] - a[1] || (a[0] === "OK" ? 1 : b[0] === "OK" ? -1 : 0))[0]?.[0] ?? "OK";
}
