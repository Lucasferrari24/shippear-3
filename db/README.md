# Base de datos (SQLite)

La app guarda inspecciones, la verificación del modelo maestro y la cola del dataset en `data/quality_control.db`, que se puede cambiar con `DB_PATH`. Usa el SQLite que trae Node (`node:sqlite`, Node 22.5 o superior), así que no hay dependencias nativas.

Al abrir la base, [`src/lib/db.ts`](../src/lib/db.ts) aplica en orden las migraciones de `migrations/` que falten y las registra en `schema_migrations`. Si la base no existe, la crea desde cero.

| Migración | Contenido |
|---|---|
| [`001_initial.sql`](migrations/001_initial.sql) | Esquema v1 entregado por el equipo, sin cambios, con las recetas Clásico y Stevia |
| [`002_feedback.sql`](migrations/002_feedback.sql) | Líneas de producción, verificación con el maestro, cola del dataset y vistas para tableros |

> En Vercel el disco no persiste: la base y las fotos solo sirven corriendo la app en local. Para producción, el mismo esquema se puede pasar a Postgres o Turso.

## Cambios de la migración 002

**Contexto de línea:**
- Tabla nueva `production_lines`, con `line-1` creada por defecto.
- Columna `line_id` en `capture_devices`, `inspection_runs` e `inspections`.

**Inspecciones:**
- `inspections.engine`: qué motor dio el veredicto, `local` (YOLO) o `teacher` (Claude).
- `inspections.bottle_model` e `inspections.level_fraction`.
- `detections.source`: `model`, `teacher` o `human`. Las cajas del maestro y del modelo local de una misma foto quedan juntas.

**Banda de llenado:**
- `product_recipes.fill_band_min` y `fill_band_max`, en fracción de la altura de la botella, que es la unidad que usa la app. `fill_min_mm` y `fill_max_mm` quedan para cuando haya calibración de píxeles a milímetros.

**Defectos:**
- Se agrega el código `LEVEL_NOT_FOUND`. SQLite no permite cambiar un `CHECK`, así que la tabla se recrea copiando los datos.

**Retroalimentación:**

| Tabla | Para qué |
|---|---|
| `teacher_reviews` | Respuesta del maestro: modelo, veredicto, estado de tapa, nivel, confianza y lectura completa (`reading_json`) |
| `feedback_comparisons` | Modelo local contra maestro: coincidencia de veredicto, tapa y defectos, IoU de botella y tapa, diferencia de nivel |
| `dataset_samples` | Cola del dataset: clase, origen de la etiqueta (`teacher` o `human`) y estado (`pending`, `approved`, `rejected`, `exported`) |

**Vistas:**

| Vista | Para qué |
|---|---|
| `v_line_daily` | Total, OK, NOK y tiempo medio por línea y día |
| `v_line_defects` | Defectos por línea y día |
| `v_model_agreement` | Qué tanto coincide cada versión del modelo local con el maestro |

## Equivalencia de defectos

| App (`inspection.ts`) | Base (`defects.code`) |
|---|---|
| `TAPA_MAL_COLOCADA` | `CAP_MISALIGNED` |
| `TAPA_ABIERTA` | `CAP_OPEN` |
| `SIN_TAPA` | `CAP_MISSING` |
| `NIVEL_BAJO` | `LEVEL_LOW` |
| `NIVEL_ALTO` | `LEVEL_HIGH` |
| `NIVEL_NO_DETECTADO` | `LEVEL_NOT_FOUND` |
| `BOTELLA_NO_DETECTADA` | `BOTTLE_NOT_FOUND` |

## Reglas de la cola del dataset

- La clase la propone el maestro (Claude Opus 5.5).
- La muestra se **aprueba sola** cuando el maestro pudo medir todo y su confianza es de al menos 0,7. El umbral se cambia con `FEEDBACK_MIN_TEACHER_CONF`.
- Si no, queda **pendiente** de revisión humana.
- Los desacuerdos con el modelo local llevan prioridad 1, para revisarlos primero aunque estén aprobados.
- La revisión humana usa `PATCH /api/dataset/<id>`, con `{ "status": "approved" | "rejected", "labelClass"?: "...", "reviewer"?: "..." }`. Si se corrige la clase, el origen pasa a `human`.
- `ml/export_feedback.py` lleva las muestras aprobadas a `data/feedback/` para el próximo entrenamiento y las marca como `exported`.

Las coordenadas de `detections` son en píxeles de la imagen guardada: `x` e `y` son la esquina superior izquierda, más `width` y `height`.
