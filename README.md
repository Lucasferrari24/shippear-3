# Centinela QC

**Control de calidad por visión con IA para la línea de envasado de Virginia.**
Shippe.ar Hackathon #3 · Rosario · 24-10-26 · Track **Vertical AI** · Desafío *Control de Calidad por Visión* (Virginia).

> Subís la foto de una botella de edulcorante y en segundos obtenés **OK / NOK**, el **defecto** detectado y las **cotas dibujadas sobre la imagen**.

- 🔗 **Demo:** _(URL HTTPS de Vercel)_
- ▶️ **Video (2 min):** _(link de YouTube)_

## El problema

Al final de la línea, cada botella (modelos **Clásico**, de tapa roja, y **Stevia**, de tapa verde) tiene que salir con la tapa bien colocada y el llenado dentro de tolerancia. Hoy esa inspección es visual y humana: es lenta, se cansa y no deja registro. Los defectos que hay que detectar son:

| # | Defecto | Qué se ve |
|---|---|---|
| 01 | Tapa mal colocada / apoyada | Tapa inclinada, con separación visible con el pico |
| 02 | Tapa abierta | Capuchón levantado, con separación sobre la tapa |
| 03 | Ausencia de tapa | Pico descubierto |
| 04 | Nivel fuera de banda | La superficie del líquido queda fuera de la banda mín/máx |

## Cómo lo resolvemos

Separamos **percepción** de **decisión**:

1. **La IA mide.** Un modelo de visión (Claude) recibe la foto y devuelve una medición estructurada: el modelo de botella, cajas de envase, pico y tapa en píxeles, el estado de la tapa, la separación tapa-pico, la altura del menisco y la evidencia en texto. La salida usa *structured outputs*, así que siempre llega un JSON que cumple el esquema.
2. **Las reglas deciden.** Un motor determinístico ([`src/lib/inspection.ts`](src/lib/inspection.ts)) convierte el nivel en una fracción de la altura del envase y lo compara contra la banda de cada modelo. El veredicto es auditable y reproducible.
3. **Calibración en un click.** Marcás una botella buena como referencia y la banda queda fijada en ±4%. Los veredictos de todo el lote se recalculan en el cliente sin volver a llamar a la IA.
4. **Trazabilidad.** Cada foto queda con sus cotas superpuestas y la evidencia. Podés procesar lotes de muchas fotos en paralelo y exportar todo a CSV.

El líquido es incoloro y el envase transparente, así que un umbral de píxeles clásico es frágil frente a reflejos e iluminación. El modelo de visión ubica el menisco por refracción y contexto. Las tolerancias, en cambio, quedan del lado de las reglas, donde el equipo de calidad las controla.

## Datos y entrenamiento

No usamos datasets públicos: ninguno tiene tapas a presión con capuchón ni nivel de líquido incoloro (el análisis está en [`docs/investigacion-vision-qc-botellas-tapas.md`](docs/investigacion-vision-qc-botellas-tapas.md)). El dataset es propio:

- **Fotos reales de producción** de los modelos Clásico y Stevia.
- **Variaciones generadas con Gemini** a partir de esas fotos, con cada defecto: unas 100 imágenes en total.
- **Un set de fotos reales reservado** para evaluar, que nunca se usa para entrenar.

La estructura y las reglas están en [`data/README.md`](data/README.md). Las imágenes no se suben al repo.

**Modelo local y maestro:**

1. **Modelo local:** un detector YOLO nano entrenado con [`ml/`](ml/README.md) y exportado a ONNX en `public/models/`. Corre en el servidor con `onnxruntime-node`, en [`src/lib/localModel.ts`](src/lib/localModel.ts).
2. **Modelo maestro:** Claude Opus 5.5, en [`src/lib/teacher.ts`](src/lib/teacher.ts), con salida estructurada.
3. **Modo de recolección:** un interruptor en la interfaz, desactivado por defecto. Cada foto se verifica con el maestro y se compara con el modelo local. Todo se guarda en SQLite: [`db/README.md`](db/README.md) tiene el esquema y la cola del dataset. Las muestras aprobadas vuelven al entrenamiento con `ml/export_feedback.py`.

## API

Las tres rutas reciben `{ "image": "data:image/jpeg;base64,...", "width": 1280, "height": 960 }`. `band` (`{ "min", "max" }`) es opcional.

| Ruta | Modelo | Devuelve |
|---|---|---|
| `POST /api/predict` | YOLO local (ONNX) | Lectura, veredicto con el estado de la botella y las detecciones crudas. Si no hay modelo entrenado, responde 503 |
| `POST /api/inspect` | Claude (maestro) | Lectura y veredicto con el estado de la botella |
| `POST /api/feedback` | Los dos en paralelo | Guarda la foto, las dos decisiones y la comparación en la base. Si el cliente no manda `local`, el servidor corre el YOLO |
| `GET /api/feedback` | — | Resumen de la cola del dataset y coincidencia del YOLO con el maestro |
| `PATCH /api/dataset/<id>` | — | Revisión humana de una muestra |

Ejemplo:

```bash
curl -s localhost:3000/api/predict -H "content-type: application/json" \
  -d "{\"image\":\"data:image/jpeg;base64,$(base64 -w0 foto.jpg)\",\"width\":1280,\"height\":960}"
```

`width` y `height` son las medidas de la imagen enviada: las cajas vuelven en esos píxeles.

## Stack

- Next.js 15 (App Router) + React 19 + Tailwind 4
- Anthropic SDK: Claude Opus 5.5 con visión y salida estructurada, en [`src/lib/teacher.ts`](src/lib/teacher.ts)
- SQLite con `node:sqlite` (Node 22.5 o superior), en [`src/lib/db.ts`](src/lib/db.ts) y [`db/`](db/README.md)
- YOLO (Ultralytics) para el modelo local, en [`ml/`](ml/README.md)
- Overlay en Canvas, en [`src/components/Overlay.tsx`](src/components/Overlay.tsx)
- `onnxruntime-node` y `sharp` para correr el YOLO en el servidor
- Deploy en Vercel (la recolección de datos necesita correr en local: el disco de Vercel no persiste). `onnxruntime-node` pesa unos 300 MB con binarios de todas las plataformas: si la función de Vercel supera el límite de tamaño, `/api/predict` tiene que correr en local o en un servidor propio

## Correr localmente

```bash
npm install
cp .env.example .env.local   # completar ANTHROPIC_API_KEY
npm run dev
```

Abrí http://localhost:3000 y arrastrá fotos.

## Fuera de alcance (según el desafío)

La integración con la línea de producción (PLC, cámara en línea, expulsor) no entra en este hackathon. Los siguientes pasos serían:

- procesar video directamente, inspeccionando una vez cada botella que pasa;
- reentrenar por lotes con las fotos revisadas del modo de recolección;
- un tablero de tendencias por turno.

## Equipo

_(nombres)_
