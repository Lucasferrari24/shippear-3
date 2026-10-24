// Punto de entrada compartido por la API: tipos en ./types (el contrato con la UI) y reglas en ./judge.
// types.ts y judge.ts son copia de los de la interfaz (src/lib/): si se cambia uno, hay que cambiar el otro.
export * from "./types";
export { DEFAULT_BANDS, judge, bandKey } from "./judge";
